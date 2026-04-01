import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../config/env.js';
import type { LogSource } from '../logs/log-source.js';
import { serviceVersion } from '../version.js';
import type { SourceManager } from '../logs/source-manager.js';
import type { LogResponseEntry, LogStreamSelector } from '../types/logs.js';
import { HttpError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';
import { assertBearerAuth } from './auth.js';
import { formatSseEvent, writeSseChunk } from './sse.js';

const streamSchema = z.enum(['out', 'error', 'all']);

const buildLogsQuerySchema = (maxHttpLimit: number) =>
  z.object({
    app: z.string().trim().min(1),
    stream: streamSchema,
    limit: z.coerce.number().int().min(1).max(maxHttpLimit).optional()
  });

const buildStreamQuerySchema = () =>
  z.object({
    app: z.string().trim().min(1),
    stream: streamSchema
  });

const parseSchema = <T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string
): T => {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw new HttpError(400, 'VALIDATION_ERROR', `${message}: ${z.prettifyError(result.error)}`);
};

const getSourcesOrThrow = (
  sourceManager: SourceManager,
  app: string,
  stream: LogStreamSelector
): LogSource[] => {
  if (stream === 'all') {
    const outSource = sourceManager.getSource(app, 'out');
    const errorSource = sourceManager.getSource(app, 'error');

    if (!outSource || !errorSource) {
      throw new HttpError(404, 'SOURCE_NOT_FOUND', `Unknown app "${app}"`);
    }

    return [outSource, errorSource];
  }

  const source = sourceManager.getSource(app, stream);

  if (!source) {
    throw new HttpError(404, 'SOURCE_NOT_FOUND', `Unknown source "${app}:${stream}"`);
  }

  return [source];
};

const getSnapshotResponseLines = (sources: LogSource[], limit: number): LogResponseEntry[] => {
  const merged = sources.flatMap((source, sourceIndex) =>
    source.getSnapshot(limit).map((entry, entryIndex) => ({
      ...entry,
      stream: source.stream,
      sourceIndex,
      entryIndex
    }))
  );

  merged.sort((left, right) => {
    const timestampOrder = left.timestamp.localeCompare(right.timestamp);

    if (timestampOrder !== 0) {
      return timestampOrder;
    }

    if (left.sourceIndex !== right.sourceIndex) {
      return left.sourceIndex - right.sourceIndex;
    }

    return left.entryIndex - right.entryIndex;
  });

  return merged.slice(-limit).map((entry) => ({
    line: entry.line,
    timestamp: entry.timestamp,
    truncated: entry.truncated,
    stream: entry.stream
  }));
};

const setSseHeaders = (reply: FastifyReply): void => {
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
};

const setSseCorsHeaders = (
  reply: FastifyReply,
  requestOrigin: string | undefined,
  allowedOrigins: string[] | undefined
): void => {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) {
    return;
  }

  if (allowedOrigins.includes('*')) {
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    return;
  }

  if (!allowedOrigins.includes(requestOrigin)) {
    return;
  }

  reply.raw.setHeader('Access-Control-Allow-Origin', requestOrigin);
  reply.raw.setHeader('Vary', 'Origin');
};

export const registerRoutes = async (
  server: FastifyInstance,
  config: AppConfig,
  sourceManager: SourceManager,
  logger: Logger
): Promise<void> => {
  server.get('/health', () => ({
    status: 'ok',
    uptimeMs: Math.round(process.uptime() * 1000),
    version: serviceVersion,
    trackedSources: sourceManager.getTrackedSourceCount(),
    sources: sourceManager.listSources()
  }));

  await server.register(
    (apiServer, _options, done) => {
      apiServer.addHook('onRequest', (request, _reply, next) => {
        try {
          assertBearerAuth(config.authToken, request.headers.authorization);
          next();
        } catch (error) {
          next(error as Error);
        }
      });

      apiServer.get('/sources', () => ({
        sources: sourceManager.listSources()
      }));

      apiServer.get('/logs', (request) => {
        const query = parseSchema(
          buildLogsQuerySchema(config.maxHttpLimit),
          request.query,
          'Invalid logs query'
        );

        const sources = getSourcesOrThrow(sourceManager, query.app, query.stream);
        const limit = query.limit ?? config.bufferSize;

        return {
          app: query.app,
          stream: query.stream,
          limit,
          lines: getSnapshotResponseLines(sources, limit)
        };
      });

      apiServer.get('/logs/stream', (request, reply) => {
        const query = parseSchema(buildStreamQuerySchema(), request.query, 'Invalid stream query');
        const sources = getSourcesOrThrow(sourceManager, query.app, query.stream);

        reply.hijack();
        setSseHeaders(reply);
        setSseCorsHeaders(reply, request.headers.origin, config.corsOrigins);
        reply.raw.flushHeaders?.();

        let closed = false;
        const unsubscribers: Array<() => void> = [];

        const closeConnection = (): void => {
          if (closed) {
            return;
          }

          closed = true;
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
          clearInterval(heartbeatTimer);

          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        };

        const writeOrClose = (chunk: string): void => {
          if (closed) {
            return;
          }

          const ok = writeSseChunk(reply.raw, chunk);

          if (!ok) {
            logger.warn('Closing slow SSE client', {
              app: query.app,
              stream: query.stream,
              remoteAddress: request.ip
            });
            closeConnection();
          }
        };

        for (const source of sources) {
          unsubscribers.push(
            source.subscribe((event) => {
              writeOrClose(formatSseEvent('log', event));
            })
          );
        }

        const heartbeatTimer = setInterval(() => {
          writeOrClose(': heartbeat\n\n');
        }, config.sseHeartbeatMs);

        heartbeatTimer.unref?.();

        reply.raw.on('close', closeConnection);
        request.raw.on('close', closeConnection);

        writeOrClose(
          formatSseEvent('ready', {
            app: query.app,
            stream: query.stream,
            timestamp: new Date().toISOString()
          })
        );
      });

      done();
    },
    { prefix: '/api' }
  );
};
