import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * HTTP basic auth for the docs routes. Credentials come from env
 * (SWAGGER_USER / SWAGGER_PASSWORD), never from code; comparison is
 * constant-time.
 */
export function swaggerBasicAuth(user: string, password: string, realm = 'API docs') {
  const expected = digest(`${user}:${password}`);
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const given = digest(Buffer.from(encoded, 'base64').toString('utf8'));
      if (timingSafeEqual(given, expected)) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).send('Authentication required');
  };
}
