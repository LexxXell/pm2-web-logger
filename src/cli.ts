import dotenv from 'dotenv';

import { getRedactedConfigSummary, parseEnv } from './config/env.js';
import { SourceManager } from './logs/source-manager.js';
import { buildServer } from './server/build-server.js';
import { createLogger } from './utils/logger.js';
import { serviceName, serviceVersion } from './version.js';

dotenv.config();

const main = async (): Promise<void> => {
  const config = parseEnv(process.env);
  const logger = createLogger(config.logLevel);
  const sourceManager = new SourceManager(config, logger);

  logger.info(`Starting ${serviceName}`, {
    version: serviceVersion,
    config: getRedactedConfigSummary(config)
  });

  await sourceManager.start();
  sourceManager.logStartupSummary();

  const server = await buildServer(config, sourceManager, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Received shutdown signal', { signal });

    await server.close();
    await sourceManager.stop();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  try {
    await server.listen({
      host: config.host,
      port: config.port
    });

    logger.info('Server is listening', {
      host: config.host,
      port: config.port,
      basePath: config.basePath
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error
    });
    await sourceManager.stop();
    process.exit(1);
  }
};

void main();
