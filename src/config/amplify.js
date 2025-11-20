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

const shouldEnableAmplify = (() => {
	try { return ['1','true','yes'].includes(String(process.env?.EXPO_PUBLIC_ENABLE_AMPLIFY ?? '').toLowerCase()); } catch { return false; }
})();

if (!shouldEnableAmplify || !Amplify) {
	console.log('[Amplify] Disabled via EXPO_PUBLIC_ENABLE_AMPLIFY flag');
} else {
	// Guard missing or malformed aws-exports; avoid throwing during deferred import.
	let awsconfig = {};
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
		const cfg = require('../aws-exports');
		awsconfig = cfg?.default || cfg || {};
	} catch (e) {
		console.warn('[Amplify] aws-exports not found; skipping configuration');
	}

	// Only configure Amplify when we have a plausible config (presence of at least one expected key)
	try {
		const hasKey = awsconfig && typeof awsconfig === 'object' && (
			awsconfig.aws_project_region || awsconfig.aws_cognito_region || awsconfig.aws_user_pools_id
		);
		if (hasKey) {
			try { Amplify.configure(awsconfig); console.log('✅ Amplify configured'); } catch (e) { console.warn('[Amplify] configure exception:', e?.message || e); }
		} else {
			console.warn('[Amplify] configuration skipped (no region/user pool keys)');
		}
	} catch (e) {
		console.warn('[Amplify] configure failed:', e?.message || e);
	}
}
