/**
 * Audit.tsx — /audit. The live PayPal feed: real order and capture ids, polled.
 * Everything shown is plain text from ids/statuses; no emails are ever stored here.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatUsd } from '@bloomstake/core'
import { SandboxBanner } from './Landing.tsx'
import { isSupabaseConfigured } from '../lib/config.ts'
import { fetchAuditEvents } from '../lib/audit.ts'

export default function Audit() {
  const query = useQuery({
    queryKey: ['audit'],
    queryFn: () => fetchAuditEvents(),
    enabled: isSupabaseConfigured,
    refetchInterval: 4000,
  })

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Link to="/garden" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Garden
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-emerald-800">Payment activity</h1>
        <p className="mt-2 text-base text-slate-600">
          Verified PayPal events for your pacts. Updates every few seconds.
        </p>

        {!isSupabaseConfigured ? (
          <p
            role="alert"
            className="mt-6 border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-base text-rose-800"
          >
            Supabase is not configured.
          </p>
        ) : query.isPending ? (
          <p role="status" className="mt-6 text-sm text-slate-500">
            Loading the feed…
          </p>
        ) : query.error ? (
          <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {(query.error as Error).message}
          </p>
        ) : query.data.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            No PayPal activity yet. Stake a pact to see it here.
          </p>
        ) : (
          <ul
            className="mt-6 divide-y divide-slate-200 border-y border-slate-200"
            aria-label="PayPal events"
          >
            {query.data.map((e) => (
              <li key={e.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{e.eventType}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {e.source}
                  </span>
                  {e.verified && (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      verified
                    </span>
                  )}
                  {e.status && <span className="text-xs text-slate-500">{e.status}</span>}
                  {e.amountCents !== null && (
                    <span className="ml-auto font-medium">{formatUsd(e.amountCents)}</span>
                  )}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {e.resourceId && <span>id {e.resourceId} · </span>}
                  {e.pactId && (
                    <Link to={`/pact/${e.pactId}`} className="text-emerald-700 hover:underline">
                      pact
                    </Link>
                  )}
                  <span className="ml-2">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
