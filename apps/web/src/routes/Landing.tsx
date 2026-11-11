import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../lib/config.ts'

export function SandboxBanner() {
  return (
    <div
      role="status"
      className="w-full bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950"
    >
      Sandbox Mode — No Real Money
    </div>
  )
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <span aria-hidden className="text-6xl">
          🌱
        </span>

        <h1 className="text-4xl font-extrabold tracking-tight text-emerald-800 sm:text-5xl">
          BloomStake
        </h1>

        <p className="max-w-xl text-lg text-slate-600">
          Put real skin in the game for your daily wellness goals. Lock a stake, upload daily proof,
          and let an AI vision referee feed a deterministic rule engine — your 2.5D garden blooms on
          verified days and wilts when you miss them.
        </p>

        <p className="max-w-xl text-sm text-slate-500">
          The AI only <em>perceives</em>. It never decides money. A code-level rule engine settles
          every payout, guarded by strict invariants.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/pact/new"
            className="rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Create a Pact
          </Link>
          <Link
            to="/garden"
            className="rounded-full border border-emerald-600 px-5 py-2 font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            View Garden
          </Link>
          <Link
            to="/demo"
            className="rounded-full border border-emerald-600 px-5 py-2 font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Try Demo
          </Link>
        </div>

        <p className="mt-6 text-xs uppercase tracking-wide text-slate-400">
          {isSupabaseConfigured ? 'Supabase connected' : 'Supabase not configured yet'}
        </p>
      </main>

      <footer className="border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
        Built for the PayPal AI Hackathon · MIT License · Sandbox only
      </footer>
    </div>
  )
}
