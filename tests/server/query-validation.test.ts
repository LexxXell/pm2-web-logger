import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir, removeTempDir, createTestConfig, createTestContext } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe('query validation', () => {
  it('rejects invalid limit values', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');
    await writeFile(filePath, 'line\n', 'utf8');

    const context = await createTestContext(createTestConfig(tempDir));

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs?app=strapi&stream=out&limit=999'
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await context.close();
    }
  });

  it('returns 404 for unknown sources', async () => {
    tempDir = await createTempDir();
    const context = await createTestContext(createTestConfig(tempDir));

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs?app=unknown&stream=out'
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await context.close();
    }
  });
});
