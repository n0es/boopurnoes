import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate(redirectTo, { replace: true })
    }
  }

  const handleGitHubLogin = async () => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.origin,
      },
    })

    if (error) {
      setError(error.message)
    }
  }

  return (
    <>
      <header>
        <Link to="/" className="back">back</Link>
      </header>
      <main className="login-page">
        <h1>login</h1>

        {error && <p className="error">{error}</p>}

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'signing in...' : 'sign in'}
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <button className="github-btn" onClick={handleGitHubLogin}>
          continue with github
        </button>

        <p className="signup-link">
          don't have an account? <Link to="/signup">sign up</Link>
        </p>
      </main>
    </>
  )
}
