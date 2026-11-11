import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../src/lib/config.ts', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: 'http://x',
  supabaseAnonKey: 'k',
  paymentsAdapter: 'mock',
  paypalClientId: '',
  edgeFunctionUrl: (n: string) => `http://x/functions/v1/${n}`,
}))
const createStakeOrder = vi.fn()
const captureStakeOrder = vi.fn()
vi.mock('../src/lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../src/lib/api.ts')>()),
  createStakeOrder: (id: string) => createStakeOrder(id),
  captureStakeOrder: (id: string, mode: string) => captureStakeOrder(id, mode),
}))
const fetchAuditEvents = vi.fn()
vi.mock('../src/lib/audit.ts', async (orig) => ({
  ...(await orig<typeof import('../src/lib/audit.ts')>()),
  fetchAuditEvents: () => fetchAuditEvents(),
}))

import StakeButton from '../src/routes/StakeButton.tsx'
import Audit from '../src/routes/Audit.tsx'
import { maskEmail } from '../src/lib/audit.ts'
import { ApiError } from '../src/lib/api.ts'

beforeEach(() => {
  createStakeOrder.mockReset()
  captureStakeOrder.mockReset()
  fetchAuditEvents.mockReset()
})

describe('maskEmail', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('munaza@example.com')).toBe('m***@example.com')
    expect(maskEmail(null)).toBe('')
    expect(maskEmail('not-an-email')).toBe('***')
  })
})

describe('StakeButton (mock adapter)', () => {
  it('creates the order from the pact id only, captures it, then reports funded', async () => {
    createStakeOrder.mockResolvedValue('MOCK-ORDER.p1.2000.1')
    captureStakeOrder.mockResolvedValue({ status: 'ACTIVE', funded: true })
    const onFunded = vi.fn()
    render(<StakeButton pactId="p1" stakeCents={2000} onFunded={onFunded} />)
    fireEvent.click(screen.getByRole('button', { name: /Stake \$20\.00/ }))
    await waitFor(() => expect(onFunded).toHaveBeenCalledTimes(1))
    expect(createStakeOrder).toHaveBeenCalledWith('p1')
    expect(captureStakeOrder).toHaveBeenCalledWith('MOCK-ORDER.p1.2000.1', 'capture')
  })

  it('says nothing was charged when the kill switch answers 503', async () => {
    createStakeOrder.mockRejectedValue(new ApiError(503, { code: 'payments_disabled', message: 'off' }))
    const onFunded = vi.fn()
    render(<StakeButton pactId="p1" stakeCents={2000} onFunded={onFunded} />)
    fireEvent.click(screen.getByRole('button', { name: /Stake/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was charged/)
    expect(onFunded).not.toHaveBeenCalled()
  })
})

describe('Audit', () => {
  it('lists real ids and amounts as plain text', async () => {
    fetchAuditEvents.mockResolvedValue([
      {
        id: 1,
        source: 'API',
        eventType: 'PAYMENT.CAPTURE.COMPLETED',
        resourceId: '<b>CAP123</b>',
        pactId: 'p1',
        status: 'COMPLETED',
        amountCents: 2000,
        verified: true,
        createdAt: new Date().toISOString(),
      },
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Audit />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('PAYMENT.CAPTURE.COMPLETED')).toBeInTheDocument()
    expect(screen.getByText('$20.00')).toBeInTheDocument()
    expect(screen.getByText(/<b>CAP123<\/b>/)).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
  })

  it('shows an empty state', async () => {
    fetchAuditEvents.mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Audit />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/No PayPal activity yet/)).toBeInTheDocument()
  })
})
