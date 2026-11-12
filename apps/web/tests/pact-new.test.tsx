import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PactNew from '../src/routes/PactNew.tsx'

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PactNew />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Click through to step 3, where the contract and its preview hash are shown. */
async function goToContract() {
  fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
  fireEvent.click(screen.getByRole('button', { name: /Review contract/i }))
}

describe('PactNew custom goal', () => {
  it('needs a described habit before Next, and asks for the AI draft on the contract step', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /Custom goal/i }))
    expect(screen.getByRole('button', { name: /^Next$/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Describe your habit/i), {
      target: { value: 'Read 20 pages and show the book' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    // No template threshold or title for a custom goal: the AI proposes the checks.
    expect(screen.queryByLabelText(/Daily target/i)).toBeNull()
    expect(screen.queryByLabelText(/^Title/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Review contract/i }))
    expect(screen.getByRole('button', { name: /Draft contract with AI/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lock this contract/i })).toBeNull()
  })
})

describe('PactNew wizard', () => {
  it('offers the four template goals and a custom goal', () => {
    renderWizard()
    for (const label of ['Steps', 'Water', 'Healthy meal', 'Workout']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /Custom goal/i })).toBeInTheDocument()
  })

  it('shows the rules in plain language and keeps technical hashes out of sight', async () => {
    renderWizard()
    await goToContract()
    expect(await screen.findByRole('heading', { name: /^Your rules$/ })).toBeInTheDocument()
    expect(screen.queryByText(/sha256|rule_hash|fingerprint|canonicalJson/i)).toBeNull()
    expect(screen.queryByText(/[0-9a-f]{64}/)).toBeNull()
  })

  it('switching goal rebuilds the rules', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /Water/ }))
    await goToContract()
    expect(
      await screen.findByRole('heading', { name: /Drink 2500 ml of water/ }),
    ).toBeInTheDocument()
  })

  it('warns that nothing can be saved until Supabase is configured', () => {
    renderWizard()
    // Tests run without VITE_SUPABASE_*, which is the same state as a fresh clone.
    expect(screen.getByRole('alert')).toHaveTextContent(/Supabase is not configured/i)
  })
})
