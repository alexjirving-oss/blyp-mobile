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
  InvalidPasswordException: {
    code: 'invalid_password',
    message:
      'Password doesn’t meet the requirements: at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character (e.g. !@#$%).',
    retryable: true,
  },
  InvalidParameterException: {
    code: 'invalid_parameter',
    message:
      'Some details look invalid. Check your email and password (at least 8 characters, uppercase, lowercase, number, and a special character) and try again.',
    retryable: true,
  },
  CodeDeliveryFailureException: {
    code: 'code_delivery_failed',
    message:
      'We couldn’t send your verification email. Please try again shortly, or use a different email address.',
    retryable: true,
  },
  TooManyRequestsException: {
    code: 'too_many_requests',
    message: 'Too many attempts right now. Please wait a moment and try again.',
    retryable: true,
    suggestedWaitMs: 15_000,
  },
};

const PASSWORD_REQUIREMENTS_MSG =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (e.g. !@#$%).';

function refineInvalidParameterMessage(rawMessage) {
  const msg = String(rawMessage || '');
  if (/email alias|cannot be of email format/i.test(msg)) return null;
  if (/password/i.test(msg)) return PASSWORD_REQUIREMENTS_MSG;
  if (/email/i.test(msg)) return 'Please enter a valid email address.';
  if (/preferred_username|display name|username/i.test(msg)) {
    return 'That display name isn’t allowed. Try a different name or leave it blank.';
  }
  return null;
}

export function mapAuthError(err) {
  if (!err) return { code: 'unknown', message: 'Unknown error' };
  const name = err.name || err.code || '';
  const entry = KNOWN[name];
  if (entry) {
    const mapped = { ...entry, raw: err };
    if (name === 'InvalidParameterException') {
      const specific = refineInvalidParameterMessage(err.message);
      if (specific) mapped.message = specific;
    }
    return mapped;
  }
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
