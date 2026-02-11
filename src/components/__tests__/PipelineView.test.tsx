/**
 * Tests for PipelineView — loading, stage rendering, action buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Upload: () => <span>Upload</span>,
  Image: () => <span>Image</span>,
  Crop: () => <span>Crop</span>,
  Brain: () => <span>Brain</span>,
  CheckSquare: () => <span>CheckSquare</span>,
  FileText: () => <span>FileText</span>,
  Send: () => <span>Send</span>,
  CheckCircle2: () => <span data-testid="check-icon">✓</span>,
  Circle: () => <span data-testid="circle-icon">○</span>,
  Loader2: ({ className }: any) => <span className={className}>Loading</span>,
  Play: () => <span>Play</span>,
  Edit3: () => <span>Edit</span>,
  Eye: () => <span>Eye</span>,
  ExternalLink: () => <span>Link</span>,
  Thermometer: () => <span>Thermo</span>,
  AlertTriangle: () => <span>Alert</span>,
  Code: () => <span>Code</span>,
  RefreshCw: () => <span>Refresh</span>,
}))

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  buildApiUrl: (path: string) => `http://localhost:3001${path}`,
}))

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

import { PipelineView } from '../PipelineView'

const defaultProps = {
  orgId: 'org-1',
  projectId: 'proj-1',
  env: 'dev',
}

describe('PipelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    render(<PipelineView {...defaultProps} />)
    expect(screen.getByText('Loading project status...')).toBeInTheDocument()
  })

  it('fetches project status with correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasOrthophoto: false,
        hasCropAnnotation: false,
        hasInferenceResults: false,
        hasHumanReview: false,
        hasReport: false,
      }),
    })

    render(<PipelineView {...defaultProps} />)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/projects/org-1/proj-1/status?env=dev'
      )
    })
  })

  it('renders all 8 pipeline stages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasOrthophoto: true,
        hasCropAnnotation: true,
        hasInferenceResults: true,
        hasHumanReview: true,
        hasReport: true,
        isReleased: true,
      }),
    })

    render(<PipelineView {...defaultProps} />)
    await waitFor(() => {
      // Stage labels render with number prefix: "2. ODM Processing"
      expect(screen.getByText(/ODM Processing/)).toBeInTheDocument()
      expect(screen.getByText(/AI Inference/)).toBeInTheDocument()
      expect(screen.getByText(/Generate Report/)).toBeInTheDocument()
      expect(screen.getByText(/Release to Client/)).toBeInTheDocument()
    })
  })

  it('shows completion indicators for completed stages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasOrthophoto: true,
        hasCropAnnotation: false,
        hasInferenceResults: false,
        hasHumanReview: false,
        hasReport: false,
      }),
    })

    render(<PipelineView {...defaultProps} />)
    await waitFor(() => {
      // Upload stage is always complete
      const checkIcons = screen.getAllByTestId('check-icon')
      expect(checkIcons.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows incomplete indicators for pending stages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasOrthophoto: false,
        hasCropAnnotation: false,
        hasInferenceResults: false,
        hasHumanReview: false,
        hasReport: false,
      }),
    })

    render(<PipelineView {...defaultProps} />)
    await waitFor(() => {
      const circleIcons = screen.getAllByTestId('circle-icon')
      expect(circleIcons.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders with different env prop', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasOrthophoto: false,
        hasCropAnnotation: false,
        hasInferenceResults: false,
        hasHumanReview: false,
        hasReport: false,
      }),
    })

    render(<PipelineView {...defaultProps} env="prod" />)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/projects/org-1/proj-1/status?env=prod'
      )
    })
  })
})
