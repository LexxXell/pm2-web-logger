import { HttpError } from '../utils/http-error.js';

const BEARER_PREFIX = 'Bearer ';

export const assertBearerAuth = (
  expectedToken: string | undefined,
  authorizationHeader: string | undefined
): void => {
  if (!expectedToken) {
    return;
  }

  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Missing bearer token');
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length);

  if (token !== expectedToken) {
    throw new HttpError(401, 'AUTH_INVALID', 'Invalid bearer token');
  }
};
