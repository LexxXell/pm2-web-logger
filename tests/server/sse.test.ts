import { appendFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir, removeTempDir, createTestConfig, createTestContext, waitFor } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe('SSE stream', () => {
  it('streams new lines to connected clients', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-error.log');
    await writeFile(filePath, 'bootstrap\n', 'utf8');

    const context = await createTestContext(
      createTestConfig(tempDir, {
        apps: ['strapi']
      })
    );

    let responseBody = '';

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs/stream?app=strapi&stream=error',
        payloadAsStream: true
      });

      const stream = response.stream();
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        responseBody += chunk;
      });

      await waitFor(() => responseBody.includes('event: ready'));

      await appendFile(filePath, 'runtime failure\n', 'utf8');

      await waitFor(() => responseBody.includes('"line":"runtime failure"'));

      expect(responseBody).toContain('event: log');
      expect(responseBody).toContain('"stream":"error"');
      expect(responseBody).toContain('"line":"runtime failure"');

      response.raw.res.destroy();
      stream.destroy();
    } finally {
      await context.close();
    }
  });
});
