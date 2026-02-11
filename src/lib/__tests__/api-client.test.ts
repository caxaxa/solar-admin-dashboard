/**
 * Tests for api-client — URL building and normalization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('buildApiUrl', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('prefixes path with base URL from env', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('/projects')).toBe('https://api.example.com/projects')
  })

  it('normalizes path without leading slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('projects')).toBe('https://api.example.com/projects')
  })

  it('returns absolute URLs unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('https://other.com/api')).toBe('https://other.com/api')
  })

  it('returns http absolute URLs unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api')
  })

  it('strips trailing slash from base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com/')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('/health')).toBe('https://api.example.com/health')
  })

  it('uses empty string when env var is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', '')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('/projects')).toBe('/projects')
  })

  it('handles nested paths', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_API_BASE_URL', 'https://api.example.com')
    const { buildApiUrl } = await import('@/lib/api-client')
    expect(buildApiUrl('/api/projects/123/status')).toBe(
      'https://api.example.com/api/projects/123/status'
    )
  })
})
