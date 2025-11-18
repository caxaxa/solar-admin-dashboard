import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  GetUserCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { awsConfig } from './aws-config';

const cognitoClient = new CognitoIdentityProviderClient({
  region: awsConfig.region,
});

export interface AuthResult {
  success: boolean;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  error?: string;
}

export interface UserInfo {
  username: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: awsConfig.cognito.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

    if (response.AuthenticationResult) {
      return {
        success: true,
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
      };
    }

    return {
      success: false,
      error: 'Authentication failed',
    };
  } catch (error) {
    console.error('Auth error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };
  }
}

export async function getUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const command = new GetUserCommand({
      AccessToken: accessToken,
    });

    const response = await cognitoClient.send(command);
    const email = response.UserAttributes?.find(attr => attr.Name === 'email')?.Value || '';
    const username = response.Username || '';

    // Get user groups
    const groupsCommand = new AdminListGroupsForUserCommand({
      UserPoolId: awsConfig.cognito.userPoolId,
      Username: username,
    });

    const groupsResponse = await cognitoClient.send(groupsCommand);
    const groups = groupsResponse.Groups?.map(g => g.GroupName || '') || [];
    const isAdmin = groups.includes('admin');

    return {
      username,
      email,
      groups,
      isAdmin,
    };
  } catch (error) {
    console.error('Get user info error:', error);
    return null;
  }
}

export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Date.now() >= payload.exp * 1000;
}
