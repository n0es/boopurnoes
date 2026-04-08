import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function getRedirectTarget(searchParams: URLSearchParams): string {
  const redirect = searchParams.get('redirect')
  if (!redirect) return '/'
  // Allow full URLs only for our own domain
  try {
    const url = new URL(redirect)
    if (url.hostname.endsWith('.boopurno.es') || url.hostname === 'boopurno.es') {
      return redirect
    }
  } catch {
    // Relative path — allow as-is
    if (redirect.startsWith('/')) return redirect
  }
  return '/'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTarget = getRedirectTarget(searchParams)

  // Handle OAuth callback — when returning from GitHub, Supabase processes
  // the hash fragment and fires SIGNED_IN. Redirect to the target.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && redirectTarget !== '/') {
        if (redirectTarget.startsWith('http')) {
          window.location.href = redirectTarget
        } else {
          navigate(redirectTarget)
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [redirectTarget, navigate])

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
      // Use window.location for cross-origin redirects (e.g. pve.boopurno.es)
      if (redirectTarget.startsWith('http')) {
        window.location.href = redirectTarget
      } else {
        navigate(redirectTarget)
      }
    }
  }

  const handleGitHubLogin = async () => {
    setError('')
    // After OAuth, Supabase redirects back to this page — preserve the redirect param
    const callbackUrl = new URL('/login', window.location.origin)
    callbackUrl.searchParams.set('redirect', redirectTarget)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: callbackUrl.toString(),
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
