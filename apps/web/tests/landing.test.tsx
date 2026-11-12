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
      screen.getByRole('heading', { level: 1, name: /stake it\. prove it\. grow it\./i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a pact/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /how it works/i })).toBeInTheDocument()
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
