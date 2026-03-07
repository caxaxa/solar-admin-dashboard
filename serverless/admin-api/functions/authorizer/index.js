/**
 * Lambda Authorizer for Admin Dashboard HttpApi.
 *
 * Validates Cognito JWT tokens (id or access) by:
 *   1. Extracting Bearer token from Authorization header
 *   2. Fetching JWKS from Cognito (cached across warm invocations)
 *   3. Verifying RS256 signature, expiry, issuer, and token_use
 *
 * Returns simple response format (EnableSimpleResponses: true):
 *   { isAuthorized: true/false, context: { userId, email, groups } }
 */
const https = require('https');
const crypto = require('crypto');

// Module-level cache — persists across warm Lambda invocations
let jwksCache = null;
let jwksCacheExpiry = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const REGION = process.env.AWS_REGION || 'us-east-2';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

// ── Helpers ──

function deny() {
  return { isAuthorized: false };
}

function allow(claims) {
  return {
    isAuthorized: true,
    context: {
      userId: claims.sub || '',
      email: claims.email || '',
      groups: (claims['cognito:groups'] || []).join(','),
    },
  };
}

/**
 * Base64url decode (no padding) → Buffer
 */
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) str += '=';
  return Buffer.from(str, 'base64');
}

/**
 * Decode JWT without verification — returns { header, payload, signatureInput, signature }
 */
function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  return {
    header: JSON.parse(base64urlDecode(parts[0]).toString('utf8')),
    payload: JSON.parse(base64urlDecode(parts[1]).toString('utf8')),
    signatureInput: `${parts[0]}.${parts[1]}`,
    signature: base64urlDecode(parts[2]),
  };
}

/**
 * Fetch JWKS from Cognito (with caching).
 */
async function getJwks() {
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpiry) {
    return jwksCache;
  }

  const data = await new Promise((resolve, reject) => {
    https.get(JWKS_URL, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Failed to parse JWKS response'));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });

  jwksCache = data;
  jwksCacheExpiry = now + JWKS_CACHE_TTL_MS;
  return data;
}

/**
 * Find the JWK matching the token's kid, convert to PEM, and verify RS256 signature.
 */
async function verifyToken(token) {
  const { header, payload, signatureInput, signature } = decodeJwt(token);

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Fetch JWKS and find matching key
  const jwks = await getJwks();
  const key = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig');
  if (!key) {
    // Key not found — maybe keys rotated. Bust cache and retry once.
    jwksCache = null;
    jwksCacheExpiry = 0;
    const freshJwks = await getJwks();
    const freshKey = freshJwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig');
    if (!freshKey) {
      throw new Error(`No matching JWK found for kid: ${header.kid}`);
    }
    return verifyWithKey(freshKey, signatureInput, signature, payload);
  }

  return verifyWithKey(key, signatureInput, signature, payload);
}

function verifyWithKey(jwk, signatureInput, signature, payload) {
  // Convert JWK (n, e) → RSA public key PEM
  const pubKey = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e,
    },
    format: 'jwk',
  });

  // Verify RS256 signature
  const isValid = crypto.createVerify('RSA-SHA256')
    .update(signatureInput)
    .verify(pubKey, signature);

  if (!isValid) {
    throw new Error('Invalid token signature');
  }

  // Validate claims
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  if (payload.iss !== ISSUER) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  const validTokenUse = ['id', 'access'];
  if (payload.token_use && !validTokenUse.includes(payload.token_use)) {
    throw new Error(`Invalid token_use: ${payload.token_use}`);
  }

  return payload;
}

// ── Handler ──

exports.handler = async (event) => {
  // Allow CORS preflight requests through without auth
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return allow({ sub: 'preflight', email: '' });
  }

  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    if (!authHeader) {
      return deny();
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return deny();
    }

    const claims = await verifyToken(token);
    return allow(claims);
  } catch (error) {
    console.warn('Authorization failed:', error.message);
    return deny();
  }
};
