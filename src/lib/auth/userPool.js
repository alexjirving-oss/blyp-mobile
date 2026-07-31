import AsyncStorage from '@react-native-async-storage/async-storage';
import { CognitoUserPool } from 'amazon-cognito-identity-js';
import awsconfig from '../../aws-exports';

const userPoolId = String(awsconfig.aws_user_pools_id || '').trim();
const clientId = String(awsconfig.aws_user_pools_web_client_id || '').trim();

if (!userPoolId || !clientId) {
  throw new Error('Cognito user-pool configuration is missing.');
}

export const userPool = new CognitoUserPool({
  UserPoolId: userPoolId,
  ClientId: clientId,
  Storage: AsyncStorage,
});

export const cognitoClientId = clientId;
