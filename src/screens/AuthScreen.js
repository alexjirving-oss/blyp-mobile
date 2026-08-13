import React, { useState, useRef } from 'react';
import BlueScreen from '../ui/BlueScreen';
import { ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { mapAuthError } from '../lib/auth/errors';
import {
  getPasswordRequirementChecks,
  isPasswordPolicySatisfied,
  PASSWORD_REQUIREMENTS_SUMMARY,
} from '../lib/auth/passwordPolicy';
import {
  generateOpaqueCognitoUsername,
  isEmailAliasUsernameError,
  isSignupAttributeRejection,
} from '../lib/auth/cognitoUsername';
import BlypLogo from '../components/BlypLogo';
import { COLORS } from '../styles/theme';
import awsconfig from '../aws-exports';
import { userPool, clearCognitoSessions, refreshAuthNow } from '../hooks/useCommon';
import { flushCognitoStorageWrites } from '../lib/auth/cognitoStorage';
import { ensureUserProfile } from '../services/LiveService';
import {
  claimPendingUsernameIfNeeded,
  clearPendingProfile,
  rememberPendingProfile,
  validateUsername,
} from '../services/usernameProfileService';

const MIN_SIGNUP_AGE = 13;

// Parse a DD/MM/YYYY string and return { valid, age, iso } where age is whole years.
function parseDob(input) {
  const m = String(input || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { valid: false };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { valid: false };
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return { valid: false };
  const now = new Date();
  if (d > now) return { valid: false };
  let age = now.getFullYear() - year;
  const beforeBirthday = now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { valid: true, age, iso };
}

const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState(''); // signup age gate, DD/MM/YYYY
  const [loading, setLoading] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmUsername, setConfirmUsername] = useState('');
  const [lastError, setLastError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [suggestReset, setSuggestReset] = useState(false);
  const [accountExists, setAccountExists] = useState(undefined); // undefined=unknown, true/false known
  const [lockoutDetected, setLockoutDetected] = useState(false);

  // TODO[BLYP][UX]: Future onboarding polish:
  //  - Consider one-line tagline under logo
  //  - Optional "By continuing you agree to …" legal line at bottom of screen
  //  - A/B test sign-in vs sign-up default focus

  const loginStartRef = useRef(null);

  const [showRawError, setShowRawError] = useState(false);
  const [rawErrorObj, setRawErrorObj] = useState(null);

  const recordError = (err) => {
    try {
      setRawErrorObj(err);
      const code = err?.code || err?.name;
      const msg = err?.message || String(err);
      console.warn('[BLYP][AUTH][ERROR]', code, msg);
    } catch { }
  };

  const maskEmail = (raw) => {
    try {
      if (!raw) return '';
      const trimmed = String(raw).trim();
      const [user, domain] = trimmed.split('@');
      if (!domain) return user.slice(0, 2) + '***';
      return user.slice(0, 2) + '***@' + domain;
    } catch {
      return '***';
    }
  };

  // Auto-format date of birth as the user types: digits only, with slashes
  // inserted automatically -> DD/MM/YYYY. Backspacing works naturally because
  // we recompute from the raw digits each change.
  const handleDobChange = (text) => {
    const digits = String(text || '').replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    setDob(formatted);
  };

  // Unified success handler for password login and confirmed signup
  const handleAuthSuccess = async (source, context = {}) => {
    try {
      console.log('[AUTH][SUCCESS]', source, {
        at: new Date().toISOString(),
        email: maskEmail(email),
        contextKeys: Object.keys(context || {}),
      });
      if (loginStartRef.current) {
        const durationMs = Date.now() - loginStartRef.current;
        console.log('[AUTH][METRICS] Login success duration(ms):', durationMs);
        loginStartRef.current = null;
      }

      // Lift auth state immediately if we have a CognitoUser reference
      if (context?.cognitoUser) {
        try { refreshAuthNow?.(context.cognitoUser); } catch { }
      }

      // Ensure Cognito tokens/session have actually been persisted to AsyncStorage.
      // This reduces "logged-in then suddenly logged-out" behavior after dev-client reloads.
      // Important: don't delay refreshAuthNow behind this flush.
      try {
        await flushCognitoStorageWrites({ timeoutMs: 5000 });
      } catch { }

      // Ensure Firestore profile exists for ALL users (not just hosts)
      // so comments and directory cards can resolve usernames reliably.
      try {
        const tokens = context?.tokens;
        const payload = tokens?.getIdToken?.()?.payload || null;
        const sub = String(payload?.sub || '').trim();
        const emailFromToken = String(payload?.email || '').trim();
        const pictureFromToken = String(payload?.picture || '').trim();
        // preferred_username only — NEVER cognito:username (opaque UUID in alias pools).
        const preferredUsernameRaw = String(payload?.preferred_username || '').trim();
        const nameFromToken = String(payload?.name || '').trim();
        const looksOpaque = (v) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
        const preferredUsername =
          preferredUsernameRaw && !looksOpaque(preferredUsernameRaw) && preferredUsernameRaw !== sub
            ? preferredUsernameRaw
            : '';
        const safeNameFromToken =
          nameFromToken && !looksOpaque(nameFromToken) && nameFromToken !== sub ? nameFromToken : '';

        // On signup, we have an explicit username field in the UI; store it.
        // On login, don't overwrite an existing username, but we still ensure displayName.
        const usernameToStore = String(username || '').trim().replace(/^@/, '');

        const userId = sub;
        if (userId) {
          const dobParsedForProfile = parseDob(dob);
          const screenName =
            usernameToStore ||
            preferredUsername ||
            safeNameFromToken ||
            (emailFromToken ? emailFromToken.split('@')[0] : '');
          await ensureUserProfile({
            userId,
            displayName: screenName || null,
            // Important: pass `undefined` for missing optional fields so we don't wipe existing profile data.
            photoURL: pictureFromToken || undefined,
            email: emailFromToken || undefined,
            username: usernameToStore || preferredUsername || undefined,
            // Persist age attestation collected at sign-up (undefined on login so we don't overwrite).
            birthdate: dobParsedForProfile.valid ? dobParsedForProfile.iso : undefined,
            ageVerified: dobParsedForProfile.valid ? true : undefined,
          });
          // Claim the @handle chosen at signup here — the only username collection
          // step. Never leave a post-login overlay to re-prompt on later launches.
          // Never use the signup form field on a plain password login (toggle residue).
          try {
            const formUsernameForClaim =
              source === 'confirm_auto_login' ? usernameToStore : '';
            await claimPendingUsernameIfNeeded({
              uid: userId,
              email: emailFromToken || String(email || '').trim().toLowerCase() || undefined,
              photoURL: pictureFromToken || undefined,
              username: formUsernameForClaim || undefined,
            });
          } catch (claimError) {
            // Do not hand off to a post-login overlay. Clear pending so cold starts
            // never re-open a username UI; user can set a handle in Edit Profile.
            console.warn(
              '[AUTH][SUCCESS] username claim failed; clearing pending (no overlay)',
              claimError?.code || claimError?.message || claimError,
            );
            try {
              await clearPendingProfile();
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        // Non-fatal: auth should still succeed even if profile write fails.
      }
      // Clear signing flags
      setIsSigningIn(false);
      setLoading(false);
      // Clear confirmation flow state (only relevant for signup/confirm path)
      if (needsConfirm) {
        setNeedsConfirm(false);
        setConfirmCode('');
        setConfirmEmail('');
        setConfirmUsername('');
      }
      // Basic cooldown to prevent rapid re-entry taps after success
      setCooldownUntil(Date.now() + 1500);
    } catch (e) {
      console.warn('[AUTH][SUCCESS][WARN] Post-success cleanup failed', e?.message || e);
    }
  };

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const emailNorm = String(email || '').trim().toLowerCase();
    console.log('ðŸ” Auth attempt:', isLogin ? 'LOGIN' : 'SIGNUP', maskEmail(emailNorm));

    try {
      // Forgot password flow (change password after code)
      if (resetMode && resetCode.trim() && newPassword.trim()) {
        if (!isPasswordPolicySatisfied(newPassword.trim())) {
          Alert.alert('Choose a stronger password', PASSWORD_REQUIREMENTS_SUMMARY);
          setLoading(false);
          return;
        }
        setLoading(true);
        const emailToReset = emailNorm;
        const cognitoUser = new CognitoUser({ Username: emailToReset, Pool: userPool });
        console.log('ðŸ” Reset attempt (confirm new password)', maskEmail(emailToReset));
        cognitoUser.confirmPassword(resetCode.trim(), newPassword.trim(), {
          onSuccess: () => {
            console.log('âœ… Password reset success');
            Alert.alert('Password Reset', 'Your password has been updated. Please log in.');
            setResetMode(false);
            setResetCode('');
            setNewPassword('');
            setLoading(false);
          },
          onFailure: (err) => {
            console.error('âŒ Password reset failed:', err);
            setLastError(err?.message || String(err));
            Alert.alert('Reset Error', err?.message || 'Could not reset password.');
            setLoading(false);
          }
        });
        return;
      }
      if (needsConfirm) {
        // Confirm code then auto-login
        const emailToConfirm = String(confirmEmail || emailNorm).trim().toLowerCase();
        // For email-alias pools, confirmation must target the opaque username the user was
        // created under. Fall back to the email to preserve resend/re-signup edge cases.
        const usernameToConfirm = String(confirmUsername || emailToConfirm).trim();
        const cognitoUser = new CognitoUser({ Username: usernameToConfirm, Pool: userPool });
        cognitoUser.confirmRegistration(confirmCode.trim(), true, (err, result) => {
          const proceedToLogin = () => {
            // After confirmation the email alias is active, so auto-login uses a FRESH
            // CognitoUser built with the email to avoid a username/details mismatch.
            const loginUser = new CognitoUser({ Username: emailNorm, Pool: userPool });
            const authDetails = new AuthenticationDetails({ Username: emailNorm, Password: password });
            loginUser.authenticateUser(authDetails, {
              onSuccess: (result) => {
                console.log('âœ… Auto-login after confirm');
                handleAuthSuccess('confirm_auto_login', { cognitoUser: loginUser, tokens: result });
              },
              onFailure: (loginErr) => {
                console.error('âŒ Login failed after confirm:', loginErr);
                setLastError(loginErr?.message || String(loginErr));
                Alert.alert('Authentication Error', loginErr.message);
                setLoading(false);
              }
            });
          };

          if (err) {
            // Handle "already confirmed" gracefully
            const msg = err?.message || '';
            if (/current status is CONFIRMED/i.test(msg) || msg.toLowerCase().includes('status is confirmed')) {
              console.warn('[BLYP][AUTH] User already confirmed; continuing to login.');
              proceedToLogin();
              return;
            }
            console.error('âŒ Confirmation failed:', err);
            setLastError(msg || String(err));
            Alert.alert('Confirmation Error', msg);
            setLoading(false);
            return;
          }
          console.log('âœ… Confirmation success:', result);
          proceedToLogin();
        });
      } else if (isLogin) {
        // Sign in
        console.log(
          '[AUTH][UI] Login button pressed at',
          new Date().toISOString(),
          { isLogin, isSigningIn }
        );
        if (isSigningIn) {
          console.log('[AUTH] Ignoring duplicate sign-in tap while already signing in');
          return;
        }
        console.log(
          '[AUTH][STATE] Setting isSigningIn=true at',
          new Date().toISOString()
        );
        setIsSigningIn(true);
        loginStartRef.current = Date.now();
        console.log('[AUTH][METRICS] Login start at', new Date(loginStartRef.current).toISOString());
        const authDetails = new AuthenticationDetails({ Username: emailNorm, Password: password });
        const cognitoUser = new CognitoUser({ Username: emailNorm, Pool: userPool });

        cognitoUser.authenticateUser(authDetails, {
          onSuccess: (result) => {
            console.log('âœ… Sign in successful for', maskEmail(emailNorm));
            handleAuthSuccess('password_login', { cognitoUser, tokens: result });
          },
          onFailure: (err) => {
            recordError(err);
            const friendly = mapAuthError(err);
            console.error('âŒ Login failed:', err);
            setLastError(friendly?.message || err?.message || String(err));
            setAttempts(a => a + 1);
            if (err?.code === 'UserNotConfirmedException') {
              console.log('â„¹ï¸ User not confirmed. Prompting for code...');
              const pendingUser = new CognitoUser({ Username: emailNorm, Pool: userPool });
              pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                if (resendErr) {
                  console.error('âŒ Resend code failed:', resendErr);
                  setLastError(resendErr?.message || String(resendErr));
                } else {
                  const dest = resendRes?.CodeDeliveryDetails?.Destination || 'your email';
                  console.log('ðŸ“§ Code re-sent');
                }
              });
              setNeedsConfirm(true);
              setConfirmEmail(emailNorm);
              setConfirmUsername('');
              Alert.alert('Confirm Your Account', 'We sent you a verification code. Enter it to finish sign-in.');
              console.log(
                '[AUTH][STATE] isSigningIn=false (error: NotConfirmed) at',
                new Date().toISOString(),
                { message: err?.message, code: err?.code }
              );
              setIsSigningIn(false);
            } else if (err?.code === 'UserNotFoundException') {
              // Definitive signal the account doesn't exist — drives the inline
              // "no account, sign up?" hint WITHOUT sending any email.
              setAccountExists(false);
              Alert.alert('Authentication Error', 'No account found for this email. Try signing up.');
            } else {
              Alert.alert('Authentication Error', friendly?.message || err.message);
              // After 2 failed attempts with same credentials, surface reset suggestion
              if (attempts + 1 >= 2) {
                setSuggestReset(true);
              }
              // Detect lockout phrasing and immediately show reset UI
              const msg = (err?.message || '').toLowerCase();
              if (msg.includes('attempts exceeded')) {
                setLockoutDetected(true);
                setSuggestReset(true);
              }
              console.log(
                '[AUTH][STATE] isSigningIn=false (error: General) at',
                new Date().toISOString(),
                { message: err?.message, code: err?.code }
              );
              setIsSigningIn(false);
            }
            setLoading(false);
          }
        });
      } else {
        // Sign up
        // Client-side guards first so users get an instant, actionable message
        // instead of a round-trip Cognito error.
        const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm);
        if (!emailValid) {
          setLastError('Please enter a valid email address.');
          Alert.alert('Check your email', 'Please enter a valid email address.');
          setLoading(false);
          return;
        }
        // Age gate (neutral date-of-birth screen). Blyp is not for under-13s.
        const dobParsed = parseDob(dob);
        if (!dobParsed.valid) {
          const msg = 'Please enter your date of birth as DD/MM/YYYY.';
          setLastError(msg);
          Alert.alert('Date of birth', msg);
          setLoading(false);
          return;
        }
        if (dobParsed.age < MIN_SIGNUP_AGE) {
          const msg = `You must be at least ${MIN_SIGNUP_AGE} years old to use Blyp.`;
          setLastError(msg);
          Alert.alert('Sorry, you’re not old enough', msg);
          setLoading(false);
          return;
        }
        const pw = String(password || '');
        if (!isPasswordPolicySatisfied(pw)) {
          const msg = PASSWORD_REQUIREMENTS_SUMMARY;
          setLastError(msg);
          Alert.alert('Choose a stronger password', msg);
          setLoading(false);
          return;
        }

        const usernameValidation = validateUsername(username);
        if (!usernameValidation.ok) {
          const msg = usernameValidation.message;
          setLastError(msg);
          Alert.alert('Username required', msg);
          setLoading(false);
          return;
        }
        const usernameNorm = usernameValidation.username;
        const displayName = usernameNorm;

        console.log('ðŸ“ Starting signup for:', maskEmail(emailNorm), 'displayName:', displayName);
        // Cognito pools differ in two ways:
        // 1) usernameAttributes: email — email is the Cognito Username.
        // 2) aliasAttributes: email — Username must be opaque; email is an alias for sign-in.
        // We try email first, then retry with a UUID when the pool rejects email-as-username.
        // The UI "username" is a display/handle stored as attributes only.
        // Pools also differ on which standard attributes the app client may write at sign-up.
        // If preferred_username or name isn't writable Cognito returns InvalidParameterException.
        // Tier down: full → email+name → email-only.
        const attributeTiers = [
          [
            { Name: 'email', Value: emailNorm },
            { Name: 'preferred_username', Value: displayName },
            { Name: 'name', Value: displayName },
          ],
          [
            { Name: 'email', Value: emailNorm },
            { Name: 'name', Value: displayName },
          ],
          [
            { Name: 'email', Value: emailNorm },
          ],
        ];

        const attemptSignUp = (cognitoUsername, tierIndex) => {
          const attrs = attributeTiers[tierIndex];
          userPool.signUp(cognitoUsername, password, attrs, null, (err, result) => {
            console.log('ðŸ“ Signup callback fired', err ? 'ERROR' : 'SUCCESS');

            if (err) {
              recordError(err);

              if (cognitoUsername === emailNorm && isEmailAliasUsernameError(err)) {
                const opaqueUsername = generateOpaqueCognitoUsername();
                console.warn(
                  '[BLYP][AUTH] Pool uses email alias; retrying signup with opaque username',
                  { opaqueUsername: opaqueUsername.slice(0, 8) + '…' }
                );
                attemptSignUp(opaqueUsername, 0);
                return;
              }

              const canTierDown =
                tierIndex < attributeTiers.length - 1 && isSignupAttributeRejection(err);
              if (canTierDown) {
                console.warn(
                  '[BLYP][AUTH] Signup rejected attributes; retrying with fewer attributes',
                  { tier: tierIndex, code: err?.code, message: err?.message }
                );
                attemptSignUp(cognitoUsername, tierIndex + 1);
                return;
              }
              const friendly = mapAuthError(err);
              console.error('âŒ Signup error:', err);
              setLastError(friendly?.message || err?.message || String(err));
              if (err?.code === 'UsernameExistsException') {
                console.log('â„¹ï¸ User exists but may be unconfirmed; attempting to resend code for:', maskEmail(emailNorm));
                const pendingUser = new CognitoUser({ Username: emailNorm, Pool: userPool });
                pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                  if (resendErr) {
                    console.error('âŒ Resend code failed:', resendErr);
                    setLastError(resendErr?.message || String(resendErr));
                    Alert.alert('Account Issue', 'This account already exists and may not be confirmed. Try "Log In" then "Resend code".');
                  } else {
                    const dest = resendRes?.CodeDeliveryDetails?.Destination || 'your email';
                    Alert.alert('Verify Your Email', `We re-sent a verification code to ${dest}. Enter it to finish sign-up.`);
                    setNeedsConfirm(true);
                    setConfirmEmail(emailNorm);
                    setConfirmUsername('');
                  }
                });
              } else {
                Alert.alert('Authentication Error', friendly?.message || err.message);
                // Apply a brief cooldown on known quota limits to avoid hammering
                if (friendly?.code === 'email_quota_exceeded') {
                  setCooldownUntil(Date.now() + 30_000);
                }
              }
              setLoading(false);
              return;
            }

            // Do NOT resend here; Cognito already sent a code on sign-up.
            const dest = result?.codeDeliveryDetails?.Destination || 'your email';
            // Capture the ACTUAL Cognito username used at sign-up. For email-alias pools the
            // username is opaque and the email alias is not active until AFTER confirmation,
            // so confirmRegistration must target this username, not the email.
            const actualUsername = (result && result.user && typeof result.user.getUsername === 'function' && result.user.getUsername()) || cognitoUsername;
            rememberPendingProfile({
              source: 'signup',
              username: usernameNorm,
              email: emailNorm,
            }).catch((pendingError) => {
              console.warn('[AUTH][SIGNUP] Could not persist pending profile', pendingError?.message || pendingError);
            });
            setConfirmUsername(actualUsername);
            setNeedsConfirm(true);
            setConfirmEmail(emailNorm);
            Alert.alert('Verify Your Email', `We sent you a verification code to ${dest}. Enter it to finish sign-up.`);
            setLoading(false);
          });
        };

        attemptSignUp(emailNorm, 0);
      }
    } catch (e) {
      console.error('âŒ Error preparing confirmation:', e);
      setLastError(e?.message || String(e));
      Alert.alert('Verification Error', 'Could not initiate email verification. Please try again.');
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    // Clear any previous error and reset confirmation state
    setLastError('');
    try {
      await clearCognitoSessions();
      setNeedsConfirm(false);
      setConfirmCode('');
      setConfirmEmail('');
      setConfirmUsername('');
    } catch { }
    setLoading(false);
  };

  return (
    <BlueScreen>
      <View style={styles.container}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.content}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
          <View style={styles.logoContainer}>
            <Text style={styles.welcomeText}>Welcome to</Text>
            <View style={styles.logoWrapper}>
              <BlypLogo useGradientBackground={true} />
            </View>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>
              {isLogin ? 'Log In' : 'Create Account'}
            </Text>

            {!isLogin && !needsConfirm && (
              <>
                <TextInput
                  style={[styles.input, styles.usernameInput]}
                  placeholder="Public username (required)"
                  placeholderTextColor="#9ca3af"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                />
                <Text style={styles.usernameHint}>
                  Your unique @handle · 3–20 letters, numbers, underscores, or dots
                </Text>
              </>
            )}

            {!isLogin && !needsConfirm && (
              <TextInput
                style={styles.input}
                placeholder="Date of birth (DD/MM/YYYY)"
                placeholderTextColor="#9ca3af"
                value={dob}
                onChangeText={handleDobChange}
                keyboardType="number-pad"
                maxLength={10}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!needsConfirm}
            />

            {!resetMode && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
                {!isLogin && !needsConfirm ? (
                  <View style={styles.passwordRules} accessibilityRole="summary">
                    <Text style={styles.passwordRulesTitle}>Password must include:</Text>
                    {getPasswordRequirementChecks(password).map((rule) => (
                      <Text
                        key={rule.id}
                        style={rule.ok ? styles.passwordRuleOk : styles.passwordRulePending}
                      >
                        {rule.ok ? '✓' : '○'} {rule.label}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            )}
            {resetMode && (
              <>
                <Text style={{ color: '#9ca3af', marginBottom: 8 }}>Resetting password for: <Text style={{ color: '#fff' }}>{email}</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="Reset code"
                  placeholderTextColor="#9ca3af"
                  value={resetCode}
                  onChangeText={setResetCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor="#9ca3af"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <View style={styles.passwordRules} accessibilityRole="summary">
                  <Text style={styles.passwordRulesTitle}>New password must include:</Text>
                  {getPasswordRequirementChecks(newPassword).map((rule) => (
                    <Text
                      key={rule.id}
                      style={rule.ok ? styles.passwordRuleOk : styles.passwordRulePending}
                    >
                      {rule.ok ? '✓' : '○'} {rule.label}
                    </Text>
                  ))}
                </View>
              </>
            )}

            {!needsConfirm && !resetMode && (
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAuth}
                disabled={(isLogin ? isSigningIn : loading) || Date.now() < cooldownUntil}
              >
                <LinearGradient
                  colors={['#00D2BE', '#00D2BE', '#00A89E']}
                  style={styles.submitGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.submitText}>
                    {isLogin
                      ? (isSigningIn
                        ? 'Loading...'
                        : (Date.now() < cooldownUntil ? 'Temporarily limited…' : 'Log In'))
                      : (loading ? 'Please wait...' : 'Sign Up')}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {resetMode && (
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAuth}
                disabled={loading || !resetCode.trim() || !newPassword.trim()}
              >
                <LinearGradient
                  colors={['#00D2BE', '#00D2BE', '#00A89E']}
                  style={styles.submitGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.submitText}>
                    {loading ? 'Updating...' : 'Set New Password'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            {needsConfirm && !resetMode && (
              <View>
                <Text style={{ color: '#9ca3af', marginBottom: 8 }}>
                  Confirming email: <Text style={{ color: '#fff' }}>{confirmEmail || email}</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Confirmation code"
                  placeholderTextColor="#9ca3af"
                  value={confirmCode}
                  onChangeText={setConfirmCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />

                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={handleAuth}
                  disabled={loading || !confirmCode.trim()}
                >
                  <LinearGradient
                    colors={['#00D2BE', '#00D2BE', '#00A89E']}
                    style={styles.submitGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.submitText}>
                      {loading ? 'Confirming...' : 'Confirm & Continue'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.toggleButton, { marginTop: 8 }]}
                  onPress={() => {
                    // Prefer the opaque Cognito username captured at sign-up. On
                    // email-alias pools the email alias is not active until AFTER
                    // confirmation, so resending by email can fail — target the
                    // actual username when we have it, falling back to email.
                    const resendUsername = (confirmUsername && String(confirmUsername).trim())
                      || String(email || '').trim().toLowerCase();
                    const pendingUser = new CognitoUser({ Username: resendUsername, Pool: userPool });
                    pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                      if (resendErr) {
                        console.error('âŒ Resend code failed:', resendErr);
                        setLastError(resendErr?.message || String(resendErr));
                        Alert.alert('Resend Failed', resendErr?.message || 'Could not resend verification code.');
                      } else {
                        const dest = resendRes?.CodeDeliveryDetails?.Destination || 'your email';
                        Alert.alert('Code Sent', `We resent the verification code to ${dest}.`);
                      }
                    });
                  }}
                >
                  <Text style={styles.toggleText}>
                    Didn't get a code? <Text style={styles.toggleLink}>Resend</Text>
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.toggleButton, { marginTop: 8 }]}
                  onPress={handleReset}
                >
                  <Text style={styles.toggleText}>
                    Wrong email? <Text style={styles.toggleLink}>Reset</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!needsConfirm && !resetMode && (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setIsLogin(!isLogin)}
              >
                <Text style={styles.toggleText}>
                  {isLogin ? "Don't have an account? " : 'Already have an account? '}
                  <Text style={styles.toggleLink}>
                    {isLogin ? 'Sign Up' : 'Log In'}
                  </Text>
                </Text>
              </TouchableOpacity>
            )}

            {isLogin && !needsConfirm && !resetMode && (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => {
                  if (!email.trim()) {
                    Alert.alert('Reset Password', 'Enter your email above first.');
                    return;
                  }
                  setLastError('');
                  const pendingUser = new CognitoUser({ Username: String(email || '').trim().toLowerCase(), Pool: userPool });
                  console.log('ðŸ” Forgot password initiate for', maskEmail(email.trim()));
                  pendingUser.forgotPassword({
                    onSuccess: () => {
                      Alert.alert('Reset Started', 'Check your email for the reset code.');
                      setResetMode(true);
                    },
                    onFailure: (err) => {
                      recordError(err);
                      console.error('âŒ Forgot password failed:', err);
                      setLastError(err?.message || String(err));
                      Alert.alert('Reset Failed', err?.message || 'Could not start password reset.');
                    },
                    inputVerificationCode: (data) => {
                      // Cognito sometimes calls this callback before onSuccess; treat as success path
                      Alert.alert('Reset Code Sent', 'Enter the code below with a new password.');
                      setResetMode(true);
                    }
                  });
                }}
              >
                <Text style={styles.toggleText}>Forgot password? <Text style={styles.toggleLink}>Reset</Text></Text>
              </TouchableOpacity>
            )}
            {isLogin && !needsConfirm && !resetMode && suggestReset && (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => {
                  setSuggestReset(false);
                  if (!email.trim()) {
                    Alert.alert('Reset Password', 'Enter your email above first.');
                    return;
                  }
                  const pendingUser = new CognitoUser({ Username: String(email || '').trim().toLowerCase(), Pool: userPool });
                  console.log('ðŸ” Auto-forgot after repeated failures for', maskEmail(email.trim()));
                  pendingUser.forgotPassword({
                    onSuccess: () => {
                      Alert.alert('Reset Started', 'Check your email for the reset code.');
                      setResetMode(true);
                    },
                    onFailure: (err) => {
                      recordError(err);
                      console.error('âŒ Auto-forgot failed:', err);
                      setLastError(err?.message || String(err));
                      Alert.alert('Reset Failed', err?.message || 'Could not start password reset.');
                    },
                    inputVerificationCode: () => {
                      Alert.alert('Reset Code Sent', 'Enter the code below with a new password.');
                      setResetMode(true);
                    }
                  });
                }}
              >
                <Text style={styles.toggleText}>Trouble logging in? <Text style={styles.toggleLink}>Send reset code</Text></Text>
              </TouchableOpacity>
            )}
            {isLogin && !needsConfirm && !resetMode && accountExists === false && (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.toggleText, { textAlign: 'center' }]}>Account not found for this email.</Text>
                <TouchableOpacity style={styles.toggleButton} onPress={() => setIsLogin(false)}>
                  <Text style={styles.toggleText}>Create a new account? <Text style={styles.toggleLink}>Sign Up</Text></Text>
                </TouchableOpacity>
              </View>
            )}
            {isLogin && !needsConfirm && !resetMode && lockoutDetected && (
              <Text style={[styles.toggleText, { marginTop: 8, textAlign: 'center', color: '#fca5a5' }]}>Too many failed attempts. Reset required.</Text>
            )}
            {resetMode && (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => {
                  setResetMode(false);
                  setResetCode('');
                  setNewPassword('');
                }}
              >
                <Text style={styles.toggleText}>Back to <Text style={styles.toggleLink}>{isLogin ? 'Log In' : 'Sign Up'}</Text></Text>
              </TouchableOpacity>
            )}
            {!isLogin && !needsConfirm && !resetMode && (
              <Text style={styles.hintText}>
                Use at least 8 characters with an uppercase letter, a lowercase letter and a number.
              </Text>
            )}
            {!!lastError && (
              <Text style={styles.errorText}>{lastError}</Text>
            )}
            {__DEV__ && !!lastError && (
              <TouchableOpacity
                style={[styles.toggleButton, { marginTop: 4 }]}
                onPress={() => setShowRawError(v => !v)}
              >
                <Text style={styles.toggleText}>Debug: <Text style={styles.toggleLink}>{showRawError ? 'Hide error details' : 'Show error details'}</Text></Text>
              </TouchableOpacity>
            )}
            {__DEV__ && showRawError && rawErrorObj && (
              <Text style={styles.hintText} selectable={true}>
                Code: {rawErrorObj.code || rawErrorObj.name || 'unknown'}{'\n'}
                {rawErrorObj.message || String(rawErrorObj)}
              </Text>
            )}
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
        {/* Debug footer (dev only) */}
        {__DEV__ && (
          <View style={{ padding: 8 }}>
            <Text style={{ color: '#71717A', fontSize: 12, textAlign: 'center' }}>
              Pool: {awsconfig.aws_user_pools_id} Â· Region: {awsconfig.aws_cognito_region}
            </Text>
            {!!lastError && (
              <Text style={{ color: '#fca5a5', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                {lastError}
              </Text>
            )}
            {showRawError && rawErrorObj && (
              <Text style={{ color: '#A1A1AA', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
                Code: {rawErrorObj.code || rawErrorObj.name} | Message: {rawErrorObj.message}
              </Text>
            )}
          </View>
        )}
        {isSigningIn && (
          <View style={styles.authLoadingOverlay}>
            <ActivityIndicator size="large" color="#00D2BE" />
          </View>
        )}
      </View>
    </BlueScreen>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoText: {
    fontSize: 48,
    fontWeight: '800',
    textAlign: 'center',
    color: '#F5F5F7',
  },
  welcomeText: {
    fontSize: 20,
    color: '#A1A1AA',
    marginBottom: 20,
    textAlign: 'center',
  },
  logoWrapper: {
    transform: [{ scale: 1.8 }],
  },
  formContainer: {
    backgroundColor: '#121216',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#1C1C22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 16,
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 16,
  },
  submitButton: {
    marginTop: 8,
  },
  submitGradient: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  submitText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '800',
  },
  toggleButton: {
    marginTop: 8,
    alignItems: 'center',
  },
  toggleText: {
    color: '#A1A1AA',
    fontSize: 14,
  },
  toggleLink: {
    color: '#00D2BE',
    fontWeight: '700',
  },
  hintText: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  authLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 999,
    elevation: 999,
  },
  usernameInput: {
    marginBottom: 6,
  },
  usernameHint: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  passwordRules: {
    marginTop: -4,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  passwordRulesTitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  passwordRulePending: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 18,
  },
  passwordRuleOk: {
    color: COLORS.primary || '#00D2BE',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
});

export default AuthScreen;


