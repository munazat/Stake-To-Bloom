/**
 * PactDetail.tsx — /pact/:id. Day timeline, proof upload, and what the referee said.
 *
 * Everything the AI or the server wrote (reasons, evidence text, transcripts) is
 * rendered as plain React text. There is no dangerouslySetInnerHTML anywhere in
 * this file, so an image that says "<img onerror=...>" is just a string.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUsd, gardenStage } from '@bloomstake/core'
import GardenPlot from '../garden/GardenPlot.tsx'
import { SandboxBanner } from './Landing.tsx'
import {
  advanceDemo,
  ApiError,
  captureStakeOrder,
  refundPact,
  type ProofResult,
} from '../lib/api.ts'
import { maskEmail } from '../lib/audit.ts'
import StakeButton from './StakeButton.tsx'
import { isSupabaseConfigured } from '../lib/config.ts'
import { subscribeToPlots } from '../lib/garden.ts'
import {
  fetchPactDetail,
  sampleContextFor,
  todayIndex,
  type PactDetail,
} from '../lib/pactDetail.ts'
import { ProofPrepareError, prepareProof, uploadAndSubmit } from '../lib/proof.ts'
import { SAMPLE_LABELS, renderSample, sampleSpec, type SampleKind } from '../lib/samples.ts'

const VERDICT_STYLE: Record<string, string> = {
  PASS: 'bg-emerald-100 text-emerald-800',
  FAIL: 'bg-rose-100 text-rose-800',
  UNCLEAR: 'bg-amber-100 text-amber-900',
  REJECTED: 'bg-slate-800 text-white',
}

const DAY_STYLE: Record<string, string> = {
  PASSED: 'border-emerald-500 bg-emerald-50 text-emerald-800',
  MISSED: 'border-rose-400 bg-rose-50 text-rose-700',
  UNCLEAR: 'border-amber-400 bg-amber-50 text-amber-800',
  PENDING: 'border-slate-200 bg-white text-slate-500',
}

function errorText(err: unknown): string {
  if (err instanceof ProofPrepareError) return err.message
  if (err instanceof ApiError) return err.body?.message ?? err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${VERDICT_STYLE[verdict] ?? 'bg-slate-100'}`}
    >
      {verdict}
    </span>
  )
}

function ResultCard({ result }: { result: ProofResult }) {
  return (
    <section
      aria-label="Latest result"
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={result.verdict} />
        {result.outcome === 'queued' && (
          <span className="text-xs text-slate-500">Saved — will be checked later</span>
        )}
        {result.cached && (
          <span className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
            cached from an earlier live run
          </span>
        )}
        {result.injectionFlag && (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
            🛡 Injection blocked — the AI has no money access
          </span>
        )}
        {result.attemptNo !== null && (
          <span className="ml-auto text-xs text-slate-500">
            Attempt {result.attemptNo} of 3 · {result.attemptsLeft} left
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        {result.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>

      {result.evidence.some((e) => e.found) && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            What the AI saw
          </h3>
          <ul className="mt-1 space-y-1 text-sm">
            {result.evidence.map((e) => (
              <li key={e.id} className="text-slate-600">
                <span className="font-medium">{e.description}:</span>{' '}
                {e.found ? `${String(e.value ?? '—')} (“${e.evidenceText}”)` : 'not visible'}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            This is what the AI read from your image. The pass or fail decision above comes from
            your fixed rules.
          </p>
        </div>
      )}
    </section>
  )
}

function Timeline({ detail, today }: { detail: PactDetail; today: number | null }) {
  return (
    <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Day timeline">
      {Array.from({ length: detail.days }, (_, i) => {
        const day = detail.dayRows.find((d) => d.dayIndex === i)
        const status = day?.status ?? 'PENDING'
        return (
          <li
            key={i}
            aria-current={today === i ? 'date' : undefined}
            className={`rounded-lg border px-1 py-2 text-center text-xs ${DAY_STYLE[status]} ${today === i ? 'ring-2 ring-emerald-500' : ''}`}
          >
            <div className="font-semibold">Day {i + 1}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide">
              {day?.demoSimulated
                ? 'Simulated'
                : status === 'PENDING' && today === i
                  ? 'Today'
                  : status}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function PactDetailRoute() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ProofResult | null>(null)

  const detailQuery = useQuery({
    queryKey: ['pact', id],
    queryFn: () => fetchPactDetail(id),
    enabled: isSupabaseConfigured && id !== '',
    refetchOnWindowFocus: true,
  })

  // Realtime is only a refetch signal; the numbers always come from the server.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let disposed = false
    let stop: (() => void) | undefined
    void subscribeToPlots(() => {
      void queryClient.invalidateQueries({ queryKey: ['pact', id] })
    }).then((unsubscribe) => {
      if (disposed) unsubscribe()
      else stop = unsubscribe
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [id, queryClient])

  const detail = detailQuery.data ?? null

  // Reconcile on load: if a stake was captured at PayPal but our confirmation was
  // lost (closed tab, crash), a read-only "check" heals the pact. It never charges.
  const awaitingOrder = detail?.status === 'AWAITING_STAKE' ? detail.paypalOrderId : null
  useEffect(() => {
    if (!awaitingOrder) return
    let cancelled = false
    captureStakeOrder(awaitingOrder, 'check')
      .then((out) => {
        if (!cancelled && out.funded) void queryClient.invalidateQueries({ queryKey: ['pact', id] })
      })
      .catch(() => {
        /* best effort: the Stake button and the webhook are the other paths */
      })
    return () => {
      cancelled = true
    }
  }, [awaitingOrder, id, queryClient])

  const today = detail ? todayIndex(detail) : null

  const submit = useMutation({
    mutationFn: async (source: Blob) => {
      if (!detail) throw new Error('Pact not loaded.')
      const prepared = await prepareProof(source)
      return uploadAndSubmit(detail.id, today ?? 0, prepared)
    },
    onSuccess: (r) => {
      setResult(r)
      void queryClient.invalidateQueries({ queryKey: ['pact', id] })
      void queryClient.invalidateQueries({ queryKey: ['plots'] })
    },
  })

  const refund = useMutation({
    mutationFn: () => refundPact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pact', id] })
      void queryClient.invalidateQueries({ queryKey: ['plots'] })
    },
  })

  const fastForward = useMutation({
    mutationFn: () =>
      detail?.poolId
        ? advanceDemo(detail.poolId)
        : Promise.reject(new Error('Demo pool is missing.')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pact', id] })
      void queryClient.invalidateQueries({ queryKey: ['plots'] })
    },
  })

  async function submitSample(kind: SampleKind) {
    if (!detail || today === null) return
    const blob = await renderSample(sampleSpec(kind, sampleContextFor(detail, today)))
    submit.mutate(blob)
  }

  const passedDays = detail?.dayRows.filter((d) => d.status === 'PASSED').length ?? 0
  const resolved = detail?.dayRows.filter((d) => d.status !== 'PENDING') ?? []
  const latest = resolved.reduce<{ dayIndex: number; status: string } | null>(
    (best, d) => (best === null || d.dayIndex > best.dayIndex ? d : best),
    null,
  )
  const stage = detail
    ? gardenStage({
        vitality: detail.vitality,
        status: detail.status,
        hasProof: resolved.length > 0,
        wilting: latest?.status === 'MISSED',
      })
    : 'seed'

  const isActive = detail?.status === 'ACTIVE'
  const todayRow = detail?.dayRows.find((d) => d.dayIndex === today)
  const todayAttempts = detail?.proofs.filter((p) => p.dayIndex === today).length ?? 0
  const canUpload = isActive && today !== null && todayRow?.status !== 'PASSED' && todayAttempts < 3
  const sandbox = (import.meta.env.VITE_APP_ENV ?? 'sandbox') === 'sandbox'

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link to="/garden" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Garden
        </Link>

        {!isSupabaseConfigured ? (
          <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Supabase is not configured.
          </p>
        ) : detailQuery.isPending ? (
          <p role="status" className="mt-8 text-sm text-slate-500">
            Loading your pact…
          </p>
        ) : detailQuery.error ? (
          <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {(detailQuery.error as Error).message}
          </p>
        ) : !detail ? (
          <p role="alert" className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No such pact on this account. If you cleared site data, the guest session (and its
            garden) is gone.
          </p>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-extrabold text-emerald-800">{detail.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {formatUsd(detail.stakeCents)} {detail.currency} · {detail.requiredPasses} of{' '}
              {detail.days} days to pass · {detail.status.replace(/_/g, ' ').toLowerCase()}
              {detail.isDemo ? ' · demo player' : ''}
              {detail.isSimulated ? ' · simulated stake (no money moved)' : ''}
            </p>

            <div className="mt-4 max-w-xs">
              <GardenPlot
                title={detail.title}
                stage={stage}
                vitality={detail.vitality}
                passedDays={passedDays}
                days={detail.days}
              />
            </div>

            <Timeline detail={detail} today={today} />

            {detail.isDemo && detail.demoRole === 'OWNER' && detail.poolId && (
              <section
                className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-4"
                aria-label="Guided demo controls"
              >
                <p className="text-sm font-semibold text-violet-950">
                  Guided demo · simulated stakes only
                </p>
                <p className="mt-1 text-sm text-violet-900">
                  Submit one real proof before the first fast-forward. Then Mia’s remaining days are
                  simulated as passed; Omar’s and Zed’s are simulated as missed. No AI or money call
                  is made for simulated days.
                </p>
                <button
                  type="button"
                  disabled={fastForward.isPending}
                  onClick={() => fastForward.mutate()}
                  className="mt-3 rounded-full border border-violet-700 px-4 py-2 text-sm font-semibold text-violet-900 disabled:opacity-50"
                >
                  {fastForward.isPending ? 'Advancing demo…' : 'Fast-forward one day'}
                </button>
                {fastForward.error && (
                  <p role="alert" className="mt-2 text-sm text-rose-800">
                    {(fastForward.error as Error).message}
                  </p>
                )}
              </section>
            )}

            {detail.status === 'AWAITING_STAKE' && (
              <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p>
                  This pact is waiting for its stake. Proofs open once the sandbox payment is
                  confirmed.
                </p>
                <StakeButton
                  pactId={detail.id}
                  stakeCents={detail.stakeCents}
                  onFunded={() => {
                    void queryClient.invalidateQueries({ queryKey: ['pact', id] })
                    void queryClient.invalidateQueries({ queryKey: ['plots'] })
                  }}
                />
              </section>
            )}

            {detail.status === 'ACTIVE' &&
              detail.startsAt &&
              new Date(detail.startsAt) > new Date() &&
              detail.proofs.length === 0 && (
                <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-amber-900">
                    You can cancel before your first pact day begins and receive a full stake
                    refund.
                  </p>
                  <button
                    type="button"
                    disabled={refund.isPending}
                    onClick={() => refund.mutate()}
                    className="mt-3 rounded-full border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                  >
                    {refund.isPending ? 'Requesting refund…' : 'Cancel pact and refund stake'}
                  </button>
                  {refund.error && (
                    <p role="alert" className="mt-2 text-sm text-rose-800">
                      {(refund.error as Error).message}
                    </p>
                  )}
                </section>
              )}

            {isActive && (
              <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-bold text-slate-800">
                  {today === null ? 'Outside the proof window' : `Today’s proof · Day ${today + 1}`}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {detail.spec.title}. Upload a screenshot or photo.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Attempts today: {todayAttempts} of 3.
                  {todayRow?.status === 'PASSED' ? ' Today is already verified.' : ''}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    disabled={!canUpload || submit.isPending}
                    aria-label="Upload proof image"
                    className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:font-semibold file:text-white disabled:opacity-50"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) submit.mutate(file)
                      e.target.value = ''
                    }}
                  />
                  {submit.isPending && (
                    <span role="status" className="text-sm text-slate-500">
                      Checking your proof…
                    </span>
                  )}
                </div>

                {submit.error && (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"
                  >
                    {errorText(submit.error)}
                  </p>
                )}

                <p className="mt-3 text-xs text-slate-400">
                  Demo uses sandbox money. Do not upload personal photos. Images are processed by
                  Google’s Gemini API under its free-tier terms, which may allow review and product
                  improvement.
                </p>

                {sandbox && canUpload && (
                  <details className="mt-4 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                      Try a generated sample proof
                    </summary>
                    <p className="mt-1 text-xs text-slate-500">
                      Drawn in your browser with today’s date and code — no files, no personal data.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {(Object.keys(SAMPLE_LABELS) as SampleKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          disabled={submit.isPending}
                          onClick={() => void submitSample(kind)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs hover:border-emerald-500 disabled:opacity-50"
                        >
                          <span className="block font-semibold text-slate-800">
                            {SAMPLE_LABELS[kind].title}
                          </span>
                          <span className="text-slate-500">{SAMPLE_LABELS[kind].expectation}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}

            {result && <ResultCard result={result} />}

            <section className="mt-8" aria-label="Proof history">
              <h2 className="text-lg font-bold text-slate-800">Proof history</h2>
              {detail.proofs.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No proofs yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {detail.proofs.map((p) => (
                    <li key={p.id} className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Day {p.dayIndex + 1}</span>
                        <span className="text-xs text-slate-400">attempt {p.attemptNo}</span>
                        <VerdictBadge verdict={p.verdict} />
                        {p.queued && <span className="text-xs text-slate-500">queued</span>}
                        {p.cached && (
                          <span className="text-xs text-sky-700">
                            cached from an earlier live run
                          </span>
                        )}
                        {p.injectionFlag && (
                          <span className="text-xs font-semibold">🛡 injection blocked</span>
                        )}
                      </div>
                      {p.reasons[0] && <p className="mt-1 text-slate-600">{p.reasons[0]}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {detail.payerEmail && (
              <p className="mt-6 text-xs text-slate-500">
                Staked by PayPal account {maskEmail(detail.payerEmail)} ·{' '}
                <Link to="/audit" className="text-emerald-700 hover:underline">
                  PayPal audit feed
                </Link>
              </p>
            )}

            {detail.settlement && (
              <section
                className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                aria-label="Settlement receipt"
              >
                <h2 className="text-lg font-bold text-emerald-900">Why this payout?</h2>
                <p className="mt-1 text-sm text-emerald-800">
                  Settlement {detail.settlement.status.toLowerCase().replace(/_/g, ' ')}
                </p>
                {Array.isArray(detail.settlement.plan.trace) && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                    {detail.settlement.plan.trace.map(
                      (line, i) => typeof line === 'string' && <li key={i}>{line}</li>,
                    )}
                  </ol>
                )}
                {typeof detail.settlement.senderBatchId === 'string' && (
                  <p className="mt-3 break-all text-xs">
                    Sender batch: <code>{detail.settlement.senderBatchId}</code>
                  </p>
                )}
                {typeof detail.settlement.payoutBatchId === 'string' && (
                  <p className="break-all text-xs">
                    PayPal batch: <code>{detail.settlement.payoutBatchId}</code>
                  </p>
                )}
                <p className="mt-2 break-all text-xs">
                  Frozen rule hash: <code>{detail.ruleHash}</code>
                </p>
              </section>
            )}

            <p className="mt-8 break-all text-xs text-slate-400">
              Rule contract hash (frozen at funding): <code>{detail.ruleHash}</code>
            </p>
          </>
        )}
      </main>
    </div>
  )
}
