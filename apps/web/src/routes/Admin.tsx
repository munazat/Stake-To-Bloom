import { useEffect, useState } from 'react'
import { edgeFunctionUrl, supabaseAnonKey } from '../lib/config.ts'
import { SandboxBanner } from './Landing.tsx'

export default function AdminRoute() {
  // Keep this page out of search results; access is still enforced by the server secret.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
  const [secret, setSecret] = useState('')
  const [pactId, setPactId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function call(name: string, body: unknown = {}) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(edgeFunctionUrl(name), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: supabaseAnonKey,
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => null)
      setMessage(
        response.ok
          ? JSON.stringify(result, null, 2)
          : `Request failed (${response.status}): ${JSON.stringify(result)}`,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto max-w-xl px-5 py-10">
        <h1 className="text-2xl font-bold">Operations</h1>
        <p className="mt-2 text-sm text-slate-600">
          Maintenance tools for the project team. Access requires a secret that is entered here at
          runtime and is never stored.
        </p>
        <label className="mt-5 block text-sm font-semibold">
          Admin secret
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2"
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={!secret || busy}
            onClick={() => void call('ops-health')}
            className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Run health check
          </button>
          <button
            disabled={!secret || busy}
            onClick={() => void call('admin-retry', { action: 'payouts' })}
            className="rounded-full border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
          >
            Poll payouts
          </button>
        </div>
        <label className="mt-6 block text-sm font-semibold">
          Retry eligible settlement for pact ID
          <input
            value={pactId}
            onChange={(e) => setPactId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-sm"
          />
        </label>
        <button
          disabled={!secret || !pactId || busy}
          onClick={() => void call('admin-retry', { action: 'settle', pact_id: pactId })}
          className="mt-2 rounded-full border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
        >
          Retry eligible settlement
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Only a stored plan with no submitted payout can be retried safely. Use payout polling and
          manual review after PayPal has accepted a batch.
        </p>
        {message && (
          <pre
            role="status"
            className="mt-5 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-white"
          >
            {message}
          </pre>
        )}
      </main>
    </div>
  )
}
