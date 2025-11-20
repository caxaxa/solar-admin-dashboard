const AWS = require('aws-sdk');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2';
AWS.config.update({ region });

const s3 = new AWS.S3({ signatureVersion: 'v4' });
const cognito = new AWS.CognitoIdentityServiceProvider();
const batch = new AWS.Batch();

module.exports = {
  AWS,
  s3,
  cognito,
  batch,
};
