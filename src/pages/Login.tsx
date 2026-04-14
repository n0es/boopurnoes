import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

const LINK_LOGIN = 'https://link.boopurno.es/login'

function getRedirectTarget(searchParams: URLSearchParams): string {
  const redirect = searchParams.get('redirect')
  if (!redirect) return '/'
  try {
    const url = new URL(redirect)
    if (url.hostname.endsWith('.boopurno.es') || url.hostname === 'boopurno.es') {
      return redirect
    }
  } catch {
    if (redirect.startsWith('/')) return redirect
  }
  return '/'
}

export default function Login() {
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const next = getRedirectTarget(searchParams)
    const loginUrl = new URL(LINK_LOGIN)
    loginUrl.searchParams.set('next', next.startsWith('/') ? window.location.origin + next : next)
    window.location.href = loginUrl.toString()
  }, [searchParams])

  return (
    <main className="login-page">
      <p>redirecting to login…</p>
    </main>
  )
}
