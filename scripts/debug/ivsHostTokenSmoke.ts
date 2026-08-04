/**
 * IVS Host Token Smoke Test (Dev-Only)
 * 
 * Quick verification that AWS IVS Realtime token generation works.
 * Tests the backend token generation logic in isolation.
 * 
 * Usage:
 *   npm run debug:ivs-host-token
 * 
 * Environment Variables Required:
 *   - AWS_REGION (e.g., eu-west-1)
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - IVS_REALTIME_STAGE_ARN (valid ARN for your AWS account)
 * 
 * Exit Codes:
 *   0 = Success (token generated)
 *   1 = Failure (see error log above)
 */

// NOTE: This is a dev-only debug script and MUST NOT be imported in production code paths

import { getRegionFromStageArn, ivsRealtime } from '../../functions/src/services/ivsService';

async function smokeTest() {
  console.log('\n' + '='.repeat(70));
  console.log('IVS Host Token Smoke Test');
  console.log('='.repeat(70) + '\n');

  // 1. Check environment
  const region = process.env.AWS_REGION;
  const stageArn = process.env.IVS_REALTIME_STAGE_ARN;

  console.log('[SMOKE] Environment Check');
  console.log(`  AWS_REGION: ${region ? '✓ set' : '✗ MISSING'}`);
  console.log(`  IVS_REALTIME_STAGE_ARN: ${stageArn ? '✓ set' : '✗ MISSING'}`);

  if (!region) {
    console.error('\n✗ FAIL: AWS_REGION not set');
    return false;
  }

  if (!stageArn) {
    console.error('\n✗ FAIL: IVS_REALTIME_STAGE_ARN not set');
    return false;
  }

  // 2. Parse region from stage ARN
  console.log('\n[SMOKE] Stage ARN Parsing');
  let parsedRegion: string;
  try {
    parsedRegion = getRegionFromStageArn(stageArn);
    console.log(`  Parsed region from ARN: ${parsedRegion}`);

    // Mask the ARN in output (show only region and stage ID)
    const arnParts = stageArn.split(':');
    const stageId = arnParts[5]?.split('/')[1] || 'unknown';
    console.log(`  Stage ARN (masked): arn:aws:ivs:${parsedRegion}:<account>:stage/${stageId}`);
  } catch (error) {
    console.error(`  ✗ Failed to parse ARN: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  // 3. Create a test token
  console.log('\n[SMOKE] Token Generation');
  const testUserId = `smoke-test-user-${Date.now()}`;
  console.log(`  Test user ID: ${testUserId}`);
  console.log(`  Role: PUBLISHER (host)`);

  try {
    const tokenResponse = await ivsRealtime.createParticipantToken({
      userId: testUserId,
      stageArn: stageArn,
      role: 'PUBLISHER',
      durationSeconds: 3600,
    });

    console.log(`\n  ✓ Token generated successfully`);
    console.log(`  Token length: ${tokenResponse.token.length} chars`);
    console.log(`  Expiration: ${new Date(tokenResponse.expiresAt).toISOString()}`);
    console.log(`  Region: ${tokenResponse.region}`);

    // Verify token is a JWT-like string (3 parts separated by dots)
    const parts = tokenResponse.token.split('.');
    if (parts.length !== 3) {
      console.error(`  ⚠️  Warning: Token has ${parts.length} parts, expected 3 (invalid JWT structure)`);
    } else {
      console.log(`  ✓ Token structure valid (JWT format: header.payload.signature)`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✓ SMOKE TEST PASSED');
    console.log('='.repeat(70) + '\n');
    return true;
  } catch (error) {
    console.error(`\n  ✗ Token generation failed:`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);

    if (error instanceof Error && error.stack) {
      console.error(`\n  Stack trace:`);
      console.error(error.stack);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✗ SMOKE TEST FAILED');
    console.log('='.repeat(70));
    console.log('\nTroubleshooting:');
    console.log('  1. Verify AWS credentials are configured correctly');
    console.log('  2. Verify IVS_REALTIME_STAGE_ARN is valid and exists in your AWS account');
    console.log('  3. Verify stage ARN matches the region in AWS_REGION');
    console.log('  4. Check AWS CloudWatch logs for more details');
    console.log();

    return false;
  }
}

// Run the smoke test
smokeTest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
