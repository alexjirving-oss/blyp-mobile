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
	try {
		const enabled = (value) =>
			['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
		const disabled = (value) =>
			['0', 'false', 'no', 'off'].includes(String(value ?? '').toLowerCase());
		const amplifyFlag = process.env?.EXPO_PUBLIC_ENABLE_AMPLIFY;
		if (disabled(amplifyFlag)) return false;
		if (enabled(amplifyFlag)) return true;
		if (enabled(process.env?.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH)) return true;
		const hostedUiDomain = String(process.env?.EXPO_PUBLIC_COGNITO_DOMAIN || '')
			.trim()
			.replace(/^https?:\/\//, '')
			.replace(/\/+$/, '');
		if (hostedUiDomain) return true;
		// Default ON so Cognito Hosted UI social can configure at boot once a
		// domain is supplied, without requiring a second flag flip.
		return amplifyFlag == null || String(amplifyFlag).trim() === '';
	} catch {
		return true;
	}
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

	// Hosted UI settings are public identifiers. Merge them at runtime as well
	// as build time so local dev and EAS use the same Cognito federation path.
	const hostedUiDomain = String(
		process.env?.EXPO_PUBLIC_COGNITO_DOMAIN
			|| awsconfig?.oauth?.domain
			|| ''
	)
		.trim()
		.replace(/^https?:\/\//, '')
		.replace(/\/+$/, '');
	if (hostedUiDomain) {
		const socialProviders = String(
			process.env?.EXPO_PUBLIC_SOCIAL_PROVIDERS || 'Google,Facebook,TikTok'
		).split(',').map((provider) => provider.trim()).filter(Boolean);
		awsconfig = {
			...awsconfig,
			aws_cognito_social_providers: socialProviders,
			oauth: {
				domain: hostedUiDomain,
				scope: ['openid', 'email', 'profile'],
				redirectSignIn:
					process.env?.EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_IN || 'blyp://auth/',
				redirectSignOut:
					process.env?.EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_OUT || 'blyp://auth/signout/',
				responseType: 'code',
			},
		};
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
