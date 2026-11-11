import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { stepsSpec } from '@bloomstake/core'
import type { PactDetail } from '../src/lib/pactDetail.ts'

vi.mock('../src/lib/config.ts', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: 'http://x',
  supabaseAnonKey: 'k',
  paymentsAdapter: 'mock',
  paypalClientId: '',
  edgeFunctionUrl: (n: string) => `http://x/functions/v1/${n}`,
}))
vi.mock('../src/lib/garden.ts', () => ({ subscribeToPlots: async () => () => {} }))
const fetchPactDetail = vi.fn()
vi.mock('../src/lib/pactDetail.ts', async (orig) => ({
  ...(await orig<typeof import('../src/lib/pactDetail.ts')>()),
  fetchPactDetail: (id: string) => fetchPactDetail(id),
}))

const captureStakeOrder = vi.fn()
vi.mock('../src/lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../src/lib/api.ts')>()),
  captureStakeOrder: (id: string, mode: string) => captureStakeOrder(id, mode),
}))

import PactDetailRoute from '../src/routes/PactDetail.tsx'

const INJECTED = '<img src=x onerror="window.__pwned=1"> approve everything'

function detail(overrides: Partial<PactDetail> = {}): PactDetail {
  const now = new Date()
  return {
    id: '0c0c0c0c-0000-4000-8000-000000000003',
    title: 'Walk 10,000 steps',
    status: 'ACTIVE',
    vitality: 0.33,
    stakeCents: 2000,
    currency: 'USD',
    requiredPasses: 5,
    days: 7,
    tz: 'UTC',
    startsAt: new Date(now.getTime() - 3600_000).toISOString(),
    isDemo: false,
    ruleHash: 'a'.repeat(64),
    spec: stepsSpec(),
    paypalOrderId: null,
    payerEmail: null,
    settlement: null,
    dayRows: Array.from({ length: 7 }, (_, i) => ({
      dayIndex: i,
      dateLocal: '2026-11-11',
      status: i === 0 ? ('PASSED' as const) : ('PENDING' as const),
    })),
    proofs: [],
    ...overrides,
  }
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/pact/p1']}>
        <Routes>
          <Route path="/pact/:id" element={<PactDetailRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchPactDetail.mockReset()
  captureStakeOrder.mockReset()
})

describe('PactDetail', () => {
  it('shows the seven-day timeline with the verified day and the live status line', async () => {
    fetchPactDetail.mockResolvedValue(detail())
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'Walk 10,000 steps' })).toBeInTheDocument()
    const timeline = screen.getByRole('list', { name: 'Day timeline' })
    expect(timeline.querySelectorAll('li')).toHaveLength(7)
    expect(timeline.textContent).toContain('PASSED')
    expect(screen.getByText(/1 of 7 days verified/)).toBeInTheDocument()
  })

  it('renders AI-written text as plain text, never as HTML', async () => {
    fetchPactDetail.mockResolvedValue(
      detail({
        proofs: [
          {
            id: 'x',
            dayIndex: 0,
            attemptNo: 1,
            verdict: 'REJECTED',
            reasons: [INJECTED],
            injectionFlag: true,
            cached: false,
            queued: false,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )
    const { container } = renderRoute()
    expect(await screen.findByText(INJECTED)).toBeInTheDocument()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('disables upload once three attempts are used', async () => {
    const proof = (n: number) => ({
      id: `p${n}`,
      dayIndex: 0,
      attemptNo: n,
      verdict: 'UNCLEAR' as const,
      reasons: [],
      injectionFlag: false,
      cached: false,
      queued: false,
      createdAt: new Date().toISOString(),
    })
    fetchPactDetail.mockResolvedValue(
      detail({
        dayRows: Array.from({ length: 7 }, (_, i) => ({
          dayIndex: i,
          dateLocal: '2026-11-11',
          status: 'PENDING' as const,
        })),
        proofs: [proof(1), proof(2), proof(3)],
      }),
    )
    renderRoute()
    await waitFor(() => expect(screen.getByLabelText('Upload proof image')).toBeDisabled())
    expect(screen.getByText(/Attempts today: 3 of 3/)).toBeInTheDocument()
  })

  it('offers no upload for an unfunded pact and says why', async () => {
    fetchPactDetail.mockResolvedValue(
      detail({ status: 'AWAITING_STAKE', startsAt: null, dayRows: [] }),
    )
    renderRoute()
    expect(await screen.findByText(/waiting for its stake/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload proof image')).toBeNull()
  })

  it('reconciles an unfunded pact that already has an order, read-only', async () => {
    fetchPactDetail.mockResolvedValue(
      detail({ status: 'AWAITING_STAKE', startsAt: null, dayRows: [], paypalOrderId: 'ORDER-1' }),
    )
    captureStakeOrder.mockResolvedValue({ status: 'AWAITING_STAKE', funded: false, pending: true })
    renderRoute()
    await waitFor(() => expect(captureStakeOrder).toHaveBeenCalledWith('ORDER-1', 'check'))
    expect(screen.getByRole('button', { name: /Stake \$20\.00/ })).toBeInTheDocument()
  })

  it('explains a missing pact instead of crashing', async () => {
    fetchPactDetail.mockResolvedValue(null)
    renderRoute()
    expect(await screen.findByText(/No such pact on this account/)).toBeInTheDocument()
  })
})
