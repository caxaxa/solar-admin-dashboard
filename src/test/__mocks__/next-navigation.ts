/**
 * Lightweight stub for next/navigation to prevent loading the full Next.js runtime in tests.
 * Tests can override individual functions via vi.mock() as needed.
 */
import { vi } from 'vitest'

export const useRouter = vi.fn(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}))

export const usePathname = vi.fn(() => '/')
export const useSearchParams = vi.fn(() => new URLSearchParams())
export const useParams = vi.fn(() => ({}))
export const redirect = vi.fn()
export const notFound = vi.fn()
