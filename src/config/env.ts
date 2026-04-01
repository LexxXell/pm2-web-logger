import * as path from 'node:path';

import { z } from 'zod';

import type { LogLevel } from '../utils/logger.js';

const APP_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const booleanString = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, ctx) => {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected "true" or "false"'
    });

    return z.NEVER;
  });

const integerString = (label: string) =>
  z.string().trim().transform((value, ctx) => {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be an integer`
      });

      return z.NEVER;
    }

    return parsed;
  });

const basePathSchema = z
  .string()
  .trim()
  .default('/')
  .transform((value) => {
    if (value === '' || value === '/') {
      return '/';
    }

    const normalized = value.startsWith('/') ? value : `/${value}`;
    return normalized.length > 1 && normalized.endsWith('/')
      ? normalized.slice(0, -1)
      : normalized;
  });

const rawEnvSchema = z
  .object({
    PORT: integerString('PORT').default(3710).pipe(z.number().int().min(1).max(65535)),
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    PM2_LOGS_DIR: z
      .string()
      .trim()
      .min(1)
      .refine((value) => path.isAbsolute(value), 'PM2_LOGS_DIR must be an absolute path'),
    APPS: z.string().trim().min(1),
    BUFFER_SIZE: integerString('BUFFER_SIZE').default(1000).pipe(z.number().int().min(1)),
    MAX_HTTP_LIMIT: integerString('MAX_HTTP_LIMIT')
      .default(1000)
      .pipe(z.number().int().min(1)),
    READ_EXISTING_ON_START: booleanString.default(true),
    FILE_POLL_INTERVAL_MS: integerString('FILE_POLL_INTERVAL_MS')
      .default(500)
      .pipe(z.number().int().min(100).max(60000)),
    MAX_LINE_LENGTH: integerString('MAX_LINE_LENGTH')
      .default(16384)
      .pipe(z.number().int().min(256).max(1024 * 1024)),
    SSE_HEARTBEAT_MS: integerString('SSE_HEARTBEAT_MS')
      .default(15000)
      .pipe(z.number().int().min(1000).max(120000)),
    ENABLE_CORS: booleanString.default(false),
    CORS_ORIGIN: z.string().trim().default(''),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    AUTH_TOKEN: z.string().trim().default(''),
    BASE_PATH: basePathSchema
  })
  .transform((value) => {
    const apps = value.APPS.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    return {
      port: value.PORT,
      host: value.HOST,
      pm2LogsDir: value.PM2_LOGS_DIR,
      apps,
      bufferSize: value.BUFFER_SIZE,
      maxHttpLimit: value.MAX_HTTP_LIMIT,
      readExistingOnStart: value.READ_EXISTING_ON_START,
      filePollIntervalMs: value.FILE_POLL_INTERVAL_MS,
      maxLineLength: value.MAX_LINE_LENGTH,
      sseHeartbeatMs: value.SSE_HEARTBEAT_MS,
      enableCors: value.ENABLE_CORS,
      corsOrigin: value.CORS_ORIGIN,
      logLevel: value.LOG_LEVEL,
      authToken: value.AUTH_TOKEN,
      basePath: value.BASE_PATH
    };
  })
  .superRefine((value, ctx) => {
    if (value.apps.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'APPS must contain at least one application name',
        path: ['APPS']
      });
    }

    const uniqueApps = new Set<string>();

    for (const app of value.apps) {
      if (!APP_NAME_PATTERN.test(app)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid app name "${app}". Use only letters, numbers, dot, underscore, and dash.`,
          path: ['APPS']
        });
      }

      if (uniqueApps.has(app)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate app name "${app}" in APPS`,
          path: ['APPS']
        });
      }

      uniqueApps.add(app);
    }

    if (value.maxHttpLimit > value.bufferSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MAX_HTTP_LIMIT cannot be greater than BUFFER_SIZE',
        path: ['MAX_HTTP_LIMIT']
      });
    }

    if (value.enableCors && value.corsOrigin.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGIN is required when ENABLE_CORS=true',
        path: ['CORS_ORIGIN']
      });
    }
  });

export interface AppConfig {
  port: number;
  host: string;
  pm2LogsDir: string;
  apps: string[];
  bufferSize: number;
  maxHttpLimit: number;
  readExistingOnStart: boolean;
  filePollIntervalMs: number;
  maxLineLength: number;
  sseHeartbeatMs: number;
  enableCors: boolean;
  corsOrigin: string | undefined;
  logLevel: LogLevel;
  authToken: string | undefined;
  basePath: string;
}

export const parseEnv = (env: NodeJS.ProcessEnv): AppConfig => {
  const parsed = rawEnvSchema.parse(env);

  return {
    ...parsed,
    corsOrigin: parsed.corsOrigin || undefined,
    authToken: parsed.authToken || undefined
  };
};

export const getRedactedConfigSummary = (config: AppConfig): Record<string, unknown> => ({
  host: config.host,
  port: config.port,
  basePath: config.basePath,
  pm2LogsDir: config.pm2LogsDir,
  apps: config.apps,
  bufferSize: config.bufferSize,
  maxHttpLimit: config.maxHttpLimit,
  readExistingOnStart: config.readExistingOnStart,
  filePollIntervalMs: config.filePollIntervalMs,
  maxLineLength: config.maxLineLength,
  sseHeartbeatMs: config.sseHeartbeatMs,
  enableCors: config.enableCors,
  corsOrigin: config.corsOrigin,
  logLevel: config.logLevel,
  authEnabled: Boolean(config.authToken)
});
