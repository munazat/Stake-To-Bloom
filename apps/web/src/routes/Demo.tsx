import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { startDemo } from '../lib/api.ts'
import { isSupabaseConfigured } from '../lib/config.ts'
import { SandboxBanner } from './Landing.tsx'

export default function DemoRoute() {
  const navigate = useNavigate()
  const start = useMutation({
    mutationFn: startDemo,
    onSuccess: (demo) => navigate(`/pact/${demo.pactId}`),
  })
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto max-w-2xl px-5 py-10">
        <Link to="/" className="text-sm text-emerald-800 hover:underline">
          ← BloomStake
        </Link>
        <h1 className="mt-5 text-3xl font-extrabold text-emerald-900">See a pact in action</h1>
        <p className="mt-3 text-base text-slate-600">
          Follow a sample wellness pact from proof to garden. Stakes are simulated.
        </p>
        <ol className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
          <li className="py-4 first:pt-0">
            <strong>1. Start a sample pool.</strong> See three simulated participants and their
            pacts.
          </li>
          <li className="py-4">
            <strong>2. Submit one proof.</strong> Use your own image or a generated sample.
          </li>
          <li className="py-4 last:pb-0">
            <strong>3. Advance the week.</strong> Simulated days show how the garden changes without
            extra AI or payment calls.
          </li>
        </ol>
        <p className="mt-4 text-sm text-slate-500">
          Demo data is saved to this browser session. No real money moves.
        </p>
        <button
          type="button"
          disabled={!isSupabaseConfigured || start.isPending}
          onClick={() => start.mutate()}
          className="mt-7 bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {start.isPending ? 'Planting demo…' : 'Start the demo'}
        </button>
        {!isSupabaseConfigured && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            Connect Supabase to start a saved demo. The hosted project is not wired yet.
          </p>
        )}
        {start.error && (
          <p role="alert" className="mt-3 text-sm text-rose-800">
            {(start.error as Error).message}
          </p>
        )}
      </main>
    </div>
  )
}
