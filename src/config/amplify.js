// Ensure React Native polyfills for Amplify are loaded before configuring
import 'react-native-get-random-values';
// Guard Amplify RN shim: if missing, fail soft.
let amplifyShimLoaded = false;
try {
	// eslint-disable-next-line import/no-extraneous-dependencies
	require('@aws-amplify/react-native');
	amplifyShimLoaded = true;
} catch (e) {
	console.warn('[Amplify] @aws-amplify/react-native not installed; continuing without shim');
}
let Amplify = null;
try { Amplify = require('aws-amplify').Amplify; } catch (e) { console.warn('[Amplify] aws-amplify package missing'); }

const LOCKED_USER_POOL_WEB_CLIENT_ID = '4a7r115hllaedriqsjlsa00snj';

const shouldEnableAmplify = (() => {
	try { return ['1', 'true', 'yes'].includes(String(process.env?.EXPO_PUBLIC_ENABLE_AMPLIFY ?? '').toLowerCase()); } catch { return false; }
})();

if (!shouldEnableAmplify || !Amplify) {
	console.log('[Amplify] Disabled via EXPO_PUBLIC_ENABLE_AMPLIFY flag or aws-amplify not available');
} else {
	// Try aws-exports first, fall back to environment variables for Cognito config
	let awsconfig = {};
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
		const cfg = require('../aws-exports');
		awsconfig = cfg?.default || cfg || {};
	} catch (e) {
		console.warn('[Amplify] aws-exports not found; falling back to env vars');
	}

	// If aws-exports is missing or incomplete, build config from env vars
	if (!awsconfig || !awsconfig.aws_user_pools_id) {
		const envRegion = process.env.EXPO_PUBLIC_AWS_COGNITO_REGION || process.env.EXPO_PUBLIC_AWS_REGION || 'eu-west-2';
		const envUserPoolId = process.env.EXPO_PUBLIC_AWS_USER_POOL_ID;
		const envUserPoolWebClientId = process.env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID;
		if (envUserPoolWebClientId && envUserPoolWebClientId !== LOCKED_USER_POOL_WEB_CLIENT_ID) {
			console.warn('[Amplify][AUTH][LOCK] Ignoring mismatched EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID from env');
		}

		if (envUserPoolId) {
			console.log('[Amplify] Building config from env vars');
			awsconfig = {
				aws_project_region: envRegion,
				aws_cognito_region: envRegion,
				aws_user_pools_id: envUserPoolId,
				aws_user_pools_web_client_id: LOCKED_USER_POOL_WEB_CLIENT_ID,
			};
		}
	}

	// Only configure Amplify when we have a plausible config (presence of at least one expected key)
	try {
		const hasKey = awsconfig && typeof awsconfig === 'object' && (
			awsconfig.aws_project_region || awsconfig.aws_cognito_region || awsconfig.aws_user_pools_id
		);
		if (hasKey) {
			try {
				Amplify.configure(awsconfig);
				console.log('[Amplify] ✅ Configured with region:', awsconfig.aws_project_region || awsconfig.aws_cognito_region);
			} catch (e) {
				console.warn('[Amplify] configure exception:', e?.message || e);
			}
		} else {
			console.warn('[Amplify] configuration skipped (no region/user pool keys found in aws-exports or env vars)');
		}
	} catch (e) {
		console.warn('[Amplify] configure failed:', e?.message || e);
	}
}
