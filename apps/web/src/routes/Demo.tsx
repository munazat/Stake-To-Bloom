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
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />
      <main className="mx-auto max-w-2xl px-5 py-10">
        <Link to="/" className="text-sm text-emerald-800 hover:underline">
          ← BloomStake
        </Link>
        <h1 className="mt-5 text-3xl font-extrabold text-emerald-900">The 90-second guided demo</h1>
        <p className="mt-3 text-slate-600">
          See how a wellness pact grows a garden and how a deterministic settlement divides
          simulated stakes. No real money moves.
        </p>
        <ol className="mt-6 space-y-4 rounded-2xl border border-emerald-100 bg-white p-5">
          <li>
            <strong>1. Plant your seed.</strong> Start a demo pool with Mia (passes), Omar and Zed
            (miss). All four stakes are simulated.
          </li>
          <li>
            <strong>2. Submit one real proof.</strong> The first day uses the normal image pipeline
            and deterministic referee. You can use the browser-generated sample.
          </li>
          <li>
            <strong>3. Fast-forward.</strong> Once your real proof passes, advance the rest of the
            pool. Simulated days make no AI or payment call.
          </li>
        </ol>
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Clearing site data loses this demo garden. Your guest session is stored in this browser.
        </p>
        <button
          type="button"
          disabled={!isSupabaseConfigured || start.isPending}
          onClick={() => start.mutate()}
          className="mt-6 rounded-full bg-emerald-700 px-6 py-3 font-semibold text-white disabled:opacity-50"
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
