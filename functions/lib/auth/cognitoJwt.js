"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractBearerToken = extractBearerToken;
exports.verifyCognitoIdToken = verifyCognitoIdToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
const getCognitoVerifier = (() => {
    let client = null;
    let issuer = null;
    return () => {
        const cognitoRegion = process.env.COGNITO_REGION;
        const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
        if (!cognitoRegion || !cognitoUserPoolId) {
            throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
        }
        if (!client) {
            const jwksUri = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`;
            client = (0, jwks_rsa_1.default)({
                jwksUri,
                cache: true,
                cacheMaxEntries: 10,
                cacheMaxAge: 10 * 60 * 1000,
            });
            issuer = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`;
        }
        return { client, issuer };
    };
})();
function getKey(header, callback) {
    try {
        const { client } = getCognitoVerifier();
        client.getSigningKey(header.kid, function (err, key) {
            var _a;
            if (err) {
                callback(err);
                return;
            }
            const signingKey = (_a = key === null || key === void 0 ? void 0 : key.getPublicKey) === null || _a === void 0 ? void 0 : _a.call(key);
            callback(null, signingKey);
        });
    }
    catch (e) {
        callback(e);
    }
}
function extractBearerToken(authHeader) {
    const header = String(authHeader || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        throw new Error('Missing or invalid Authorization header');
    }
    return match[1];
}
async function verifyCognitoIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') {
        throw new Error('Invalid Cognito token');
    }
    const { issuer } = getCognitoVerifier();
    const decoded = await new Promise((resolve, reject) => {
        jsonwebtoken_1.default.verify(idToken, getKey, {
            algorithms: ['RS256'],
            issuer: issuer || undefined,
        }, (err, payload) => {
            if (err)
                reject(err);
            else
                resolve(payload);
        });
    });
    const sub = String((decoded === null || decoded === void 0 ? void 0 : decoded.sub) || '').trim();
    if (!sub) {
        throw new Error('Invalid token: missing sub');
    }
    return decoded;
}
//# sourceMappingURL=cognitoJwt.js.map