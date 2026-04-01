import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

import type { Logger } from '../utils/logger.js';
import type { LogEntry, LogEvent, LogStream, LogSubscriber, ParsedLine, SourceState, SourceStatus } from '../types/logs.js';
import { LineAccumulator } from './line-accumulator.js';
import { RingBuffer } from './ring-buffer.js';
import { readLastLines } from './tail-reader.js';

interface LogSourceOptions {
  app: string;
  stream: LogStream;
  filePath: string;
  bufferSize: number;
  pollIntervalMs: number;
  maxLineLength: number;
  readExistingOnStart: boolean;
  logger: Logger;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

const READ_CHUNK_SIZE = 64 * 1024;

const getIdentity = (value: { dev: number; ino: number }): FileIdentity => ({
  dev: value.dev,
  ino: value.ino
});

const sameIdentity = (left: FileIdentity | undefined, right: FileIdentity | undefined): boolean =>
  left !== undefined &&
  right !== undefined &&
  left.dev === right.dev &&
  left.ino === right.ino;

export class LogSource {
  private readonly buffer: RingBuffer<LogEntry>;
  private readonly subscribers = new Set<LogSubscriber>();
  private readonly lineAccumulator: LineAccumulator;

  private decoder = new StringDecoder('utf8');
  private timer: NodeJS.Timeout | undefined;
  private currentIdentity: FileIdentity | undefined;
  private currentOffset = 0;
  private fileExists = false;
  private lastError: string | undefined;
  private lastReadAt: string | undefined;
  private state: SourceState = 'stopped';
  private polling = false;

  public constructor(private readonly options: LogSourceOptions) {
    this.buffer = new RingBuffer<LogEntry>(options.bufferSize);
    this.lineAccumulator = new LineAccumulator(options.maxLineLength);
  }

  public async start(): Promise<void> {
    if (this.timer) {
      return;
    }

    await this.initialize();

    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.pollIntervalMs);

    this.timer.unref?.();
  }

  public stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.resetReader();
    this.state = 'stopped';
    return Promise.resolve();
  }

  public subscribe(listener: LogSubscriber): () => void {
    this.subscribers.add(listener);

    return () => {
      this.subscribers.delete(listener);
    };
  }

  public getSnapshot(limit: number): LogEntry[] {
    return this.buffer.toArray(limit);
  }

  public getStatus(): SourceStatus {
    return {
      app: this.options.app,
      stream: this.options.stream,
      path: this.options.filePath,
      fileExists: this.fileExists,
      state: this.state,
      bufferedLines: this.buffer.size(),
      lastError: this.lastError,
      lastReadAt: this.lastReadAt
    };
  }

  public get app(): string {
    return this.options.app;
  }

  public get stream(): LogStream {
    return this.options.stream;
  }

  private async initialize(): Promise<void> {
    const stats = await this.safeStat();

    if (!stats) {
      this.fileExists = false;
      this.state = 'missing';
      return;
    }

    this.fileExists = true;
    this.currentIdentity = getIdentity(stats);

    if (this.options.readExistingOnStart) {
      await this.backfillFromTail();
      const refreshedStats = await this.safeStat();

      if (refreshedStats && sameIdentity(this.currentIdentity, getIdentity(refreshedStats))) {
        this.currentOffset = refreshedStats.size;
      } else {
        this.currentOffset = 0;
        this.currentIdentity = refreshedStats ? getIdentity(refreshedStats) : undefined;
      }
    } else {
      this.currentOffset = stats.size;
    }

    this.state = 'watching';
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      await this.pollOnce();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastError = err.message;
      this.state = 'error';
      this.options.logger.error('Failed to poll log source', {
        app: this.options.app,
        stream: this.options.stream,
        path: this.options.filePath,
        error: err
      });
    } finally {
      this.polling = false;
    }
  }

  private async pollOnce(): Promise<void> {
    const stats = await this.safeStat();

    if (!stats) {
      this.handleMissingFile();
      return;
    }

    const nextIdentity = getIdentity(stats);

    if (!sameIdentity(this.currentIdentity, nextIdentity)) {
      await this.handleFileReplacement(nextIdentity);
      return;
    }

    this.fileExists = true;
    this.state = 'watching';
    this.lastError = undefined;

    if (stats.size < this.currentOffset) {
      this.options.logger.info('Detected log truncation', {
        app: this.options.app,
        stream: this.options.stream,
        path: this.options.filePath
      });
      this.currentOffset = 0;
      this.resetReader();
    }

    if (stats.size === this.currentOffset) {
      return;
    }

    await this.readAppendedBytes(this.currentOffset, stats.size);
    this.currentOffset = stats.size;
    this.lastReadAt = new Date().toISOString();
  }

  private async handleFileReplacement(identity: FileIdentity): Promise<void> {
    this.options.logger.info('Detected log rotation or file replacement', {
      app: this.options.app,
      stream: this.options.stream,
      path: this.options.filePath
    });

    this.fileExists = true;
    this.currentIdentity = identity;
    this.currentOffset = 0;
    this.resetReader();
    this.lastError = undefined;
    this.state = 'watching';

    if (this.options.readExistingOnStart) {
      await this.backfillFromTail();
      const refreshedStats = await this.safeStat();

      if (refreshedStats && sameIdentity(this.currentIdentity, getIdentity(refreshedStats))) {
        this.currentOffset = refreshedStats.size;
      }

      return;
    }

    const refreshedStats = await this.safeStat();

    if (refreshedStats && sameIdentity(this.currentIdentity, getIdentity(refreshedStats))) {
      this.currentOffset = refreshedStats.size;
    }
  }

  private handleMissingFile(): void {
    this.fileExists = false;
    this.currentIdentity = undefined;
    this.currentOffset = 0;
    this.resetReader();

    if (this.state !== 'missing') {
      this.options.logger.warn('Log file is currently unavailable', {
        app: this.options.app,
        stream: this.options.stream,
        path: this.options.filePath
      });
    }

    this.state = 'missing';
    this.lastError = undefined;
  }

  private async backfillFromTail(): Promise<void> {
    try {
      const tailLines = await readLastLines(
        this.options.filePath,
        this.options.bufferSize,
        this.options.maxLineLength
      );

      for (const line of tailLines) {
        this.ingestLine(line, false);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastError = err.message;
      this.state = 'error';
      this.options.logger.error('Failed to read existing log tail', {
        app: this.options.app,
        stream: this.options.stream,
        path: this.options.filePath,
        error: err
      });
    }
  }

  private async readAppendedBytes(start: number, end: number): Promise<void> {
    const handle = await open(this.options.filePath, 'r');

    try {
      let position = start;

      while (position < end) {
        const size = Math.min(READ_CHUNK_SIZE, end - position);
        const buffer = Buffer.allocUnsafe(size);
        const { bytesRead } = await handle.read(buffer, 0, size, position);

        if (bytesRead === 0) {
          break;
        }

        position += bytesRead;

        const text = this.decoder.write(buffer.subarray(0, bytesRead));
        const lines = this.lineAccumulator.pushChunk(text);

        for (const line of lines) {
          this.ingestLine(line, true);
        }
      }
    } finally {
      await handle.close();
    }
  }

  private ingestLine(line: ParsedLine, emitRealtime: boolean): void {
    const entry: LogEntry = {
      line: line.line,
      timestamp: new Date().toISOString(),
      truncated: line.truncated
    };

    this.buffer.push(entry);

    if (!emitRealtime) {
      return;
    }

    const event: LogEvent = {
      app: this.options.app,
      stream: this.options.stream,
      ...entry
    };

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private async safeStat() {
    try {
      return await stat(this.options.filePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      this.lastError = err.message;
      this.state = 'error';
      this.options.logger.error('Failed to stat log file', {
        app: this.options.app,
        stream: this.options.stream,
        path: this.options.filePath,
        error: err
      });
      return undefined;
    }
  }

  private resetReader(): void {
    this.decoder = new StringDecoder('utf8');
    this.lineAccumulator.reset();
  }
}
