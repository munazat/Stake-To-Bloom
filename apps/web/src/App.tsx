import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Landing from './routes/Landing.tsx'

// The wizard pulls in @bloomstake/core (schemas, templates, canonical JSON) and
// zod with it. Splitting the route keeps that out of the landing page's bundle —
// the first thing a judge loads should not pay for the rule engine.
const PactNew = lazy(() => import('./routes/PactNew.tsx'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/pact/new"
        element={
          <Suspense
            fallback={
              <p role="status" className="p-8 text-center text-sm text-stone-500">
                Loading the pact wizard…
              </p>
            }
          >
            <PactNew />
          </Suspense>
        }
      />
    </Routes>
  )
}
