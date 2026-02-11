/**
 * Tests for auth utility — JWT parsing and token expiry.
 *
 * Only tests pure functions (parseJwt, isTokenExpired). Network-dependent
 * functions (authenticateUser, getUserInfo) are tested via integration tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AWS Cognito client to prevent real SDK initialization
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const mockSend = vi.fn()
  return {
    CognitoIdentityProviderClient: class {
      send = mockSend
    },
    InitiateAuthCommand: class {},
    GetUserCommand: class {},
    AdminListGroupsForUserCommand: class {},
  }
})

// Mock the aws-config module
vi.mock('@/lib/aws-config', () => ({
  awsConfig: {
    region: 'us-east-2',
    cognito: {
      userPoolId: 'us-east-2_test',
      clientId: 'test-client-id',
    },
  },
}))

function createJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const signature = 'test-signature'
  return `${header}.${body}.${signature}`
}

describe('parseJwt', () => {
  it('parses a valid JWT payload', async () => {
    const { parseJwt } = await import('@/lib/auth')
    const token = createJwt({ sub: 'user-123', email: 'test@example.com' })
    const result = parseJwt(token)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('user-123')
    expect(result!.email).toBe('test@example.com')
  })

  it('returns null for empty string', async () => {
    const { parseJwt } = await import('@/lib/auth')
    expect(parseJwt('')).toBeNull()
  })

  it('returns null for malformed token', async () => {
    const { parseJwt } = await import('@/lib/auth')
    expect(parseJwt('not-a-jwt')).toBeNull()
  })

  it('returns null for invalid base64', async () => {
    const { parseJwt } = await import('@/lib/auth')
    expect(parseJwt('header.!!!invalid-base64!!!.signature')).toBeNull()
  })

  it('handles tokens with URL-safe base64 characters', async () => {
    const { parseJwt } = await import('@/lib/auth')
    // Create a payload that would use - and _ in base64
    const payload = { data: 'test>>>data<<<' }
    const token = createJwt(payload)
    const result = parseJwt(token)
    expect(result).not.toBeNull()
    expect(result!.data).toBe('test>>>data<<<')
  })

  it('parses exp claim as number', async () => {
    const { parseJwt } = await import('@/lib/auth')
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = createJwt({ exp })
    const result = parseJwt(token)
    expect(result!.exp).toBe(exp)
  })
})

describe('isTokenExpired', () => {
  it('returns false for token expiring in the future', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    const futureExp = Math.floor(Date.now() / 1000) + 3600
    const token = createJwt({ exp: futureExp })
    expect(isTokenExpired(token)).toBe(false)
  })

  it('returns true for expired token', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    const pastExp = Math.floor(Date.now() / 1000) - 3600
    const token = createJwt({ exp: pastExp })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true when exp is exactly now', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    const nowExp = Math.floor(Date.now() / 1000)
    const token = createJwt({ exp: nowExp })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true for invalid token', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    expect(isTokenExpired('garbage')).toBe(true)
  })

  it('returns true when exp claim is missing', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    const token = createJwt({ sub: 'user-123' })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true when exp is not a number', async () => {
    const { isTokenExpired } = await import('@/lib/auth')
    const token = createJwt({ exp: 'not-a-number' })
    expect(isTokenExpired(token)).toBe(true)
  })
})
