import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { sanitizeHeaderValue } from '../utils/headerSanitize';

const region = sanitizeHeaderValue(process.env.AWS_REGION);

if (!region) {
  throw new Error('[config] AWS_REGION is required for DynamoDB client');
}

const baseClient = new DynamoDBClient({ region });
export const docClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});
