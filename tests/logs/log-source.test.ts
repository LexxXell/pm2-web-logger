import { appendFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LogSource } from '../../src/logs/log-source.js';
import { createLogger } from '../../src/utils/logger.js';
import { createTempDir, removeTempDir, waitFor } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

const createSource = (filePath: string) =>
  new LogSource({
    app: 'strapi',
    stream: 'out',
    filePath,
    bufferSize: 10,
    pollIntervalMs: 50,
    maxLineLength: 1024,
    readExistingOnStart: true,
    logger: createLogger('error')
  });

describe('LogSource', () => {
  it('starts in missing state and picks up a file created later', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');
    const source = createSource(filePath);

    await source.start();
    expect(source.getStatus().state).toBe('missing');

    await writeFile(filePath, 'hello later\n', 'utf8');

    await waitFor(() => source.getSnapshot(10).length === 1);

    expect(source.getSnapshot(10)[0]?.line).toBe('hello later');
    await source.stop();
  });

  it('captures appended lines after startup', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');
    const source = createSource(filePath);

    await writeFile(filePath, 'boot line\n', 'utf8');
    await source.start();

    await appendFile(filePath, 'next line\n', 'utf8');

    await waitFor(() => source.getSnapshot(10).some((entry) => entry.line === 'next line'));

    expect(source.getSnapshot(10).map((entry) => entry.line)).toEqual([
      'boot line',
      'next line'
    ]);

    await source.stop();
  });

  it('continues after rotation', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');
    const source = createSource(filePath);

    await writeFile(filePath, 'before rotation\n', 'utf8');
    await source.start();

    await rename(filePath, path.join(tempDir, 'strapi-out.log.1'));
    await writeFile(filePath, 'after rotation bootstrap\n', 'utf8');

    await waitFor(() => source.getSnapshot(10).some((entry) => entry.line === 'after rotation bootstrap'));

    await appendFile(filePath, 'after rotation tail\n', 'utf8');

    await waitFor(() => source.getSnapshot(10).some((entry) => entry.line === 'after rotation tail'));

    expect(source.getSnapshot(10).map((entry) => entry.line)).toContain('after rotation tail');

    await source.stop();
  });
});
