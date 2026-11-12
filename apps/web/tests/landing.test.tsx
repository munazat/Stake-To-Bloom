import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing, { SandboxBanner } from '../src/routes/Landing.tsx'

describe('Landing', () => {
  it('renders the app name and pitch', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: /make your habits bloom/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a pact/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /how bloomstake works/i })).toBeInTheDocument()
  })

  it('shows the test-mode indicator', () => {
    render(
      <MemoryRouter>
        <SandboxBanner />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/PayPal sandbox/i)
  })
})
