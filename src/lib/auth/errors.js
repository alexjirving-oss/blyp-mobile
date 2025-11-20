// Centralized mapping of Cognito/Amplify Auth errors to friendly, actionable messages

const KNOWN = {
  LimitExceededException: {
    code: 'email_quota_exceeded',
    message:
      'Email sending limit reached for today. Please try again later or contact support. For production, configure Amazon SES in Cognito.',
    retryable: true,
    suggestedWaitMs: 30_000,
  },
  CodeMismatchException: {
    code: 'code_mismatch',
    message: 'The verification code is incorrect. Please check and try again.',
    retryable: true,
  },
  ExpiredCodeException: {
    code: 'code_expired',
    message: 'The verification code has expired. Request a new one and try again.',
    retryable: true,
  },
  UsernameExistsException: {
    code: 'user_exists',
    message: 'An account with this email already exists. Try logging in.',
    retryable: false,
  },
  UserNotFoundException: {
    code: 'user_not_found',
    message: 'No account found for this email. Sign up first.',
    retryable: false,
  },
  NotAuthorizedException: {
    code: 'bad_credentials',
    message: 'Incorrect email or password.',
    retryable: true,
  },
  UserNotConfirmedException: {
    code: 'user_not_confirmed',
    message: 'Your account is not confirmed yet. Check your email for the code.',
    retryable: false,
  },
  TooManyFailedAttemptsException: {
    code: 'too_many_attempts',
    message: 'Too many failed attempts. Please wait and try again later.',
    retryable: true,
    suggestedWaitMs: 60_000,
  },
  NetworkError: {
    code: 'network_error',
    message: 'Network error. Check your connection and try again.',
    retryable: true,
  },
};

export function mapAuthError(err) {
  if (!err) return { code: 'unknown', message: 'Unknown error' };
  const name = err.name || err.code || '';
  const entry = KNOWN[name];
  if (entry) return { ...entry, raw: err };
  // Fallback friendly message
  return {
    code: (typeof name === 'string' && name.toLowerCase()) || 'unknown',
    message: err.message || 'Something went wrong. Please try again.',
    raw: err,
  };
}

export function backoffDelayMs(attempt, base = 500) {
  const capped = Math.min(attempt, 6); // cap exponential growth
  const jitter = Math.floor(Math.random() * 250);
  return base * Math.pow(2, capped) + jitter; // 0.5s,1s,2s,4s,8s,16s + jitter
}
