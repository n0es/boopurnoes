import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import Home from './pages/Home'
import UmaHome from './pages/UmaHome'
import Login from './pages/Login'
import Signup from './pages/Signup'
import SupportCards from './pages/SupportCards'
import Trainees from './pages/Trainees'
import DeckOptimizer from './pages/DeckOptimizer'
import CareerSimulator from './pages/CareerSimulator'
import CareerSimulatorSaves from './pages/CareerSimulatorSaves'
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
          <Route path="/support-cards" element={<SupportCards />} />
          <Route path="/trainees" element={<Trainees />} />
          <Route path="/deck-optimizer" element={<DeckOptimizer />} />
          <Route path="/career-simulator/saves" element={<CareerSimulatorSaves />} />
          <Route path="/career-simulator/run/:saveId" element={<CareerSimulator />} />
          <Route path="/career-simulator" element={<CareerSimulator />} />
          <Route path="/veterans" element={<Veterans />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
