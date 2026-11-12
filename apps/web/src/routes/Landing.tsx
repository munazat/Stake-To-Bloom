import { Link, NavLink } from 'react-router-dom'
import PlantSVG from '../garden/PlantSVG.tsx'

/** The practice-mode notice, shown on every screen. */
export function SandboxBanner() {
  return (
    <>
      <div
        role="status"
        className="w-full bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-amber-900"
      >
        Sandbox Mode — No Real Money
      </div>
      <SiteHeader />
    </>
  )
}

function SiteHeader() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:text-emerald-800'
    }`
  return (
    <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-xl font-bold text-emerald-800"
        >
          <span aria-hidden>🌱</span> BloomStake
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <NavLink to="/demo" className={link}>
            Demo
          </NavLink>
          <NavLink to="/garden" className={link}>
            Garden
          </NavLink>
          <NavLink to="/about" className={link}>
            About
          </NavLink>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200/70 px-6 py-6 text-center text-xs text-slate-500">
      <p>
        BloomStake runs on the PayPal Sandbox with test money only. Built for the PayPal AI
        Hackathon ·{' '}
        <Link to="/about" className="underline hover:text-emerald-800">
          How it works
        </Link>{' '}
        · MIT License
      </p>
    </footer>
  )
}

const STEPS = [
  {
    icon: '🎯',
    title: 'Pick a goal',
    text: 'Steps, water, a healthy meal or a workout. Seven days, one clear rule you read before you commit.',
  },
  {
    icon: '💸',
    title: 'Put a stake on it',
    text: 'Stake $20 through PayPal. It is your commitment, held while your plant grows.',
  },
  {
    icon: '📸',
    title: 'Show your proof',
    text: 'Upload a screenshot or photo each day. AI reads it, and fixed rules decide if the day counts.',
  },
  {
    icon: '🌸',
    title: 'Watch it bloom',
    text: 'Hit your days and the garden blooms and your stake comes back. Miss them and the plant wilts.',
  },
]

const STAGES: {
  stage: 'seed' | 'sprout' | 'growing' | 'bloom'
  vitality: number
  label: string
}[] = [
  { stage: 'seed', vitality: 0.1, label: 'Day 1' },
  { stage: 'sprout', vitality: 0.3, label: 'Day 3' },
  { stage: 'growing', vitality: 0.6, label: 'Day 5' },
  { stage: 'bloom', vitality: 0.95, label: 'Day 7' },
]

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col text-slate-800">
      <SandboxBanner />

      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl items-center gap-10 px-5 pb-10 pt-12 md:grid-cols-2 md:pt-16">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-emerald-700">
              Habits with something at stake
            </p>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight text-emerald-900 sm:text-5xl">
              Stake it. Prove it. Grow it.
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Commit to a seven-day wellness goal with a small PayPal stake. Show proof each day and
              watch your garden bloom. Our AI reads your proof and fixed rules decide the result, so
              it is fair every time.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/pact/new"
                className="rounded-full bg-emerald-600 px-6 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-700"
              >
                Start a pact
              </Link>
              <Link
                to="/demo"
                className="rounded-full border-2 border-emerald-600 px-6 py-3 font-bold text-emerald-800 transition hover:bg-emerald-50"
              >
                Try the 90-second demo
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              No sign-up. Everything uses PayPal test money, so nothing real is ever charged.
            </p>
          </div>

          <div
            className="meadow rounded-3xl border border-slate-200 p-5 shadow-sm"
            aria-label="A plant growing over seven days"
          >
            <div className="grid grid-cols-4 gap-1">
              {STAGES.map((s) => (
                <figure key={s.stage} className="m-0 text-center">
                  <div className="aspect-[3/4]">
                    <PlantSVG
                      stage={s.stage}
                      vitality={s.vitality}
                      title={`${s.label}: ${s.stage}`}
                    />
                  </div>
                  <figcaption className="text-xs font-bold text-emerald-900">{s.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-10">
          <h2 className="text-2xl font-bold text-emerald-900">How it works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <span aria-hidden className="text-3xl">
                  {step.icon}
                </span>
                <h3 className="mt-3 text-lg font-bold text-slate-800">
                  {index + 1}. {step.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-5xl px-5 pb-14 pt-4">
          <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-3">
            <div>
              <h3 className="font-bold text-slate-800">The AI can't be talked into it</h3>
              <p className="mt-1 text-sm text-slate-600">
                It only reads what is in your picture. Fixed rules make the call, so a clever note
                in the photo changes nothing.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Every payment is traceable</h3>
              <p className="mt-1 text-sm text-slate-600">
                Open the live audit feed to see real PayPal order and capture IDs as they happen.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Fair by design</h3>
              <p className="mt-1 text-sm text-slate-600">
                Your rule is sealed when you stake, and every payout comes with a plain-language
                receipt showing the maths.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
