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

describe('PactNew wizard', () => {
  it('offers the four template goals and shows custom as unavailable', () => {
    renderWizard()
    for (const label of ['Steps', 'Water', 'Healthy meal', 'Workout']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByText(/Custom goal/i)).toBeInTheDocument()
    expect(screen.getByText(/Gemini key/i)).toBeInTheDocument()
  })

  it('previews the same contract hash the Edge Function stores', async () => {
    renderWizard()
    await goToContract()
    // stepsSpec() at its defaults, captured from pacts.rule_hash on the local stack.
    expect(
      await screen.findByText('40469b9d5599712666c7993f03287ef1896f46c4ce27f03d2b3d5ac458f91300'),
    ).toBeInTheDocument()
  })

  it('switching goal rebuilds the contract and its hash', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /Water/ }))
    await goToContract()
    // The title also appears inside the canonical JSON preview, so match the heading.
    expect(
      await screen.findByRole('heading', { name: /Drink 2500 ml of water/ }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('8f75f7027ef2ec85fc7178537439fb17b3dd0572f73a684389541518e9b9eda2'),
    ).toBeInTheDocument()
  })

  it('shows the exact JSON that will be hashed', async () => {
    renderWizard()
    await goToContract()
    fireEvent.click(screen.getByText(/Show the exact JSON/i))
    const pre = await screen.findByText(/"goalType":"steps"/)
    // canonicalJson sorts keys, so checks comes before goalType in the output.
    expect(pre.textContent?.startsWith('{"checks":')).toBe(true)
    expect(pre.textContent).toContain('"requiredPasses":5')
  })

  it('warns that nothing can be saved until Supabase is configured', () => {
    renderWizard()
    // Tests run without VITE_SUPABASE_*, which is the same state as a fresh clone.
    expect(screen.getByRole('alert')).toHaveTextContent(/Supabase is not configured/i)
  })
})
