/**
 * Tests for ProjectsList — loading, rendering, empty state, error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  FolderOpen: () => <span>FolderOpen</span>,
  ChevronRight: () => <span>&gt;</span>,
  Loader2: ({ className }: any) => <span className={className}>Loading</span>,
  Plus: () => <span>+</span>,
  Play: () => <span>Play</span>,
  Clock: () => <span>Clock</span>,
  Upload: () => <span>Upload</span>,
  Trash2: () => <span>Trash</span>,
}))

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  buildApiUrl: (path: string) => `http://localhost:3001${path}`,
}))

// Mock CreateProjectModal
vi.mock('../../shared/CreateProjectModal', () => ({
  CreateProjectModal: () => <div data-testid="create-modal" />,
}))

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

import { ProjectsList } from '../ProjectsList'

describe('ProjectsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  it('shows loading spinner initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ProjectsList />)
    expect(screen.getByText('Loading projects...')).toBeInTheDocument()
  })

  it('renders projects after fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [
          {
            orgId: 'org-1',
            projectId: 'proj-1',
            environment: 'prod',
            projectName: 'Solar Farm Alpha',
            status: 'completed',
          },
        ],
        pendingProjects: [],
        organizations: { 'org-1': { email: 'admin@example.com' } },
      }),
    })

    render(<ProjectsList />)
    await waitFor(() => {
      expect(screen.getByText('Solar Farm Alpha')).toBeInTheDocument()
    })
  })

  it('shows empty state when no projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [],
        pendingProjects: [],
        organizations: {},
      }),
    })

    render(<ProjectsList />)
    await waitFor(() => {
      expect(screen.getByText(/no projects/i)).toBeInTheDocument()
    })
  })

  it('shows error message on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    render(<ProjectsList />)
    await waitFor(() => {
      expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument()
    })
  })

  it('renders pending projects section', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [],
        pendingProjects: [
          {
            orgId: 'org-1',
            projectId: 'pending-1',
            projectName: 'New Farm',
            status: 'uploading',
            fileCount: 50,
            totalSizeBytes: 1000000000,
            createdAt: Date.now() / 1000 - 3600,
            environment: 'dev',
          },
        ],
        organizations: { 'org-1': { email: 'user@example.com' } },
      }),
    })

    render(<ProjectsList />)
    await waitFor(() => {
      expect(screen.getByText('New Farm')).toBeInTheDocument()
    })
  })

  it('calls fetch with correct API URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects: [], pendingProjects: [], organizations: {} }),
    })

    render(<ProjectsList />)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/projects')
    })
  })
})
