const defaultHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
};

function preflightResponse() {
  return {
    statusCode: 204,
    headers: defaultHeaders,
    body: '',
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: defaultHeaders,
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
  jsonResponse,
  errorResponse,
  preflightResponse,
  defaultHeaders,
  ok,
  badRequest,
  serverError,
};
