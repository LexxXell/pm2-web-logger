import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir, createTestConfig, createTestContext, removeTempDir } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe('cors', () => {
  it('allows preflight requests for configured origins', async () => {
    tempDir = await createTempDir();

    const context = await createTestContext(
      createTestConfig(tempDir, {
        enableCors: true,
        corsOrigins: ['http://127.0.0.1:5500', 'http://localhost:5500'],
        authToken: 'secret'
      })
    );

    try {
      const response = await context.server.inject({
        method: 'OPTIONS',
        url: '/api/logs?app=strapi&stream=all&limit=100',
        headers: {
          origin: 'http://localhost:5500',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5500');
      expect(response.headers['access-control-allow-headers']).toContain('authorization');
    } finally {
      await context.close();
    }
  });
});
