import { Link } from 'react-router-dom'
import { SandboxBanner } from './Landing.tsx'

export default function AboutRoute() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />
      <main className="mx-auto max-w-3xl px-5 py-10">
        <Link to="/" className="text-sm text-emerald-800 hover:underline">
          ← BloomStake
        </Link>
        <h1 className="mt-5 text-3xl font-extrabold text-emerald-900">About BloomStake</h1>
        <p className="mt-3 text-slate-600">
          BloomStake turns a seven-day wellness goal into a visible commitment: plant a seed, submit
          daily evidence, and watch a garden respond to verified progress.
        </p>
        <h2 className="mt-8 text-xl font-bold">How decisions work</h2>
        <p className="mt-2 text-slate-600">
          Gemini reads what is in your image, such as the date and the number. Fixed rules then
          check that against the rules you sealed when you staked. The AI never decides a pass or a
          fail and it never moves money.
        </p>
        <h2 className="mt-7 text-xl font-bold">Payments and demo</h2>
        <p className="mt-2 text-slate-600">
          Payments are sandbox-only. The guided demo uses labelled simulated stakes and simulated
          days; they are not PayPal transactions. Real sandbox stakes use PayPal's test environment
          with test buyer accounts, so no real money ever moves.
        </p>
        <h2 className="mt-7 text-xl font-bold">Privacy</h2>
        <p className="mt-2 text-slate-600">
          Proof images are sent to the configured referee service for evaluation. Do not upload
          sensitive images or personal documents. Clearing browser data removes the guest session
          and its demo garden.
        </p>
        <h2 className="mt-7 text-xl font-bold">Built with</h2>
        <p className="mt-2 text-slate-600">
          React, Supabase, Gemini, PayPal Sandbox, and a rules engine written in TypeScript. Design
          patterns were informed by the author’s earlier{' '}
          <a
            className="text-emerald-800 underline"
            href="https://github.com/Shahoud867/health-garden-app"
            target="_blank"
            rel="noreferrer"
          >
            Health Garden project
          </a>
          ; BloomStake’s money, referee gate, and settlement code are written for this project.
        </p>
        <p className="mt-8 text-xs text-slate-500">
          © BloomStake · MIT License
        </p>
      </main>
    </div>
  )
}
