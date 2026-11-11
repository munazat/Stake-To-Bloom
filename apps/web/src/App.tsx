import { Suspense, lazy, type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import Landing from './routes/Landing.tsx'

// The wizard pulls in @bloomstake/core (schemas, templates, canonical JSON) and
// zod with it. Splitting the route keeps that out of the landing page's bundle —
// the first thing a judge loads should not pay for the rule engine.
const PactNew = lazy(() => import('./routes/PactNew.tsx'))
// The garden pulls in three and the WebGL renderer, the heaviest dependency here.
const Garden = lazy(() => import('./routes/Garden.tsx'))
const PactDetail = lazy(() => import('./routes/PactDetail.tsx'))

function Deferred({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-center text-sm text-stone-500">
          {label}
        </p>
      }
    >
      {children}
    </Suspense>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/pact/new"
        element={
          <Deferred label="Loading the pact wizard…">
            <PactNew />
          </Deferred>
        }
      />
      <Route
        path="/pact/:id"
        element={
          <Deferred label="Loading your pact…">
            <PactDetail />
          </Deferred>
        }
      />
      <Route
        path="/garden"
        element={
          <Deferred label="Loading your garden…">
            <Garden />
          </Deferred>
        }
      />
    </Routes>
  )
}
