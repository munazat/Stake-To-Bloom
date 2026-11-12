import { Link } from 'react-router-dom'
import { SandboxBanner, SiteFooter } from './Landing.tsx'
import PageHeading from '../components/PageHeading.tsx'

export default function AboutRoute() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Link to="/" className="text-sm font-semibold text-emerald-800 hover:underline">
          BloomStake
        </Link>
        <PageHeading icon="🌼" tone="sun" title="A promise you can see." className="mt-5">
          <p>
            BloomStake turns a seven-day wellness goal into a pact: set a rule, share daily proof,
            and watch your garden reflect your progress.
          </p>
        </PageHeading>

        <div className="about-sections mt-10 divide-y divide-slate-200 border-y border-slate-200">
          <section className="py-6">
            <h2 className="text-xl font-bold">How progress is judged</h2>
            <p className="mt-2 text-base text-slate-600">
              Gemini reads evidence from your image. Fixed rules check it against your pact; AI does
              not decide pass or fail and cannot move money.
            </p>
          </section>
          <section className="py-6">
            <h2 className="text-xl font-bold">Payments</h2>
            <p className="mt-2 text-base text-slate-600">
              PayPal runs in Sandbox. Test stakes and payouts do not move real money.
            </p>
          </section>
          <section className="py-6">
            <h2 className="text-xl font-bold">Your proof</h2>
            <p className="mt-2 text-base text-slate-600">
              Images are sent to the configured referee service for evaluation. Avoid uploading
              sensitive images or personal documents.
            </p>
          </section>
        </div>
        <p className="mt-8 text-sm text-slate-500">
          Built with React, Supabase, Gemini, and PayPal Sandbox.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
