import { mkdir } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir, removeTempDir, createTestConfig, createTestContext } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe('auth middleware', () => {
  it('protects /api routes when auth token is configured', async () => {
    tempDir = await createTempDir();
    await mkdir(tempDir, { recursive: true });

    const context = await createTestContext(
      createTestConfig(tempDir, {
        authToken: 'secret'
      })
    );

    try {
      const unauthorized = await context.server.inject({
        method: 'GET',
        url: '/api/sources'
      });

      const authorized = await context.server.inject({
        method: 'GET',
        url: '/api/sources',
        headers: {
          authorization: 'Bearer secret'
        }
      });

      expect(unauthorized.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
    } finally {
      await context.close();
    }
  });
});
