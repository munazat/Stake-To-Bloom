import { Link } from 'react-router-dom'
import { SandboxBanner } from './Landing.tsx'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 to-white text-slate-800">
      <SandboxBanner />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span aria-hidden className="text-5xl">
          🥀
        </span>
        <h1 className="text-3xl font-extrabold text-emerald-800">Page not found</h1>
        <p className="text-slate-600">That page does not exist, or it has moved.</p>
        <Link
          to="/"
          className="rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700"
        >
          Back to BloomStake
        </Link>
      </main>
    </div>
  )
}
