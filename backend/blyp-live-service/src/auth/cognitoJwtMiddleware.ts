import type { NextFunction, Response } from 'express';
import { ApiError, PlatformRequest, sendApiError } from '../platform/apiContract';
import { sanitizeBearerAuthorization } from '../utils/headerSanitize';
import { verifyCognitoJwt, VerifiedCognitoClaims } from './verifyCognitoJwt';

export interface AuthedRequest extends PlatformRequest {
  user?: VerifiedCognitoClaims;
}

function isConfigurationError(error: unknown) {
  return error instanceof Error && error.message.startsWith('[config]');
}

export function cognitoJwtMiddleware(req: PlatformRequest, res: Response, next: NextFunction) {
  const authHeader = sanitizeBearerAuthorization(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return sendApiError(
      req,
      res,
      new ApiError(401, 'AUTH_REQUIRED', 'A valid Cognito access token is required.')
    );
  }

  verifyCognitoJwt(match[1], { tokenUse: 'access' })
    .then((claims) => {
      req.user = claims;
      next();
    })
    .catch((error: unknown) => {
      if (isConfigurationError(error)) {
        return sendApiError(
          req,
          res,
          new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is temporarily unavailable.')
        );
      }
      return sendApiError(
        req,
        res,
        new ApiError(401, 'AUTH_INVALID', 'The authentication token is invalid or expired.')
      );
    });
}
