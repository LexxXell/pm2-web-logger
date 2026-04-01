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
  it('returns merged logs for stream=all', async () => {
    tempDir = await createTempDir();
    await writeFile(path.join(tempDir, 'strapi-out.log'), 'stdout line\n', 'utf8');
    await writeFile(path.join(tempDir, 'strapi-error.log'), 'stderr line\n', 'utf8');

    const context = await createTestContext(createTestConfig(tempDir));

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs?app=strapi&stream=all&limit=10'
      });

      expect(response.statusCode).toBe(200);

      const payload = response.json<{
        app: string;
        stream: string;
        lines: Array<{ line: string; stream: string }>;
      }>();

      expect(payload.app).toBe('strapi');
      expect(payload.stream).toBe('all');
      expect(payload.lines).toHaveLength(2);
      expect(payload.lines.map((entry) => entry.stream).sort()).toEqual(['error', 'out']);
      expect(payload.lines.map((entry) => entry.line).sort()).toEqual(['stderr line', 'stdout line']);
    } finally {
      await context.close();
    }
  });

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
