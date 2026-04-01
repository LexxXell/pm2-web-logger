import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AppConfig } from '../src/config/env.js';
import { SourceManager } from '../src/logs/source-manager.js';
import { buildServer } from '../src/server/build-server.js';
import { createLogger } from '../src/utils/logger.js';

export const createTempDir = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), 'pm2-web-logger-'));

export const removeTempDir = async (directory: string): Promise<void> => {
  await rm(directory, { recursive: true, force: true });
};

export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
};

export const createTestConfig = (
  pm2LogsDir: string,
  overrides: Partial<AppConfig> = {}
): AppConfig => ({
  port: 0,
  host: '127.0.0.1',
  pm2LogsDir,
  apps: ['strapi'],
  bufferSize: 10,
  maxHttpLimit: 10,
  readExistingOnStart: true,
  filePollIntervalMs: 50,
  maxLineLength: 1024,
  sseHeartbeatMs: 250,
  enableCors: false,
  corsOrigin: undefined,
  logLevel: 'error',
  authToken: undefined,
  basePath: '/',
  ...overrides
});

export const createTestContext = async (config: AppConfig) => {
  const logger = createLogger('error');
  const sourceManager = new SourceManager(config, logger);
  await sourceManager.start();
  const server = await buildServer(config, sourceManager, logger);

  return {
    server,
    sourceManager,
    close: async (): Promise<void> => {
      await server.close();
      await sourceManager.stop();
    }
  };
};
