import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { parseEnv } from '../../src/config/env.js';

const baseEnv = {
  PORT: '3710',
  HOST: '0.0.0.0',
  PM2_LOGS_DIR: '/home/deploy/.pm2/logs',
  APPS: 'strapi,worker',
  BUFFER_SIZE: '1000',
  MAX_HTTP_LIMIT: '1000',
  READ_EXISTING_ON_START: 'true',
  FILE_POLL_INTERVAL_MS: '500',
  MAX_LINE_LENGTH: '16384',
  SSE_HEARTBEAT_MS: '15000',
  ENABLE_CORS: 'false',
  CORS_ORIGIN: '',
  LOG_LEVEL: 'info',
  AUTH_TOKEN: 'secret',
  BASE_PATH: '/_logs/'
};

describe('parseEnv', () => {
  it('parses and normalizes valid config', () => {
    const config = parseEnv(baseEnv);

    expect(config.apps).toEqual(['strapi', 'worker']);
    expect(config.basePath).toBe('/_logs');
    expect(config.authToken).toBe('secret');
  });

  it('rejects invalid app names', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        APPS: 'strapi,../../etc/passwd'
      })
    ).toThrow(ZodError);
  });

  it('rejects max http limit above buffer size', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        BUFFER_SIZE: '100',
        MAX_HTTP_LIMIT: '101'
      })
    ).toThrow(ZodError);
  });

  it('requires cors origin when cors is enabled', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        ENABLE_CORS: 'true',
        CORS_ORIGIN: ''
      })
    ).toThrow(ZodError);
  });
});
