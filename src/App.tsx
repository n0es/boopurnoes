import './index.css'

function App() {
  return (
    <main>
      <section className="hero">
        <h1>boop</h1>
        <p className="tagline">developer & creator</p>
      </section>

      <section className="links">
        <a href="https://github.com/iboopurnoes" target="_blank" rel="noopener noreferrer">
          github
        </a>
        <a href="https://twitter.com/noesbooper" target="_blank" rel="noopener noreferrer">
          twitter
        </a>
        <a href="mailto:hello@boopurno.es">
          contact
        </a>
      </section>

      <section className="services">
        <h2>services</h2>
        <ul>
          <li>web development</li>
          <li>software engineering</li>
          <li>consulting</li>
        </ul>
      </section>
    </main>
  )
}

export default App
