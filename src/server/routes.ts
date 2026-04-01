import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../config/env.js';
import { serviceVersion } from '../version.js';
import type { SourceManager } from '../logs/source-manager.js';
import type { LogStream } from '../types/logs.js';
import { HttpError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';
import { assertBearerAuth } from './auth.js';
import { formatSseEvent, writeSseChunk } from './sse.js';

const streamSchema = z.enum(['out', 'error']);

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

const getSourceOrThrow = (sourceManager: SourceManager, app: string, stream: LogStream) => {
  const source = sourceManager.getSource(app, stream);

  if (!source) {
    throw new HttpError(404, 'SOURCE_NOT_FOUND', `Unknown source "${app}:${stream}"`);
  }

  return source;
};

const setSseHeaders = (reply: FastifyReply): void => {
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
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

        const source = getSourceOrThrow(sourceManager, query.app, query.stream);
        const limit = query.limit ?? config.bufferSize;

        return {
          app: query.app,
          stream: query.stream,
          limit,
          lines: source.getSnapshot(limit)
        };
      });

      apiServer.get('/logs/stream', (request, reply) => {
        const query = parseSchema(buildStreamQuerySchema(), request.query, 'Invalid stream query');
        const source = getSourceOrThrow(sourceManager, query.app, query.stream);

        reply.hijack();
        setSseHeaders(reply);
        reply.raw.flushHeaders?.();

        let closed = false;

        const closeConnection = (): void => {
          if (closed) {
            return;
          }

          closed = true;
          unsubscribe();
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

        const unsubscribe = source.subscribe((event) => {
          writeOrClose(formatSseEvent('log', event));
        });

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
