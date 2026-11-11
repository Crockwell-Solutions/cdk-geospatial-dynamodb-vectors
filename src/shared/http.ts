import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CACHE_SECONDS, JSON_HEADERS } from './consts';
import { logger } from './logger';

export function json(statusCode: number, body: unknown, cacheSeconds = CACHE_SECONDS.none): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
    body: JSON.stringify(body),
  };
}

export const notFound = (message: string): APIGatewayProxyResult => json(404, { message });
export const badRequest = (message: string): APIGatewayProxyResult => json(400, { message });

/**
 * Reads a path parameter. API Gateway may hand it over still percent-encoded
 * (flight ids contain `#`), so decode defensively.
 */
export function pathParameter(event: APIGatewayProxyEvent, name: string): string | undefined {
  const raw = event.pathParameters?.[name];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Parses an optional numeric query parameter, enforcing a range. Throws a RangeError with a client-safe message. */
export function numberParameter(
  event: APIGatewayProxyEvent,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = event.queryStringParameters?.[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < range.min || value > range.max) {
    throw new RangeError(`${name} must be a number between ${range.min} and ${range.max}`);
  }
  return value;
}

/** DynamoDB error names that mean "the table or its vector index is not ready yet" */
const NOT_READY_ERRORS = new Set(['ResourceNotFoundException', 'ValidationException']);

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/** Wraps a handler with consistent logging and error responses. */
export function apiHandler(handler: Handler): Handler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      if (error instanceof RangeError) return badRequest(error.message);
      const name = error instanceof Error ? error.name : 'UnknownError';
      logger.error('Request failed', { error, path: event.path });
      if (NOT_READY_ERRORS.has(name)) {
        return json(503, {
          message:
            'The flights table or its vector index is not ready. Check that the index is ACTIVE and the data has been loaded.',
          error: name,
        });
      }
      return json(500, { message: 'Internal server error' });
    }
  };
}
