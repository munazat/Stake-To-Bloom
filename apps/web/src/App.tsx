import { Routes, Route } from 'react-router-dom'
import Landing from './routes/Landing.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
    </Routes>
  )
}
