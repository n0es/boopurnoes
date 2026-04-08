import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import ServiceMenu from '../components/ServiceMenu'

export default function Home() {
  const { user, loading, signOut } = useAuth()

  return (
    <>
      {!loading && user && <ServiceMenu />}
      <header>
        {!loading && (
          user ? (
            <button className="login" onClick={signOut}>logout</button>
          ) : (
            <Link to="/login" className="login">login</Link>
          )
        )}
      </header>
      <main className="home">
        <section className="hero">
          <h1>boop</h1>
          <p className="tagline">developer & creator</p>
        </section>

        <section className="links">
          <a href="https://github.com/n0es" target="_blank" rel="noopener noreferrer">
            github
          </a>
          <a href="https://www.linkedin.com/in/ethan-white-0ba579200/" target="_blank" rel="noopener noreferrer">
            linkedin
          </a>
          <a href="mailto:ethanwhi@gmail.com">
            contact
          </a>
        </section>

        <section className="services">
          <h2>services</h2>
          <ul>
            <li>web development</li>
            <li>software engineering</li>
            <li>consulting</li>
            <li>
              <Link to="/umamusume" className="services-link">
                uma musume tools
              </Link>
            </li>
          </ul>
        </section>
      </main>
    </>
  )
}
