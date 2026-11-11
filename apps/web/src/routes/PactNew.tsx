/**
 * PactNew.tsx — the three-step wizard that produces a frozen Rule Contract.
 *
 * Step 3 renders the *exact* JSON the server will hash, and hashes it here with
 * the same core code the Edge Function uses. The preview is then compared against
 * the hash the server returns: if the two ever disagree, the contract the user
 * read is not the contract that was stored, and we say so on screen instead of
 * discovering it at payout time.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  GOAL_TEMPLATES,
  NUMERIC_BOUNDS,
  PACT_DAYS,
  RuleSpecSchema,
  STAKE_CENTS_MAX,
  STAKE_CENTS_MIN,
  canonicalJson,
  formatUsd,
  ruleHash,
  type RuleSpec,
} from '@bloomstake/core'
import {
  browserTimeZone,
  confirmPact,
  createPact,
  draftRule,
  type ApiError,
  type TemplateGoal,
} from '../lib/api.ts'
import { isSupabaseConfigured } from '../lib/config.ts'
import { SandboxBanner } from './Landing.tsx'

type GoalChoice = TemplateGoal | 'custom'

const STEP_LABELS = ['Goal', 'Terms', 'Rule Contract'] as const

const GOAL_TILES: ReadonlyArray<{
  key: TemplateGoal
  emoji: string
  label: string
  blurb: string
}> = [
  {
    key: 'steps',
    emoji: '👟',
    label: 'Steps',
    blurb: 'A daily step count at or above your target.',
  },
  {
    key: 'water',
    emoji: '💧',
    label: 'Water',
    blurb: 'A daily volume of water at or above your target.',
  },
  {
    key: 'meal',
    emoji: '🥗',
    label: 'Healthy meal',
    blurb: 'A photo of a balanced meal, with the daily code in frame.',
  },
  {
    key: 'workout',
    emoji: '🏋️',
    label: 'Workout',
    blurb: 'A photo of an active session at or above your target minutes.',
  },
]

/** Read the default out of the template itself so there is no second table. */
function defaultThreshold(goal: TemplateGoal): number {
  const check = GOAL_TEMPLATES[goal]().checks[0]
  return check.kind === 'numeric' && typeof check.threshold === 'number' ? check.threshold : 0
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-slate-700">{label}</span>
      {hint ? <span className="mb-1 block text-xs text-slate-500">{hint}</span> : null}
      {children}
    </label>
  )
}

/**
 * A labelled set of controls. `<label>` may only wrap a single form control —
 * using Field for a button group makes every button inherit the whole label text
 * as its accessible name, so related buttons get a group instead.
 */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="block text-sm font-semibold text-slate-700">
        {label}
      </span>
      {hint ? <span className="mb-1 block text-xs text-slate-500">{hint}</span> : null}
      {children}
    </div>
  )
}

export default function PactNew() {
  const [step, setStep] = useState(0)
  const [goalType, setGoalType] = useState<GoalChoice>('steps')
  const [description, setDescription] = useState('')
  const [threshold, setThreshold] = useState(() => defaultThreshold('steps'))
  const [requiredPasses, setRequiredPasses] = useState(5)
  const [stakeCents, setStakeCents] = useState(2000)
  const [title, setTitle] = useState('')
  const [previewHash, setPreviewHash] = useState<string | null>(null)

  const tz = useMemo(() => browserTimeZone(), [])
  const isCustom = goalType === 'custom'
  const bounds = goalType === 'custom' ? undefined : NUMERIC_BOUNDS[goalType]

  const parsed = useMemo(() => {
    if (goalType === 'custom') return null
    const template = GOAL_TEMPLATES[goalType]({ threshold, requiredPasses })
    const trimmed = title.trim()
    const withTitle = trimmed ? { ...template, title: trimmed } : template
    return RuleSpecSchema.safeParse(withTitle)
  }, [goalType, threshold, requiredPasses, title])

  // A custom goal's rule comes from the server (AI-proposed, then validated and
  // hashed there). It is re-validated here only to render it safely.
  const draftMutation = useMutation({
    mutationFn: () =>
      draftRule({ description: description.trim(), stakeCents, requiredPasses, tz }),
  })
  const draft = draftMutation.data
  const customSpec = useMemo<RuleSpec | null>(() => {
    if (!draft) return null
    const result = RuleSpecSchema.safeParse(draft.ruleSpec)
    return result.success ? result.data : null
  }, [draft])

  const spec: RuleSpec | null = isCustom ? customSpec : parsed?.success ? parsed.data : null
  const specError = isCustom
    ? draft && !customSpec
      ? 'The drafted rule did not validate. Do not lock it.'
      : null
    : parsed && !parsed.success
      ? (parsed.error.issues[0]?.message ?? 'This rule is not valid yet.')
      : null

  useEffect(() => {
    if (!spec) {
      setPreviewHash(null)
      return
    }
    let cancelled = false
    void ruleHash(spec).then((hash) => {
      if (!cancelled) setPreviewHash(hash)
    })
    return () => {
      cancelled = true
    }
  }, [spec])

  const mutation = useMutation({
    mutationFn: () => {
      if (goalType === 'custom')
        throw new Error('Custom goals are drafted and confirmed, not created directly.')
      return createPact({
        goalType,
        threshold: bounds ? threshold : undefined,
        requiredPasses,
        stakeCents,
        tz,
        title: title.trim() || undefined,
      })
    },
  })

  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('Draft a contract first.')
      return confirmPact(draft.id)
    },
  })

  function pickGoal(goal: GoalChoice) {
    setGoalType(goal)
    if (goal !== 'custom') setThreshold(defaultThreshold(goal))
    setTitle('')
    draftMutation.reset()
  }

  const pact = mutation.data ?? confirmMutation.data
  const hashMismatch = Boolean(pact && previewHash && pact.ruleHash !== previewHash)

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link to="/" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Back
        </Link>

        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-emerald-800">
          Create a pact
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Seven days, {formatUsd(stakeCents)} on the line. The rule you finish with is the rule you
          are shown — it is hashed and frozen the moment you lock it.
        </p>

        <ol className="mt-6 flex gap-2" aria-label="Progress">
          {STEP_LABELS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold ${
                index === step
                  ? 'bg-emerald-600 text-white'
                  : index < step
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {!isSupabaseConfigured ? (
          <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set{' '}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the
            dev server.
          </p>
        ) : null}

        {pact ? (
          <section className="mt-6 rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-emerald-800">Contract locked</h2>
            <p className="mt-1 text-sm text-slate-600">
              Stored with status <strong>{pact.status}</strong>. Nothing has been charged yet — the
              stake is captured when you fund it.
            </p>

            {hashMismatch ? (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                The stored hash does not match the one previewed here. Do not fund this pact.
              </p>
            ) : (
              <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                The server stored the same hash this page previewed, so the contract you read is the
                contract that will be applied.
              </p>
            )}

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-slate-600">Pact</dt>
                <dd className="font-mono text-xs text-slate-500">{pact.id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-slate-600">Goal</dt>
                <dd>{pact.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-slate-600">Stake</dt>
                <dd>
                  {formatUsd(pact.stakeCents)} {pact.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-slate-600">Pass condition</dt>
                <dd>
                  {pact.requiredPasses} of {pact.days} days
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-slate-600">Timezone</dt>
                <dd>{pact.tz}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <span className="block text-sm font-semibold text-slate-600">rule_hash</span>
              <code className="mt-1 block break-all rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                {pact.ruleHash}
              </code>
            </div>

            <Link
              to="/garden"
              className="mt-6 inline-block rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              See it in your garden
            </Link>
          </section>
        ) : step === 0 ? (
          <section className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {GOAL_TILES.map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => pickGoal(tile.key)}
                  aria-pressed={goalType === tile.key}
                  className={`rounded-xl border p-4 text-left transition ${
                    goalType === tile.key
                      ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200'
                      : 'border-slate-200 bg-white hover:border-emerald-300'
                  }`}
                >
                  <span aria-hidden className="text-2xl">
                    {tile.emoji}
                  </span>
                  <span className="mt-2 block font-semibold text-slate-800">{tile.label}</span>
                  <span className="mt-1 block text-xs text-slate-500">{tile.blurb}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => pickGoal('custom')}
              aria-pressed={isCustom}
              className={`mt-3 w-full rounded-xl border p-4 text-left transition ${
                isCustom
                  ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200'
                  : 'border-dashed border-slate-300 bg-slate-50 hover:border-emerald-300'
              }`}
            >
              <span className="block font-semibold text-slate-800">✨ Custom goal</span>
              <span className="mt-1 block text-xs text-slate-500">
                Describe any habit in your own words. The AI proposes the checks; you read the
                contract and confirm it.
              </span>
            </button>

            {isCustom ? (
              <Field
                label="Describe your habit"
                hint="Something one photo or screenshot a day can prove, e.g. Read 20 pages and show the book."
              >
                <textarea
                  value={description}
                  maxLength={300}
                  rows={3}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    draftMutation.reset()
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </Field>
            ) : null}

            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isCustom && description.trim().length < 10}
              className="mt-6 rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Next
            </button>
          </section>
        ) : step === 1 ? (
          <section className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            {bounds ? (
              <Field
                label="Daily target"
                hint={`Allowed range for ${goalType}: ${bounds[0].toLocaleString('en-US')}–${bounds[1].toLocaleString('en-US')}`}
              >
                <input
                  type="number"
                  value={threshold}
                  min={bounds[0]}
                  max={bounds[1]}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </Field>
            ) : null}

            <Group
              label="Days you must pass"
              hint={`Out of ${PACT_DAYS}. A harder target pays the same stake back.`}
            >
              <div className="mt-1 flex gap-2">
                {[4, 5, 6, 7].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRequiredPasses(value)}
                    aria-pressed={requiredPasses === value}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                      requiredPasses === value
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {value}/{PACT_DAYS}
                  </button>
                ))}
              </div>
            </Group>

            <Field
              label="Stake"
              hint="Locked for the whole pact. Pass and you get it back plus a share of the forfeits."
            >
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="range"
                  value={stakeCents}
                  min={STAKE_CENTS_MIN}
                  max={STAKE_CENTS_MAX}
                  step={100}
                  onChange={(event) => setStakeCents(Number(event.target.value))}
                  className="flex-1 accent-emerald-600"
                  aria-label="Stake"
                />
                <span className="w-16 text-right text-lg font-bold text-emerald-800">
                  {formatUsd(stakeCents)}
                </span>
              </div>
            </Field>

            {goalType !== 'custom' ? (
              <Field label="Title" hint="Optional — leave blank to use the generated one.">
                <input
                  type="text"
                  value={title}
                  maxLength={80}
                  placeholder={GOAL_TEMPLATES[goalType]({ threshold }).title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </Field>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="rounded-full border border-slate-300 px-5 py-2 font-medium text-slate-600 hover:border-slate-400"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!isCustom && !spec}
                className="rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Review contract
              </button>
            </div>

            {specError ? (
              <p role="alert" className="text-sm text-rose-700">
                {specError}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800">Rule Contract</h2>
            <p className="mt-1 text-sm text-slate-600">
              This is the whole deal, in the exact form that gets hashed. After you lock it, the
              database rejects any edit to the rule, the hash or the stake.
            </p>

            {spec ? (
              <>
                <h3 className="mt-4 text-lg font-bold text-emerald-800">{spec.title}</h3>

                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-slate-600">Stake</dt>
                    <dd>{formatUsd(stakeCents)} USD</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-600">Window</dt>
                    <dd>
                      {PACT_DAYS} days in {tz}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-600">Pass</dt>
                    <dd>
                      {spec.requiredPasses} of {PACT_DAYS} verified days
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-600">Proof</dt>
                    <dd className="capitalize">{spec.proofKinds.join(' or ')}</dd>
                  </div>
                </dl>

                <ul className="mt-4 space-y-1 text-sm text-slate-600">
                  {spec.checks.map((check) => (
                    <li key={check.id}>
                      <span className="font-semibold text-slate-800">{check.description}</span>
                      {check.kind === 'numeric' ? (
                        <span>
                          {' '}
                          ({check.comparator} {check.threshold?.toLocaleString('en-US')}{' '}
                          {check.unit})
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-400">
                        {' '}
                        · AI confidence ≥ {check.minConfidence}
                      </span>
                    </li>
                  ))}
                  {spec.requiresVisibleDate ? (
                    <li>The proof must show a date matching that day.</li>
                  ) : null}
                  {spec.requiresDailyCode ? (
                    <li>
                      You must write the day's code in frame, so an old photo cannot be reused.
                    </li>
                  ) : null}
                </ul>

                <div className="mt-4">
                  <span className="block text-sm font-semibold text-slate-600">
                    sha256(canonicalJson(ruleSpec)) — preview
                  </span>
                  <code className="mt-1 block break-all rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                    {previewHash ?? 'hashing…'}
                  </code>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    Show the exact JSON that gets hashed
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-700">
                    {canonicalJson(spec)}
                  </pre>
                </details>
              </>
            ) : (
              <>
                {isCustom && !draft ? (
                  <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    The AI will propose a rule for: <em>{description.trim()}</em>. Nothing is stored
                    as a commitment until you read the contract and lock it.
                  </p>
                ) : null}
                {specError ? (
                  <p role="alert" className="mt-4 text-sm text-rose-700">
                    {specError}
                  </p>
                ) : null}
              </>
            )}

            {isCustom && draft ? (
              <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">
                Drafted by AI. Read every line: the AI proposes, you decide, and the server froze
                this exact text and hash.
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full border border-slate-300 px-5 py-2 font-medium text-slate-600 hover:border-slate-400"
              >
                Back
              </button>
              {isCustom && !draft ? (
                <button
                  type="button"
                  onClick={() => draftMutation.mutate()}
                  disabled={draftMutation.isPending || !isSupabaseConfigured}
                  className="rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {draftMutation.isPending ? 'Drafting…' : 'Draft contract with AI'}
                </button>
              ) : (
                <>
                  {isCustom ? (
                    <button
                      type="button"
                      onClick={() => draftMutation.mutate()}
                      disabled={draftMutation.isPending || confirmMutation.isPending}
                      className="rounded-full border border-slate-300 px-5 py-2 font-medium text-slate-600 hover:border-slate-400"
                    >
                      Draft again
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => (isCustom ? confirmMutation.mutate() : mutation.mutate())}
                    disabled={
                      !spec ||
                      mutation.isPending ||
                      confirmMutation.isPending ||
                      !isSupabaseConfigured
                    }
                    className="rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {mutation.isPending || confirmMutation.isPending
                      ? 'Locking…'
                      : 'Lock this contract'}
                  </button>
                </>
              )}
            </div>

            {[mutation.error, draftMutation.error, confirmMutation.error]
              .filter((error): error is Error => error instanceof Error)
              .map((error, index) => (
                <p
                  key={index}
                  role="alert"
                  className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                  {(error as ApiError).body?.code
                    ? `${(error as ApiError).body?.code}: ${(error as ApiError).message}`
                    : error.message}
                </p>
              ))}
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
        The AI only perceives. A deterministic rule engine decides every cent.
      </footer>
    </div>
  )
}
