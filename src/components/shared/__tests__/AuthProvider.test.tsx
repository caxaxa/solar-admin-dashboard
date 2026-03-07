/**
 * Tests for AuthProvider — auth check, admin guard, idle timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { useRouter, usePathname } from 'next/navigation'

// Override the stub defaults for our tests
const mockPush = vi.fn()
vi.mocked(useRouter).mockReturnValue({
  push: mockPush,
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
} as ReturnType<typeof useRouter>)
vi.mocked(usePathname).mockReturnValue('/dashboard')

vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader" {...props}>Loading</span>,
}))

vi.mock('@/lib/auth', () => ({
  isTokenExpired: vi.fn().mockReturnValue(false),
  refreshAccessToken: vi.fn().mockResolvedValue('new-token'),
}))

import { AuthProvider } from '../AuthProvider'

// localStorage mock
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

const validAdmin = JSON.stringify({
  username: 'admin', email: 'admin@test.com', groups: ['admins'], isAdmin: true,
})
const nonAdmin = JSON.stringify({
  username: 'user', email: 'user@test.com', groups: ['users'], isAdmin: false,
})

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    } as ReturnType<typeof useRouter>)
    localStorageMock.getItem.mockReturnValue(null)
  })

  it('redirects to /login when no accessToken', () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return null
      if (key === 'user') return validAdmin
      return null
    })

    render(<AuthProvider><div>Secret</div></AuthProvider>)

    expect(mockPush).toHaveBeenCalledWith('/login')
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('redirects to /login when no user in localStorage', () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return 'tok'
      if (key === 'user') return null
      return null
    })

    render(<AuthProvider><div>Secret</div></AuthProvider>)

    expect(mockPush).toHaveBeenCalledWith('/login')
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('redirects non-admin user to /login and clears storage', async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return 'tok'
      if (key === 'user') return nonAdmin
      return null
    })

    render(<AuthProvider><div>Secret</div></AuthProvider>)

    await waitFor(() => {
      expect(localStorageMock.clear).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('renders children for valid admin', async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return 'tok'
      if (key === 'user') return validAdmin
      return null
    })

    render(<AuthProvider><div>Admin Content</div></AuthProvider>)

    await waitFor(() => {
      expect(screen.getByText('Admin Content')).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders children on /login path without auth check', () => {
    vi.mocked(usePathname).mockReturnValue('/login')

    render(<AuthProvider><div>Login Page</div></AuthProvider>)

    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows loading state while redirecting unauthenticated protected route', () => {
    render(<AuthProvider><div>Secret</div></AuthProvider>)
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
    expect(screen.getByTestId('loader')).toBeInTheDocument()
  })

  describe('idle timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'accessToken') return 'tok'
        if (key === 'user') return validAdmin
        return null
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('logs out after 1 hour of idle', async () => {
      render(<AuthProvider><div>Content</div></AuthProvider>)

      // Flush the async checkAuth microtask so the component renders children
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('Content')).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(3_600_000) })

      expect(localStorageMock.clear).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })

    it('resets idle timer on mousemove', async () => {
      render(<AuthProvider><div>Content</div></AuthProvider>)

      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('Content')).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(3_000_000) })
      act(() => { window.dispatchEvent(new Event('mousemove')) })
      act(() => { vi.advanceTimersByTime(3_000_000) })

      expect(localStorageMock.clear).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(600_000) })

      expect(localStorageMock.clear).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })
})
