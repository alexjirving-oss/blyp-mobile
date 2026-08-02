import AsyncStorage from '@react-native-async-storage/async-storage';
import { CognitoUserPool } from 'amazon-cognito-identity-js';
import awsconfig from '../aws-exports';

export const userPool = new CognitoUserPool({
  UserPoolId: awsconfig.aws_user_pools_id,
  ClientId: awsconfig.aws_user_pools_web_client_id,
  Storage: AsyncStorage,
});
