import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import Home from './pages/Home'
import UmaHome from './pages/UmaHome'
import Login from './pages/Login'
import Signup from './pages/Signup'
import SupportCardImporter from './pages/SupportCardImporter'
import SupportCards from './pages/SupportCards'
import Trainees from './pages/Trainees'
import DeckOptimizer from './pages/DeckOptimizer'
import RunAnalyzer from './pages/RunAnalyzer'
import RunComparison from './pages/RunComparison'
import Veterans from './pages/Veterans'
import './index.css'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/umamusume" element={<UmaHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/import-support-card" element={<SupportCardImporter />} />
          <Route path="/support-cards" element={<SupportCards />} />
          <Route path="/trainees" element={<Trainees />} />
          <Route path="/deck-optimizer" element={<DeckOptimizer />} />
          <Route path="/run-analyzer" element={<RunAnalyzer />} />
          <Route path="/run-comparison" element={<RunComparison />} />
          <Route path="/veterans" element={<Veterans />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
