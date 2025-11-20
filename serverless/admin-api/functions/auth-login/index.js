const { cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

async function authenticateUser(email, password) {
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!clientId) {
    throw new Error('Missing Cognito client id');
  }

  const params = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  };

  const response = await cognito.initiateAuth(params).promise();
  return response.AuthenticationResult;
}

async function getUserInfo(accessToken) {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!accessToken) {
    return null;
  }

  const userResponse = await cognito
    .getUser({
      AccessToken: accessToken,
    })
    .promise();

  const emailAttr = userResponse.UserAttributes?.find(
    (attr) => attr.Name === 'email'
  );
  const email = emailAttr?.Value || '';
  const username = userResponse.Username || '';

  const groupsResponse = await cognito
    .adminListGroupsForUser({
      UserPoolId: userPoolId,
      Username: username,
    })
    .promise();

  const groups = groupsResponse.Groups?.map((group) => group.GroupName || '') || [];
  const isAdmin = groups.includes('admin');

  return {
    username,
    email,
    groups,
    isAdmin,
  };
}

exports.handler = async (event) => {
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }
  try {
    const { email, password } = parseBody(event);

    if (!email || !password) {
      return errorResponse(400, 'Email and password are required');
    }

    const authResult = await authenticateUser(email, password);
    if (!authResult?.AccessToken) {
      return errorResponse(401, 'Authentication failed');
    }

    const userInfo = await getUserInfo(authResult.AccessToken);
    if (!userInfo?.isAdmin) {
      return errorResponse(403, 'Access denied. Admin privileges required.');
    }

    return jsonResponse(200, {
      success: true,
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
      user: userInfo,
    });
  } catch (error) {
    console.error('Login error', error);
    return errorResponse(500, 'Internal server error');
  }
};
