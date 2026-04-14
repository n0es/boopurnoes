import { useEffect } from 'react'

const LINK_LOGIN = 'https://link.boopurno.es/login'

export default function Signup() {
  useEffect(() => {
    const loginUrl = new URL(LINK_LOGIN)
    loginUrl.searchParams.set('next', window.location.origin + '/')
    window.location.href = loginUrl.toString()
  }, [])

  return (
    <main className="login-page">
      <p>redirecting to login…</p>
    </main>
  )
}
