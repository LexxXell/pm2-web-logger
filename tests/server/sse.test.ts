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
  it('returns cors headers for allowed origin', async () => {
    tempDir = await createTempDir();
    const outFilePath = path.join(tempDir, 'strapi-out.log');
    await writeFile(outFilePath, 'bootstrap out\n', 'utf8');

    const context = await createTestContext(
      createTestConfig(tempDir, {
        apps: ['strapi'],
        enableCors: true,
        corsOrigins: ['http://127.0.0.1:5500']
      })
    );

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs/stream?app=strapi&stream=out',
        payloadAsStream: true,
        headers: {
          origin: 'http://127.0.0.1:5500'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5500');

      response.raw.res.destroy();
      response.stream().destroy();
    } finally {
      await context.close();
    }
  });

  it('streams merged out and error lines to connected clients', async () => {
    tempDir = await createTempDir();
    const errorFilePath = path.join(tempDir, 'strapi-error.log');
    const outFilePath = path.join(tempDir, 'strapi-out.log');
    await writeFile(errorFilePath, 'bootstrap err\n', 'utf8');
    await writeFile(outFilePath, 'bootstrap out\n', 'utf8');

    const context = await createTestContext(
      createTestConfig(tempDir, {
        apps: ['strapi']
      })
    );

    let responseBody = '';

    try {
      const response = await context.server.inject({
        method: 'GET',
        url: '/api/logs/stream?app=strapi&stream=all',
        payloadAsStream: true
      });

      const stream = response.stream();
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        responseBody += chunk;
      });

      await waitFor(() => responseBody.includes('event: ready'));

      await appendFile(errorFilePath, 'runtime failure\n', 'utf8');
      await appendFile(outFilePath, 'server started\n', 'utf8');

      await waitFor(() => responseBody.includes('"line":"runtime failure"'));
      await waitFor(() => responseBody.includes('"line":"server started"'));

      expect(responseBody).toContain('event: log');
      expect(responseBody).toContain('"stream":"all"');
      expect(responseBody).toContain('"stream":"error"');
      expect(responseBody).toContain('"stream":"out"');
      expect(responseBody).toContain('"line":"runtime failure"');
      expect(responseBody).toContain('"line":"server started"');

      response.raw.res.destroy();
      stream.destroy();
    } finally {
      await context.close();
    }
  });
});
