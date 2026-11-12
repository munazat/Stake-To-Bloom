import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { startDemo } from '../lib/api.ts'
import { isSupabaseConfigured } from '../lib/config.ts'
import { SandboxBanner } from './Landing.tsx'
import PageHeading from '../components/PageHeading.tsx'

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
        <PageHeading icon="🎈" tone="lilac" title="See a pact in action" className="mt-5">
          <p>Follow a sample wellness pact from proof to garden. Stakes are simulated.</p>
        </PageHeading>
        <ol className="demo-steps mt-8 divide-y divide-slate-200 border-y border-slate-200">
          <li className="py-4 first:pt-0">
            <span className="demo-step-icon demo-step-icon--mint" aria-hidden="true">
              🌱
            </span>
            <span>
              <strong>1. Start a sample pool.</strong> See three simulated participants and their
              pacts.
            </span>
          </li>
          <li className="py-4">
            <span className="demo-step-icon demo-step-icon--coral" aria-hidden="true">
              📷
            </span>
            <span>
              <strong>2. Submit one proof.</strong> Use your own image or a generated sample.
            </span>
          </li>
          <li className="py-4 last:pb-0">
            <span className="demo-step-icon demo-step-icon--sky" aria-hidden="true">
              ⏩
            </span>
            <span>
              <strong>3. Advance the week.</strong> Simulated days show how the garden changes
              without extra AI or payment calls.
            </span>
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
