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
    expect(screen.getByRole('heading', { name: /bloomstake/i })).toBeInTheDocument()
    expect(screen.getByText(/AI vision referee/i)).toBeInTheDocument()
  })

  it('always shows the sandbox banner', () => {
    render(
      <MemoryRouter>
        <SandboxBanner />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/Sandbox Mode — No Real Money/i)
  })
})
