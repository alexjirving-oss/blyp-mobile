import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";

const DEFAULT_USER_POOL_ID = "eu-west-2_ITX07Zvnt";
const DEFAULT_CLIENT_ID = "4a7r115hllaedriqsjlsa00snj";

export type CognitoTokens = {
  idToken: string;
  accessToken: string;
  sub: string;
  expiresAt: number;
};

export class CognitoMfaRequiredError extends Error {
  readonly code = "MFA_REQUIRED" as const;
  readonly challengeName: string;
  readonly completeMfa: (otpCode: string) => Promise<CognitoTokens>;

  constructor(challengeName: string, completeMfa: (otpCode: string) => Promise<CognitoTokens>) {
    super("Multi-factor authentication required");
    this.name = "CognitoMfaRequiredError";
    this.challengeName = challengeName;
    this.completeMfa = completeMfa;
  }
}

function poolConfig() {
  const userPoolId =
    String(import.meta.env.VITE_COGNITO_USER_POOL_ID || DEFAULT_USER_POOL_ID).trim() ||
    DEFAULT_USER_POOL_ID;
  const clientId =
    String(import.meta.env.VITE_COGNITO_CLIENT_ID || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  return { userPoolId, clientId };
}

export function getUserPool(): CognitoUserPool {
  const { userPoolId, clientId } = poolConfig();
  return new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
}

function tokensFromSession(session: CognitoUserSession): CognitoTokens {
  const idToken = session.getIdToken().getJwtToken();
  const accessToken = session.getAccessToken().getJwtToken();
  const payload = session.getIdToken().decodePayload() as Record<string, unknown>;
  const sub = String(payload.sub || "").trim();
  const expSec = Number(payload.exp || 0);
  const expiresAt = expSec > 0 ? expSec * 1000 : Date.now() + 55 * 60 * 1000;

  if (!idToken || !sub) {
    throw new Error("Cognito sign-in did not return a usable token");
  }

  return { idToken, accessToken, sub, expiresAt };
}

/**
 * Cognito email/password sign-in.
 * Throws CognitoMfaRequiredError when the pool challenges for SOFTWARE_TOKEN_MFA / SMS_MFA
 * (enable MFA on the user pool, then enroll admins via Cognito console or associateSoftwareToken).
 */
export async function cognitoPasswordSignIn(
  email: string,
  password: string
): Promise<CognitoTokens> {
  const username = email.trim().toLowerCase();
  if (!username || !password) {
    throw new Error("Email and password are required");
  }

  const user = new CognitoUser({ Username: username, Pool: getUserPool() });
  const details = new AuthenticationDetails({ Username: username, Password: password });

  return new Promise<CognitoTokens>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => {
        try {
          resolve(tokensFromSession(session));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
      onFailure: (err) => reject(err instanceof Error ? err : new Error(String(err?.message || err))),
      newPasswordRequired: () =>
        reject(new Error("This account must set a new password in Cognito before admin access.")),
      mfaRequired: (challengeName: string) => {
        reject(
          new CognitoMfaRequiredError(challengeName, (otpCode: string) =>
            new Promise<CognitoTokens>((res, rej) => {
              const code = String(otpCode || "").trim();
              if (!/^\d{6}$/.test(code)) {
                rej(new Error("Enter the 6-digit authenticator code"));
                return;
              }
              user.sendMFACode(
                code,
                {
                  onSuccess: (session) => {
                    try {
                      res(tokensFromSession(session));
                    } catch (e) {
                      rej(e instanceof Error ? e : new Error(String(e)));
                    }
                  },
                  onFailure: (err) =>
                    rej(err instanceof Error ? err : new Error(String(err?.message || err))),
                },
                challengeName
              );
            })
          )
        );
      },
      totpRequired: () => {
        reject(
          new CognitoMfaRequiredError("SOFTWARE_TOKEN_MFA", (otpCode: string) =>
            new Promise<CognitoTokens>((res, rej) => {
              const code = String(otpCode || "").trim();
              if (!/^\d{6}$/.test(code)) {
                rej(new Error("Enter the 6-digit authenticator code"));
                return;
              }
              user.sendMFACode(
                code,
                {
                  onSuccess: (session) => {
                    try {
                      res(tokensFromSession(session));
                    } catch (e) {
                      rej(e instanceof Error ? e : new Error(String(e)));
                    }
                  },
                  onFailure: (err) =>
                    rej(err instanceof Error ? err : new Error(String(err?.message || err))),
                },
                "SOFTWARE_TOKEN_MFA"
              );
            })
          )
        );
      },
    });
  });
}
