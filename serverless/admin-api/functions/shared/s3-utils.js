const { s3 } = require('./aws-clients');

async function objectExists(bucket, key) {
  if (!bucket || !key) return false;
  try {
    await s3
      .headObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();
    return true;
  } catch (err) {
    if (
      err &&
      (err.code === 'NotFound' ||
        err.code === 'NoSuchKey' ||
        err.code === 'Forbidden' ||
        err.code === 'AccessDenied')
    ) {
      if (err.code === 'Forbidden' || err.code === 'AccessDenied') {
        console.warn('objectExists access denied', { bucket, key, code: err.code });
      }
      return false;
    }
    throw err;
  }
}

async function readJson(bucket, key) {
  if (!bucket || !key) return null;
  try {
    const response = await s3
      .getObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();
    if (!response.Body) return null;
    return JSON.parse(response.Body.toString('utf-8'));
  } catch (err) {
    // Missing files or inaccessible objects should be treated as empty so callers can handle defaults
    if (
      err &&
      (err.code === 'NoSuchKey' ||
        err.code === 'NotFound' ||
        err.code === 'Forbidden' ||
        err.code === 'AccessDenied')
    ) {
      if (err.code === 'Forbidden' || err.code === 'AccessDenied') {
        console.warn('readJson access denied', { bucket, key, code: err.code });
      }
      return null;
    }
    throw err;
  }
}

async function writeJson(bucket, key, data) {
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    })
    .promise();
}

function getSignedGetUrl(bucket, key, expiresIn = 3600) {
  return s3.getSignedUrl('getObject', {
    Bucket: bucket,
    Key: key,
    Expires: expiresIn,
  });
}

module.exports = {
  objectExists,
  readJson,
  writeJson,
  getSignedGetUrl,
};
