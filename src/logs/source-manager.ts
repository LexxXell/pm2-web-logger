import * as path from 'node:path';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import type { LogStream, SourceStatus } from '../types/logs.js';
import { LogSource } from './log-source.js';

const STREAMS: LogStream[] = ['out', 'error'];

const getFileName = (app: string, stream: LogStream): string =>
  `${app}-${stream === 'out' ? 'out' : 'error'}.log`;

const getKey = (app: string, stream: LogStream): string => `${app}:${stream}`;

export class SourceManager {
  private readonly sources = new Map<string, LogSource>();

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    for (const app of config.apps) {
      for (const stream of STREAMS) {
        const source = new LogSource({
          app,
          stream,
          filePath: path.join(config.pm2LogsDir, getFileName(app, stream)),
          bufferSize: config.bufferSize,
          pollIntervalMs: config.filePollIntervalMs,
          maxLineLength: config.maxLineLength,
          readExistingOnStart: config.readExistingOnStart,
          logger
        });

        this.sources.set(getKey(app, stream), source);
      }
    }
  }

  public async start(): Promise<void> {
    await Promise.all(Array.from(this.sources.values(), (source) => source.start()));
  }

  public async stop(): Promise<void> {
    await Promise.allSettled(Array.from(this.sources.values(), (source) => source.stop()));
  }

  public getSource(app: string, stream: LogStream): LogSource | undefined {
    return this.sources.get(getKey(app, stream));
  }

  public listSources(): SourceStatus[] {
    return Array.from(this.sources.values(), (source) => source.getStatus());
  }

  public getTrackedSourceCount(): number {
    return this.sources.size;
  }

  public logStartupSummary(): void {
    this.logger.info('Configured log sources', {
      sources: this.listSources().map((source) => ({
        app: source.app,
        stream: source.stream,
        path: source.path
      }))
    });
  }
}
