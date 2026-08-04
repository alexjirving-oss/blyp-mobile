import { AmplifyAuthCognitoStackTemplate } from '@aws-amplify/cli-extensibility-helper';

/**
 * Blyp-owned verification email.
 *
 * By default this user pool sends sign-up verification codes from Cognito's
 * shared sender (no-reply@verificationemail.com), which has poor deliverability
 * (lands in spam) and isn't on-brand. This override routes all pool emails
 * through Amazon SES using our own verified domain (blyp.world).
 *
 * Prerequisites (one-time, see scripts/setup_cognito_email_blyp.ps1):
 *  - SES domain identity "blyp.world" verified in eu-west-2 (DKIM + MAIL FROM DNS added)
 *  - SES production access granted (out of sandbox) so we can email any recipient
 *  - SES identity authorization policy allowing cognito-idp to send as this identity
 */
const SES_IDENTITY_ARN = 'arn:aws:ses:eu-west-2:030569357413:identity/blyp.world';
const FROM_ADDRESS = 'Blyp <safety@blyp.world>';
const REPLY_TO = 'safety@blyp.world';

const VERIFICATION_SUBJECT = 'Your Blyp verification code';
const VERIFICATION_MESSAGE =
  'Welcome to Blyp. Your verification code is {####}. ' +
  'Enter it in the app to finish setting up your account. ' +
  'If you didn\u2019t request this, you can safely ignore this email.';

export function override(resources: AmplifyAuthCognitoStackTemplate) {
  resources.userPool.emailConfiguration = {
    emailSendingAccount: 'DEVELOPER',
    from: FROM_ADDRESS,
    replyToEmailAddress: REPLY_TO,
    sourceArn: SES_IDENTITY_ARN,
  };

  resources.userPool.emailVerificationSubject = VERIFICATION_SUBJECT;
  resources.userPool.emailVerificationMessage = VERIFICATION_MESSAGE;

  resources.userPool.verificationMessageTemplate = {
    defaultEmailOption: 'CONFIRM_WITH_CODE',
    emailSubject: VERIFICATION_SUBJECT,
    emailMessage: VERIFICATION_MESSAGE,
  };
}
