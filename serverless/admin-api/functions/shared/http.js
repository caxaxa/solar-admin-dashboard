const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Module-level request event — set via setRequestEvent() at handler entry.
// Lambda runs one request at a time per instance, so this is safe.
let _currentEvent = null;

function setRequestEvent(event) {
  _currentEvent = event;
}

function getCorsOrigin() {
  const origin = _currentEvent?.headers?.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.startsWith('http://localhost:')) return origin;
  return ALLOWED_ORIGINS[0] || '';
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getCorsOrigin(),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: corsHeaders(),
    body: '',
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message, details) {
  return jsonResponse(statusCode, {
    success: false,
    error: message,
    details,
  });
}

function ok(body) {
  return jsonResponse(200, body);
}

function badRequest(message, details) {
  return errorResponse(400, message, details);
}

function serverError(message, details) {
  return errorResponse(500, message || 'Internal server error', details);
}

module.exports = {
  setRequestEvent,
  jsonResponse,
  errorResponse,
  preflightResponse,
  corsHeaders,
  ok,
  badRequest,
  serverError,
};
