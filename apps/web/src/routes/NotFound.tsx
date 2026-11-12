import { Link } from 'react-router-dom'
import { SandboxBanner } from './Landing.tsx'
import PageHeading from '../components/PageHeading.tsx'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <PageHeading icon="🧭" tone="sky" title="Page not found">
          <p>That page does not exist, or it has moved.</p>
        </PageHeading>
        <Link
          to="/"
          className="bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800"
        >
          Back to BloomStake
        </Link>
      </main>
    </div>
  )
}
