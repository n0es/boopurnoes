import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import SupportCardImporter from './pages/SupportCardImporter'
import SupportCards from './pages/SupportCards'
import './index.css'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/import-support-card" element={<SupportCardImporter />} />
          <Route path="/support-cards" element={<SupportCards />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
