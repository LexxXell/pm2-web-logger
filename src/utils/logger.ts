const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_ORDER;

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }

  return value;
};

export const createLogger = (level: LogLevel): Logger => {
  const threshold = LOG_LEVEL_ORDER[level];

  const write =
    (severity: LogLevel) =>
    (message: string, meta?: Record<string, unknown>): void => {
      if (LOG_LEVEL_ORDER[severity] < threshold) {
        return;
      }

      const normalizedMeta = meta ? (normalizeValue(meta) as Record<string, unknown>) : undefined;
      const payload = {
        time: new Date().toISOString(),
        level: severity,
        msg: message,
        ...(normalizedMeta ?? {})
      };

      const serialized = JSON.stringify(payload);

      if (severity === 'error') {
        console.error(serialized);
        return;
      }

      if (severity === 'warn') {
        console.warn(serialized);
        return;
      }

      console.log(serialized);
    };

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error')
  };
};
