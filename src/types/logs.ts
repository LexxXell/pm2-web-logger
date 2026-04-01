export type LogStream = 'out' | 'error';
export type LogStreamSelector = LogStream | 'all';

export interface LogEntry {
  line: string;
  timestamp: string;
  truncated: boolean;
}

export interface LogEvent extends LogEntry {
  app: string;
  stream: LogStream;
}

export interface LogResponseEntry extends LogEntry {
  stream: LogStream;
}

export type SourceState = 'watching' | 'missing' | 'error' | 'stopped';

export interface SourceStatus {
  app: string;
  stream: LogStream;
  path: string;
  fileExists: boolean;
  state: SourceState;
  bufferedLines: number;
  lastError: string | undefined;
  lastReadAt: string | undefined;
}

export interface ParsedLine {
  line: string;
  truncated: boolean;
}

export type LogSubscriber = (event: LogEvent) => void;
