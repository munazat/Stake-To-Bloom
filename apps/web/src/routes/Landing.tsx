import { Link, NavLink } from 'react-router-dom'
import PlantSVG from '../garden/PlantSVG.tsx'

export function SandboxBanner() {
  return <SiteHeader />
}

function SiteHeader() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `site-nav-link whitespace-nowrap px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:text-emerald-800'
    }`

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="site-header-inner mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <Link to="/" className="site-brand flex items-center font-bold text-emerald-800">
          BloomStake
        </Link>
        <nav aria-label="Main" className="site-nav flex items-center gap-1">
          <span
            role="status"
            title="Payments run in PayPal's test environment. No real money moves."
            className="sandbox-indicator mr-2 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900"
          >
            PayPal sandbox
          </span>
          <NavLink to="/demo" className={link}>
            Demo
          </NavLink>
          <NavLink to="/garden" className={link}>
            Garden
          </NavLink>
          <NavLink to="/about" className={link}>
            About
          </NavLink>
          <NavLink to="/audit" className={link}>
            Audit
          </NavLink>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 px-6 py-5 text-center text-sm text-slate-500">
      BloomStake <span aria-hidden>·</span> Wellness, with a little more follow-through.
    </footer>
  )
}

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

const STEPS = [
  ['01', 'Choose a goal', 'Pick a daily habit and set your target.'],
  ['02', 'Put a stake on it', 'Commit through PayPal Sandbox.'],
  ['03', 'Show your progress', 'Share daily proof; AI reads it, fixed rules decide.'],
  ['04', 'Watch it grow', 'Track your pact as your garden responds.'],
]

export default function Landing() {
  return (
    <div className="home-shell flex min-h-screen flex-col text-slate-800">
      <SandboxBanner />
      <main className="flex-1">
        <section className="home-hero mx-auto grid items-center gap-10 px-5 md:grid-cols-2">
          <div className="home-copy">
            <p className="home-eyebrow font-bold uppercase tracking-widest">
              A little skin in the game
            </p>
            <h1 className="home-title font-extrabold text-emerald-900">Make your habits bloom.</h1>
            <p className="home-description text-slate-600">
              A seven-day wellness pact: set a goal, put a small stake behind it, and show your
              progress day by day.
            </p>
            <div className="home-actions flex flex-wrap gap-3">
              <Link to="/pact/new" className="button-primary">
                Start a pact
              </Link>
              <Link to="/demo" className="button-secondary">
                See how it works
              </Link>
            </div>
            <p className="hero-note text-sm text-slate-500">
              Sandbox payments only. No real money moves.
            </p>
          </div>

          <figure
            className="home-garden meadow m-0 border border-slate-200 p-5"
            aria-label="A plant growing over seven days"
          >
            <p className="home-garden-label">One week of showing up</p>
            <div className="grid grid-cols-4 gap-2">
              {STAGES.map((item) => (
                <div key={item.stage} className="text-center">
                  <div className="aspect-[3/4]">
                    <PlantSVG
                      stage={item.stage}
                      vitality={item.vitality}
                      title={`${item.label}: ${item.stage}`}
                    />
                  </div>
                  <figcaption>{item.label}</figcaption>
                </div>
              ))}
            </div>
          </figure>
        </section>

        <section className="home-process">
          <div className="home-process-inner mx-auto max-w-5xl px-5 py-10">
            <h2 className="home-section-heading font-bold">How BloomStake works</h2>
            <ol className="process-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([number, title, description]) => (
                <li key={number} className="process-step">
                  <span className="process-step-number">{number}</span>
                  <h3 className="font-bold text-slate-800">{title}</h3>
                  <p className="text-sm text-slate-600">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
