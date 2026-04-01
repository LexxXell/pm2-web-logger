import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import type { AppConfig } from '../config/env.js';
import { registerRoutes } from './routes.js';
import type { SourceManager } from '../logs/source-manager.js';
import { HttpError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';

const normalizePrefix = (basePath: string): string => (basePath === '/' ? '' : basePath);

export const buildServer = async (
  config: AppConfig,
  sourceManager: SourceManager,
  logger: Logger
): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: false,
    disableRequestLogging: true
  });

  server.setErrorHandler(
    (error: FastifyError | HttpError | ZodError, _request, reply): void => {
      if (reply.raw.writableEnded) {
        return;
      }

      const statusCode =
        error instanceof HttpError
          ? error.statusCode
          : error instanceof ZodError
            ? 400
            : 500;

      const code =
        error instanceof HttpError
          ? error.code
          : error instanceof ZodError
            ? 'VALIDATION_ERROR'
            : 'INTERNAL_ERROR';

      if (statusCode >= 500) {
        logger.error('Request handling failed', {
          error,
          statusCode
        });
      }

      void reply.status(statusCode).send({
        error: {
          code,
          message: statusCode >= 500 ? 'Internal server error' : error.message
        }
      });
    }
  );

  if (config.enableCors) {
    if (!config.corsOrigins || config.corsOrigins.length === 0) {
      throw new Error('CORS_ORIGIN must be configured when CORS is enabled');
    }

    await server.register(cors, {
      origin: config.corsOrigins
    });
  }

  await server.register(
    async (scopedServer) => {
      await registerRoutes(scopedServer, config, sourceManager, logger);
    },
    {
      prefix: normalizePrefix(config.basePath)
    }
  );

  return server;
};
