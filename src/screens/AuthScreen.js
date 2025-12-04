import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { mapAuthError } from '../lib/auth/errors';
import BlypLogo from '../components/BlypLogo';
import awsconfig from '../aws-exports';
import { userPool, clearCognitoSessions, refreshAuthNow } from '../hooks/useCommon';
import { isSocialAuthEnabled, signInWithGoogle, signInWithFacebook } from '../services/socialAuthService';

const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [lastError, setLastError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [suggestReset, setSuggestReset] = useState(false);
  const [accountExists, setAccountExists] = useState(undefined); // undefined=unknown, true/false known
  const [lockoutDetected, setLockoutDetected] = useState(false);
  const [isSocialAuthInProgress, setIsSocialAuthInProgress] = useState(false);

  // TODO[BLYP][UX]: Future onboarding polish:
  //  - Consider one-line tagline under logo
  //  - Optional “By continuing you agree to …” legal line at bottom of screen
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
    } catch {}
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

  const probeAccountExistence = (emailToProbe) => {
    // Avoid redundant probes or empty emails
    const norm = String(emailToProbe || '').trim().toLowerCase();
    if (!norm || accountExists !== undefined) return;
    try {
      const tempUser = new CognitoUser({ Username: norm, Pool: userPool });
      tempUser.forgotPassword({
        onSuccess: () => {
          // If reset started or code callback executed, user exists
          setAccountExists(true);
        },
        inputVerificationCode: () => {
          setAccountExists(true);
        },
        onFailure: (e) => {
          // UserNotFoundException => user does not exist
          if (e?.code === 'UserNotFoundException') {
            setAccountExists(false);
          } else {
            // Leave as unknown for other errors to avoid leaking enumeration details
            setAccountExists(undefined);
          }
        }
      });
    } catch {}
  };

  // Unified success handler for any auth source (password, confirmed signup, social OAuth)
  const handleAuthSuccess = (source, context = {}) => {
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
        try { refreshAuthNow?.(context.cognitoUser); } catch {}
      }
      // Clear signing flags
      setIsSigningIn(false);
      setLoading(false);
      // Clear confirmation flow state (only relevant for signup/confirm path)
      if (needsConfirm) {
        setNeedsConfirm(false);
        setConfirmCode('');
        setConfirmEmail('');
      }
      // Basic cooldown to prevent rapid re-entry taps after success
      setCooldownUntil(Date.now() + 1500);
    } catch (e) {
      console.warn('[AUTH][SUCCESS][WARN] Post-success cleanup failed', e?.message || e);
    }
  };

  const handleAuth = async () => {
    if (!email || !password || (!isLogin && !username)) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const emailNorm = String(email || '').trim().toLowerCase();
    console.log('🔐 Auth attempt:', isLogin ? 'LOGIN' : 'SIGNUP', maskEmail(emailNorm));
    
    try {
      // Forgot password flow (change password after code)
      if (resetMode && resetCode.trim() && newPassword.trim()) {
        setLoading(true);
        const emailToReset = emailNorm;
        const cognitoUser = new CognitoUser({ Username: emailToReset, Pool: userPool });
        console.log('🔐 Reset attempt (confirm new password)', maskEmail(emailToReset));
        cognitoUser.confirmPassword(resetCode.trim(), newPassword.trim(), {
          onSuccess: () => {
            console.log('✅ Password reset success');
            Alert.alert('Password Reset', 'Your password has been updated. Please log in.');
            setResetMode(false);
            setResetCode('');
            setNewPassword('');
            setLoading(false);
          },
          onFailure: (err) => {
            console.error('❌ Password reset failed:', err);
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
  const cognitoUser = new CognitoUser({ Username: emailToConfirm, Pool: userPool });
        cognitoUser.confirmRegistration(confirmCode.trim(), true, (err, result) => {
          const proceedToLogin = () => {
            // Auto sign-in (treat already-confirmed as success path)
            const authDetails = new AuthenticationDetails({ Username: emailNorm, Password: password });
            cognitoUser.authenticateUser(authDetails, {
              onSuccess: () => {
                console.log('✅ Auto-login after confirm');
                setNeedsConfirm(false);
                setConfirmCode('');
                setConfirmEmail('');
                try { refreshAuthNow?.(cognitoUser); } catch {}
                setLoading(false);
              },
              onFailure: (loginErr) => {
                console.error('❌ Login failed after confirm:', loginErr);
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
            console.error('❌ Confirmation failed:', err);
            setLastError(msg || String(err));
            Alert.alert('Confirmation Error', msg);
            setLoading(false);
            return;
          }
          console.log('✅ Confirmation success:', result);
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
            console.log('✅ Sign in successful for', maskEmail(emailNorm));
            handleAuthSuccess('password_login', { cognitoUser, tokens: result });
          },
          onFailure: (err) => {
            recordError(err);
            const friendly = mapAuthError(err);
            console.error('❌ Login failed:', err);
            setLastError(friendly?.message || err?.message || String(err));
            setAttempts(a => a + 1);
            if (err?.code === 'UserNotConfirmedException') {
              console.log('ℹ️ User not confirmed. Prompting for code...');
              const pendingUser = new CognitoUser({ Username: emailNorm, Pool: userPool });
              pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                if (resendErr) {
                  console.error('❌ Resend code failed:', resendErr);
                  setLastError(resendErr?.message || String(resendErr));
                } else {
                  const dest = resendRes?.CodeDeliveryDetails?.Destination || 'your email';
                  console.log('📧 Code re-sent');
                }
              });
              setNeedsConfirm(true);
              setConfirmEmail(emailNorm);
              Alert.alert('Confirm Your Account', 'We sent you a verification code. Enter it to finish sign-in.');
              console.log(
                '[AUTH][STATE] isSigningIn=false (error: NotConfirmed) at',
                new Date().toISOString(),
                { message: err?.message, code: err?.code }
              );
              setIsSigningIn(false);
            } else if (err?.code === 'UserNotFoundException') {
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
              // Probe existence to help user choose between reset vs signup
              probeAccountExistence(emailNorm);
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
        const usernameNorm = String(username || '').trim();
        
        // Guard: username must be non-empty and NOT look like an email
        if (!usernameNorm || usernameNorm.includes('@')) {
          setLastError('Choose a username that is not an email address.');
          Alert.alert('Invalid Username', 'Your username cannot be an email address. Please choose a different name.');
          setLoading(false);
          return;
        }
        
        console.log('📝 Starting signup for:', maskEmail(emailNorm), 'with username:', usernameNorm);
        // Pass username as Cognito Username; email is attribute only
        const attributes = [
          { Name: 'email', Value: emailNorm },
          { Name: 'preferred_username', Value: usernameNorm },
          { Name: 'name', Value: usernameNorm },
        ];
        userPool.signUp(usernameNorm, password, attributes, null, (err, result) => {
          console.log('📝 Signup callback fired', err ? 'ERROR' : 'SUCCESS');
          
          if (err) {
            const friendly = mapAuthError(err);
            console.error('❌ Signup error:', err);
            setLastError(friendly?.message || err?.message || String(err));
            if (err?.code === 'UsernameExistsException') {
              console.log('ℹ️ User exists but may be unconfirmed; attempting to resend code for username:', usernameNorm);
                const pendingUser = new CognitoUser({ Username: usernameNorm, Pool: userPool });
              pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                if (resendErr) {
                  console.error('❌ Resend code failed:', resendErr);
                  setLastError(resendErr?.message || String(resendErr));
                  Alert.alert('Account Issue', 'This account already exists and may not be confirmed. Try "Log In" then "Resend code".');
                } else {
                  const dest = resendRes?.CodeDeliveryDetails?.Destination || 'your email';
                  Alert.alert('Verify Your Email', `We re-sent a verification code to ${dest}. Enter it to finish sign-up.`);
                  setNeedsConfirm(true);
                  setConfirmEmail(usernameNorm);
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
          setNeedsConfirm(true);
          setConfirmEmail(usernameNorm);
          Alert.alert('Verify Your Email', `We sent you a verification code to ${dest}. Enter it to finish sign-up.`);
          setLoading(false);
        });
      }
          } catch (e) {
            console.error('❌ Error preparing confirmation:', e);
            setLastError(e?.message || String(e));
            Alert.alert('Verification Error', 'Could not initiate email verification. Please try again.');
            setLoading(false);
          }
  };

  const handleGoogleSignInPress = async () => {
    if (!isSocialAuthEnabled()) {
      console.log('[AUTH][SOCIAL] Social auth disabled via env or missing client IDs');
      return;
    }

    if (isSigningIn || loading || isSocialAuthInProgress || Date.now() < cooldownUntil) {
      console.log('[AUTH][SOCIAL] Ignoring Google tap while auth is busy or cooled down');
      return;
    }

    setIsSocialAuthInProgress(true);
    console.log('[AUTH][SOCIAL] Starting Google sign-in at', new Date().toISOString());

    try {
      const result = await signInWithGoogle();
      console.log('[AUTH][SOCIAL] Google sign-in result', result);
      // Future: exchange tokens with backend for Cognito federation.
      handleAuthSuccess('google_oauth', { socialUser: result });
    } catch (err) {
      console.log('[AUTH][SOCIAL] Google sign-in error', { message: err?.message, code: err?.code });
    } finally {
      setIsSocialAuthInProgress(false);
    }
  };

  const handleFacebookSignInPress = async () => {
    if (!isSocialAuthEnabled()) {
      console.log('[AUTH][SOCIAL] Social auth disabled via env or missing client IDs');
      return;
    }

    if (isSigningIn || loading || isSocialAuthInProgress || Date.now() < cooldownUntil) {
      console.log('[AUTH][SOCIAL] Ignoring Facebook tap while auth is busy or cooled down');
      return;
    }

    setIsSocialAuthInProgress(true);
    console.log('[AUTH][SOCIAL] Starting Facebook sign-in at', new Date().toISOString());

    try {
      const result = await signInWithFacebook();
      console.log('[AUTH][SOCIAL] Facebook sign-in result', result);
      // Future: exchange tokens with backend for Cognito federation.
      handleAuthSuccess('facebook_oauth', { socialUser: result });
    } catch (err) {
      console.log('[AUTH][SOCIAL] Facebook sign-in error', { message: err?.message, code: err?.code });
    } finally {
      setIsSocialAuthInProgress(false);
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
    } catch {}
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior="padding"
        style={styles.content}
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

          {!isLogin && (
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#9ca3af"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
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
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
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
            </>
          )}

          {!needsConfirm && !resetMode && (
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleAuth}
              disabled={(isLogin ? isSigningIn : loading) || Date.now() < cooldownUntil}
            >
              <LinearGradient
                colors={['#a855f7', '#d946ef', '#ec4899']}
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

          {isSocialAuthEnabled() && !needsConfirm && !resetMode && (
            <>
              <View style={styles.socialDivider}>
                <View style={styles.socialDividerLine} />
                <Text style={styles.socialDividerText} allowFontScaling={false}>
                  Or continue with
                </Text>
                <View style={styles.socialDividerLine} />
              </View>

              <View style={styles.socialButtonsRow}>
                {/* TODO[BLYP][UX]: Design final copy/layout for Google/Facebook sign-in row
                    - Confirm brand guidelines (Google / Meta)
                    - Decide button ordering and spacing relative to email/password form
                    - Add tracking for tap events (provider, success/failure, latency) */}
                <TouchableOpacity
                  style={[
                    styles.socialButton,
                    isSocialAuthInProgress && styles.socialButtonDisabled,
                  ]}
                  onPress={handleGoogleSignInPress}
                  disabled={isSocialAuthInProgress || isSigningIn || Date.now() < cooldownUntil}
                  activeOpacity={isSocialAuthInProgress ? 1 : 0.8}
                >
                  <Text style={styles.socialButtonText} allowFontScaling={false}>
                    Continue with Google
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.socialButton,
                    isSocialAuthInProgress && styles.socialButtonDisabled,
                  ]}
                  onPress={handleFacebookSignInPress}
                  disabled={isSocialAuthInProgress || isSigningIn || Date.now() < cooldownUntil}
                  activeOpacity={isSocialAuthInProgress ? 1 : 0.8}
                >
                  <Text style={styles.socialButtonText} allowFontScaling={false}>
                    Continue with Facebook
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {resetMode && (
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleAuth}
              disabled={loading || !resetCode.trim() || !newPassword.trim()}
            >
              <LinearGradient
                colors={['#a855f7', '#d946ef', '#ec4899']}
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
                  colors={['#a855f7', '#d946ef', '#ec4899']}
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
                  const pendingUser = new CognitoUser({ Username: String(email || '').trim().toLowerCase(), Pool: userPool });
                  pendingUser.resendConfirmationCode((resendErr, resendRes) => {
                    if (resendErr) {
                      console.error('❌ Resend code failed:', resendErr);
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
                console.log('🔐 Forgot password initiate for', maskEmail(email.trim()));
                pendingUser.forgotPassword({
                  onSuccess: () => {
                    Alert.alert('Reset Started', 'Check your email for the reset code.');
                    setResetMode(true);
                  },
                  onFailure: (err) => {
                    recordError(err);
                    console.error('❌ Forgot password failed:', err);
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
                console.log('🔐 Auto-forgot after repeated failures for', maskEmail(email.trim()));
                pendingUser.forgotPassword({
                  onSuccess: () => {
                    Alert.alert('Reset Started', 'Check your email for the reset code.');
                    setResetMode(true);
                  },
                  onFailure: (err) => {
                    recordError(err);
                    console.error('❌ Auto-forgot failed:', err);
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
          {!!lastError && (
            <TouchableOpacity
              style={[styles.toggleButton, { marginTop: 4 }]}
              onPress={() => setShowRawError(v => !v)}
            >
              <Text style={styles.toggleText}>Debug: <Text style={styles.toggleLink}>{showRawError ? 'Hide error details' : 'Show error details'}</Text></Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
      {/* Debug footer (dev only) */}
      {__DEV__ && (
        <View style={{ padding: 8 }}>
          <Text style={{ color: '#64748b', fontSize: 12, textAlign: 'center' }}>
            Pool: {awsconfig.aws_user_pools_id} · Region: {awsconfig.aws_cognito_region}
          </Text>
          {!!lastError && (
            <Text style={{ color: '#fca5a5', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
              {lastError}
            </Text>
          )}
          {showRawError && rawErrorObj && (
            <Text style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
              Code: {rawErrorObj.code || rawErrorObj.name} | Message: {rawErrorObj.message}
            </Text>
          )}
        </View>
      )}
      {isSigningIn && (
        <View style={styles.authLoadingOverlay}>
          <ActivityIndicator size="large" color="#ec4899" />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 56,
  },
  logoText: {
    fontSize: 48,
    fontWeight: '800',
    textAlign: 'center',
    color: '#ec4899',
    textShadowColor: 'rgba(168, 85, 247, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  welcomeText: {
    fontSize: 20,
    color: '#9ca3af',
    marginBottom: 20,
    textAlign: 'center',
  },
  logoWrapper: {
    transform: [{ scale: 1.8 }],
  },
  formContainer: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#4b5563',
    borderRadius: 12,
    padding: 16,
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 16,
  },
  submitButton: {
    marginTop: 8,
  },
  submitGradient: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  submitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  toggleButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  toggleText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  toggleLink: {
    color: '#a855f7',
    fontWeight: '600',
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
  socialDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  socialDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1f2933',
  },
  socialDividerText: {
    marginHorizontal: 12,
    color: '#6b7280',
    fontSize: 13,
  },
  socialButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  socialButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020617',
  },
  socialButtonDisabled: {
    opacity: 0.6,
  },
  socialButtonText: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default AuthScreen;