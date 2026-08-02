import { Request, Response, NextFunction } from 'express';
import { verifyCognitoJwt } from './verifyCognitoJwt';
import { sanitizeBearerAuthorization } from '../utils/headerSanitize';

export interface AuthedRequest extends Request {
  user?: { sub: string; [k: string]: any };
}

export function cognitoJwtMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  // Fail closed: never accept credentials from the query string.
  if (
    typeof req.query?.access_token === 'string' ||
    typeof req.query?.id_token === 'string' ||
    typeof req.query?.token === 'string'
  ) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      code: 'QUERY_TOKEN_REJECTED',
      detail: 'tokens must be sent in the Authorization Bearer header',
    });
  }

  const authHeader = sanitizeBearerAuthorization(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = match[1];

  verifyCognitoJwt(token)
    .then((decoded: unknown) => {
      req.user = decoded as any;
      next();
    })
    .catch((err: any) => {
      const isMisconfig = typeof err?.message === 'string' && err.message.includes('COGNITO_REGION');
      return res.status(isMisconfig ? 500 : 401).json({
        error: isMisconfig ? 'Auth misconfigured' : 'Invalid token',
        detail: err?.message,
      });
    });
}
