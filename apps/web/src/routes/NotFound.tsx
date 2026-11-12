import { Link } from 'react-router-dom'
import { SandboxBanner } from './Landing.tsx'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
      <SandboxBanner />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-700">404</p>
        <h1 className="text-3xl font-extrabold text-emerald-800">Page not found</h1>
        <p className="text-slate-600">That page does not exist, or it has moved.</p>
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
