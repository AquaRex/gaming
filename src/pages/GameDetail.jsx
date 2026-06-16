import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchGameBySlug } from '../lib/games'
import { foregroundEmbedUrl } from '../lib/youtube'
import { formatReleaseDate } from '../lib/releaseDate'

const IDLE_MS = 3000

export default function GameDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(undefined) // undefined = loading, null = not found
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef(null)

  useEffect(() => {
    let alive = true
    fetchGameBySlug(slug)
      .then((g) => alive && setGame(g))
      .catch(() => alive && setGame(null))
    return () => {
      alive = false
    }
  }, [slug])

  // ESC returns to the list.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // Fade the overlay out after the mouse goes idle; bring it back on movement.
  useEffect(() => {
    function wake() {
      setIdle(false)
      clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('touchstart', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(idleTimer.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('touchstart', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  if (game === undefined) {
    return <div className="center-screen">Loading…</div>
  }
  if (game === null) {
    return (
      <div className="center-screen">
        <div>Game not found.</div>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Back to list
        </button>
      </div>
    )
  }

  const embed = foregroundEmbedUrl(game.trailer_url)
  const fadedClass = idle ? 'faded' : ''

  return (
    <div className={`detail ${idle ? 'hide-cursor' : ''}`}>
      {embed ? (
        <iframe
          className="detail-video"
          src={embed}
          title={game.title}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      ) : game.images?.[0] ? (
        <img
          className="detail-video"
          src={game.images[0]}
          alt={game.title}
          style={{ objectFit: 'cover' }}
        />
      ) : null}

      <button
        className={`detail-hint detail-back btn btn-ghost ${fadedClass}`}
        onClick={() => navigate('/')}
      >
        ‹ Esc — back to list
      </button>

      <div className={`detail-overlay ${fadedClass}`}>
        <h1>{game.title}</h1>
        <div className="detail-meta">
          {game.genre && <span className="pill">{game.genre}</span>}
          <span className="pill">
            {formatReleaseDate(game.release_date, game.release_precision)}
          </span>
          {(game.tags || []).map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
        {game.description && <p className="detail-desc">{game.description}</p>}
      </div>
    </div>
  )
}
