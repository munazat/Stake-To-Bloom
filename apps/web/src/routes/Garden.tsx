/**
 * Garden.tsx — the plots, kept live.
 *
 * A pact appearing here without a refresh is the point: funding plants the seed,
 * and the page reacts to the database rather than to a navigation. Realtime is an
 * optimisation, so a query refetch on window focus stays as the safety net for a
 * socket that never connects.
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUsd, type PactStatus } from '@bloomstake/core'
import GardenPlot from '../garden/GardenPlot.tsx'
import { fetchPlots, subscribeToPlots } from '../lib/garden.ts'
import { isSupabaseConfigured } from '../lib/config.ts'
import { SandboxBanner, SiteFooter } from './Landing.tsx'

// An unfunded pact and a freshly planted one are both the "seed" stage, so the
// stage alone cannot tell the user whether their stake is locked. ACTIVE is left
// unlabelled because the verified-day count already describes it.
const STATUS_LABELS: Partial<Record<PactStatus, string>> = {
  DRAFT: 'Draft',
  AWAITING_STAKE: 'Awaiting stake',
  SETTLING: 'Settling',
  SETTLED_PASS: 'Passed',
  SETTLED_FAIL: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED_REFUNDED: 'Refunded',
  NEEDS_REVIEW: 'Needs review',
}

export default function Garden() {
  const queryClient = useQueryClient()
  const plots = useQuery({
    queryKey: ['plots'],
    queryFn: fetchPlots,
    enabled: isSupabaseConfigured,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void subscribeToPlots(() => {
      void queryClient.invalidateQueries({ queryKey: ['plots'] })
    }).then((stop) => {
      // The route can unmount while the channel is still connecting; without this
      // the socket would outlive the page and keep refetching a query nobody reads.
      if (disposed) stop()
      else unsubscribe = stop
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [queryClient])

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
      <SandboxBanner />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <Link to="/" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Back
        </Link>

        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-emerald-800">
          Your garden
        </h1>
        <p className="mt-1 text-base text-slate-600">
          Your plants reflect the progress recorded for each pact.
        </p>

        {!isSupabaseConfigured ? (
          <p
            role="alert"
            className="mt-6 border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            Connect Supabase to load your garden.
          </p>
        ) : plots.isPending ? (
          <p role="status" className="mt-8 text-sm text-slate-500">
            Loading your garden…
          </p>
        ) : plots.error ? (
          <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {(plots.error as Error).message}
          </p>
        ) : plots.data.length === 0 ? (
          <div className="mt-8 border-t border-slate-200 py-8">
            <p className="text-base text-slate-600">Your garden is ready for its first pact.</p>
            <Link
              to="/pact/new"
              className="mt-4 inline-block rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Create a Pact
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plots.data.map((plot) => (
              <div key={plot.id}>
                <GardenPlot
                  title={plot.title}
                  stage={plot.stage}
                  vitality={plot.vitality}
                  passedDays={plot.passedDays}
                  days={plot.days}
                  caption={[
                    STATUS_LABELS[plot.status],
                    `${formatUsd(plot.stakeCents)} ${plot.currency}`,
                    `${plot.requiredPasses}/${plot.days} to pass`,
                    plot.demoRole === 'OWNER'
                      ? 'guided demo'
                      : plot.isSimulated
                        ? 'simulated demo player'
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <Link
                  to={`/pact/${plot.id}`}
                  className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline"
                >
                  Open pact →
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
