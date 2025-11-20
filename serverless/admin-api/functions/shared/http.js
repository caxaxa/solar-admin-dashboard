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

module.exports = {
  jsonResponse,
  errorResponse,
  preflightResponse,
  defaultHeaders,
};
