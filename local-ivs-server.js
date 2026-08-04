/**
 * Local IVS Backend Server
 * 
 * Development server for testing IVS Real-Time token provisioning.
 * Issues real AWS IVS participant tokens when configured with AWS credentials + Stage ARN.
 * Falls back to mock tokens if misconfigured.
 * 
 * USAGE:
 *   1. Set env vars (see .env.ivs-local)
 *   2. node local-ivs-server.js
 * 
 * ENDPOINT:
 *   POST http://localhost:3001/api/ivs/host-start
 *   Authorization: Bearer <cognito-id-token>
 *   Body: { streamId?: string, devLabel?: string }
 * 
 * RESPONSE:
 *   { ok: true, stageArn, token, expiresAt, issuedBy: 'aws'|'mock'|'mock-fallback' }
 */

const path = require('path');
const http = require('http');
const url = require('url');

// Load .env.ivs-local if present (dotenv support)
try {
  require('dotenv').config({
    path: path.resolve(__dirname, '.env.ivs-local'),
  });
} catch (e) {
  // dotenv not installed; env vars must be set manually
}

// Configuration from environment
const PORT = 3001;
const HOST = '0.0.0.0';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
const IVS_STAGE_ARN = process.env.IVS_STAGE_ARN;
const IVS_PLAYBACK_BASE_URL = process.env.IVS_PLAYBACK_BASE_URL;
const IVS_DEV_BYPASS = process.env.IVS_DEV_BYPASS === '1';

// FATAL: Stage ARN is required
if (!IVS_STAGE_ARN) {
  console.error('[IVS_LOCAL][FATAL] IVS_STAGE_ARN is missing.');
  console.error('  Set IVS_STAGE_ARN in .env.ivs-local or as an environment variable.');
  console.error('  Example: IVS_STAGE_ARN=arn:aws:ivs:us-east-1:ACCOUNT:stage/STAGEID');
  process.exit(1);
}

// Load AWS SDK for real token generation
let IvsRealtimeClient;
let CreateParticipantTokenCommand;
let sdkLoadError;

try {
  const sdk = require('@aws-sdk/client-ivs-realtime');
  IvsRealtimeClient = sdk.IVSRealTimeClient;
  CreateParticipantTokenCommand = sdk.CreateParticipantTokenCommand;
} catch (err) {
  sdkLoadError = err.message;
}

// Determine if we can issue real tokens
const hasExplicitCredentials = Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
const hasStagARN = Boolean(IVS_STAGE_ARN);
const hasSDK = Boolean(IvsRealtimeClient && CreateParticipantTokenCommand);
const realTokensEnabled = !IVS_DEV_BYPASS && hasStagARN && hasSDK;
// Note: credentials can be explicit (in env) or from default AWS profile

let ivsClient = null;
if (realTokensEnabled) {
  // Build credentials object only if explicitly set; otherwise AWS SDK uses default chain
  const clientConfig = { region: AWS_REGION };
  if (hasExplicitCredentials) {
    clientConfig.credentials = AWS_SESSION_TOKEN
      ? { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY, sessionToken: AWS_SESSION_TOKEN }
      : { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
  }
  ivsClient = new IvsRealtimeClient(clientConfig);
}

// Startup logging
console.log('\n' + '='.repeat(70));
console.log('🚀 Local IVS Backend Server');
console.log('='.repeat(70));
console.log(`   Port: ${PORT}`);
console.log(`   Region: ${AWS_REGION}`);
const stageMask = IVS_STAGE_ARN 
  ? '...' + IVS_STAGE_ARN.slice(-6)
  : '(not set)';
console.log(`   Stage ARN: ${stageMask}`);
console.log(`   Credentials: ${hasExplicitCredentials ? 'configured' : 'using default profile'}`);

if (realTokensEnabled) {
  console.log('\n✅ [IVS_LOCAL] Real IVS tokens: ENABLED');
  if (hasExplicitCredentials) {
    console.log('   AWS credentials: from .env.ivs-local');
  } else {
    console.log('   AWS credentials: from default profile (aws configure)');
  }
  console.log('   AWS SDK: loaded');
  console.log('   Stage ARN: ' + IVS_STAGE_ARN);
} else {
  console.log('\n⚠️  [IVS_LOCAL] Real IVS tokens: DISABLED (fallback to mock)');
  if (IVS_DEV_BYPASS) console.log('   Reason: IVS_DEV_BYPASS=1');
  if (!hasStagARN) console.log('   Reason: IVS_STAGE_ARN not set');
  if (!hasSDK) console.log(`   Reason: AWS SDK not loaded (${sdkLoadError || 'unknown'})`);
  if (realTokensEnabled === false && hasStagARN && hasSDK && !IVS_DEV_BYPASS) {
    console.log('   Reason: AWS credentials not available (configure via `aws configure` or set env vars)');
  }
}
console.log('='.repeat(70) + '\n');

// Helper: decode JWT without verification (just for demo)
function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload;
  } catch (err) {
    throw new Error(`Failed to decode JWT: ${err.message}`);
  }
}

// Generate mock IVS token
function generateMockIvsToken() {
  // Format: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.{payload}.{signature}
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600; // 1 hour
  const payload = Buffer.from(JSON.stringify({
    sub: 'mock-participant-id',
    aud: 'realtime',
    exp: expiresAt,
    iat: now,
  })).toString('base64');
  const signature = Buffer.from('mock-signature').toString('base64');
  return `${header}.${payload}.${signature}`;
}

// Issue a participant token using AWS IVS Real-Time, or fall back to mock
async function issueParticipantToken({ userId, streamId, stageArn }) {
  const fallback = () => ({
    token: generateMockIvsToken(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    issuedBy: 'mock',
  });

  if (!ivsClient) {
    console.warn('[LOCAL-IVS] Using mock token (no IVS client available)');
    return fallback();
  }

  try {
    const cmd = new CreateParticipantTokenCommand({
      stageArn,
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      userId: String(userId || 'local-user'),
      duration: 3600,
      attributes: { streamId },
    });
    const { participantToken } = await ivsClient.send(cmd);
    if (!participantToken?.token) {
      throw new Error('IVS did not return a participant token');
    }
    return {
      token: participantToken.token,
      expiresAt: participantToken.expirationTime
        ? new Date(participantToken.expirationTime).toISOString()
        : new Date(Date.now() + 3600000).toISOString(),
      issuedBy: 'aws',
    };
  } catch (err) {
    console.error('[LOCAL-IVS] Failed to create participant token via AWS; falling back to mock', err);
    return {
      ...fallback(),
      issuedBy: 'mock-fallback',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Request handler
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Health check
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'local-ivs-server' }));
    return;
  }

  // IVS host-start endpoint
  if (pathname === '/api/ivs/host-start' && req.method === 'POST') {
    console.log('[HOST_START] Received request');

    try {
      // Extract Cognito token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new Error('Missing Authorization header');
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        throw new Error('Invalid Authorization header format (expected: Bearer <token>)');
      }

      const cognitoToken = match[1];
      console.log(`[HOST_START] Token length: ${cognitoToken.length}`);

      // Decode Cognito token to get user ID
      let userId = 'unknown-user';
      try {
        const decoded = decodeJwt(cognitoToken);
        userId = decoded.sub || decoded.username || decoded.cognito_username || 'unknown-user';
        console.log(`[HOST_START] Decoded user: ${userId}`);
      } catch (err) {
        console.warn(`[HOST_START] Could not decode token: ${err.message}`);
      }

      // Parse request body
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'));
            } catch (err) {
              reject(err);
            }
          });
        });
      }

      // Generate response
      const streamId = body.streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const stageArn = body.stageArnOverride || IVS_STAGE_ARN;
      
      if (!stageArn) {
        throw new Error('No Stage ARN configured; set IVS_STAGE_ARN env var');
      }

      const { token: ivsToken, expiresAt, issuedBy, error: tokenError } = await issueParticipantToken({
        userId,
        streamId,
        stageArn,
      });

      const response = {
        ok: true,
        role: 'host',
        userId,
        streamId,
        stageArn,
        region: AWS_REGION,
        token: ivsToken,
        expiresAt,
        issuedBy,
        tokenError,
      };

      console.log(`[HOST_START] ✓ Success - returning token for user ${userId} (issued by: ${issuedBy})`);
      res.writeHead(200);
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error(`[HOST_START] ✗ Error: ${error.message}`);
      res.writeHead(400);
      res.end(JSON.stringify({
        ok: false,
        role: 'host',
        userId: '',
        streamId: '',
        error: error.message,
      }));
    }
    return;
  }

  // IVS viewer-join endpoint (for viewers to get participant token)
  if (pathname === '/api/ivs/viewer-join' && req.method === 'POST') {
    console.log('[VIEWER_JOIN] Received request');

    try {
      // Extract Cognito token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new Error('Missing Authorization header');
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        throw new Error('Invalid Authorization header format (expected: Bearer <token>)');
      }

      const cognitoToken = match[1];
      console.log(`[VIEWER_JOIN] Token length: ${cognitoToken.length}`);

      // Decode Cognito token to get user ID
      let userId = 'unknown-viewer';
      try {
        const decoded = decodeJwt(cognitoToken);
        userId = decoded.sub || decoded.username || decoded.cognito_username || 'unknown-viewer';
        console.log(`[VIEWER_JOIN] Decoded user: ${userId}`);
      } catch (err) {
        console.warn(`[VIEWER_JOIN] Could not decode token: ${err.message}`);
      }

      // Parse request body
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'));
            } catch (err) {
              reject(err);
            }
          });
        });
      }

      const streamId = body.streamId;
      if (!streamId) {
        throw new Error('Missing streamId in request body');
      }

      const stageArn = body.stageArnOverride || IVS_STAGE_ARN;
      
      if (!stageArn) {
        throw new Error('No Stage ARN configured; set IVS_STAGE_ARN env var');
      }

      const { token: ivsToken, expiresAt, issuedBy, error: tokenError } = await issueParticipantToken({
        userId,
        streamId,
        stageArn,
      });

      const response = {
        ok: true,
        role: 'viewer',
        userId,
        streamId,
        stageArn,
        region: AWS_REGION,
        token: ivsToken,
        expiresAt,
        issuedBy,
        tokenError,
      };

  console.log(`[VIEWER_JOIN] ✓ Success - returning Real-Time stage token for viewer ${userId} (issued by: ${issuedBy})`);
      res.writeHead(200);
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error(`[VIEWER_JOIN] ✗ Error: ${error.message}`);
      res.writeHead(400);
      res.end(JSON.stringify({
        ok: false,
        role: 'viewer',
        userId: '',
        streamId: '',
        error: error.message,
      }));
    }
    return;
  }

  // Not found
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));

});

server.listen(PORT, HOST, () => {
  console.log(`✓ Listening on http://localhost:${PORT}`);
  console.log(`✓ POST /api/ivs/host-start ready`);
  console.log(`✓ POST /api/ivs/viewer-join ready`);
  console.log(`✓ GET  /health ready`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
