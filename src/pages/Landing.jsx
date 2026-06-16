import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchGames, deleteGame } from '../lib/games'
import { isSupabaseConfigured } from '../lib/supabase'
import { formatReleaseDate, releaseSortKey } from '../lib/releaseDate'
import { useAdmin } from '../lib/AdminContext.jsx'
import BackgroundTrailers from '../components/BackgroundTrailers.jsx'
import AdminLogin from '../components/AdminLogin.jsx'
import GameForm from '../components/GameForm.jsx'

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'genre', label: 'Genre' },
  { key: 'tags', label: 'Tags', sortable: false },
  { key: 'release', label: 'Release date' },
]

export default function Landing() {
  const navigate = useNavigate()
  const { isAdmin, logout } = useAdmin()

  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState([])
  const [activeGenres, setActiveGenres] = useState([])
  const [sort, setSort] = useState({ key: 'title', dir: 'asc' })

  const [showLogin, setShowLogin] = useState(false)
  const [editing, setEditing] = useState(null) // game object, or 'new', or null

  async function load() {
    try {
      setLoading(true)
      setGames(await fetchGames())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Build the universe of tags / genres for the filter bar.
  const allTags = useMemo(
    () => [...new Set(games.flatMap((g) => g.tags || []))].sort(),
    [games]
  )
  const allGenres = useMemo(
    () => [...new Set(games.map((g) => g.genre).filter(Boolean))].sort(),
    [games]
  )

  function toggle(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = games.filter((g) => {
      if (q) {
        const hay = [g.title, g.description, g.genre, ...(g.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (activeGenres.length && !activeGenres.includes(g.genre)) return false
      if (activeTags.length && !activeTags.every((t) => (g.tags || []).includes(t)))
        return false
      return true
    })

    const dir = sort.dir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      if (sort.key === 'release') {
        return (
          (releaseSortKey(a.release_date, a.release_precision) -
            releaseSortKey(b.release_date, b.release_precision)) * dir
        )
      }
      const av = (a[sort.key] || '').toString().toLowerCase()
      const bv = (b[sort.key] || '').toString().toLowerCase()
      return av.localeCompare(bv) * dir
    })
    return rows
  }, [games, query, activeTags, activeGenres, sort])

  function setSortKey(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  async function handleDelete(game, e) {
    e.stopPropagation()
    if (!confirm(`Delete "${game.title}"?`)) return
    await deleteGame(game.id)
    load()
  }

  return (
    <>
      <BackgroundTrailers games={games} />

      <div className="top-controls">
        {isAdmin ? (
          <>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Add game
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              Exit admin
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setShowLogin(true)}>
            Admin
          </button>
        )}
      </div>

      <main className="landing">
        <h1 className="brand">Gaming</h1>

        <div className="search">
          <input
            type="search"
            placeholder="Search games, genres, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {(allGenres.length > 0 || allTags.length > 0) && (
          <div className="filter-bar">
            {allGenres.length > 0 && (
              <>
                <span className="filter-group-label">Genres</span>
                {allGenres.map((g) => (
                  <button
                    key={g}
                    className={`chip ${activeGenres.includes(g) ? 'active' : ''}`}
                    onClick={() => toggle(activeGenres, setActiveGenres, g)}
                  >
                    {g}
                  </button>
                ))}
              </>
            )}
            {allTags.length > 0 && (
              <>
                <span className="filter-group-label">Tags</span>
                {allTags.map((t) => (
                  <button
                    key={t}
                    className={`chip ${activeTags.includes(t) ? 'active' : ''}`}
                    onClick={() => toggle(activeTags, setActiveTags, t)}
                  >
                    {t}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div className="list-wrap">
          <div className="legend">
            {COLUMNS.map((col) =>
              col.sortable === false ? (
                <span key={col.key}>{col.label}</span>
              ) : (
                <button
                  key={col.key}
                  className={sort.key === col.key ? 'sorted' : ''}
                  onClick={() => setSortKey(col.key)}
                >
                  {col.label}
                  {sort.key === col.key && (
                    <span className="sort-caret">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
              )
            )}
            <span />
          </div>

          {!isSupabaseConfigured ? (
            <div className="empty">
              Supabase isn’t configured yet. Copy <code>.env.example</code> to{' '}
              <code>.env</code> and add your project URL + anon key, then restart the
              dev server.
            </div>
          ) : loading ? (
            <div className="empty">Loading…</div>
          ) : error ? (
            <div className="empty">Error: {error}</div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {games.length === 0
                ? 'No games yet. Enter admin mode to add the first one.'
                : 'No games match your filters.'}
            </div>
          ) : (
            visible.map((game) => (
              <div
                key={game.id}
                className="game-row"
                onClick={() => navigate(`/${game.slug}`)}
              >
                <div className="game-title">
                  {game.images?.[0] && <img src={game.images[0]} alt="" />}
                  {game.title}
                </div>
                <div className="game-genre">{game.genre || '—'}</div>
                <div className="tag-list">
                  {(game.tags || []).map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="game-date">
                  {formatReleaseDate(game.release_date, game.release_precision)}
                </div>
                {isAdmin ? (
                  <button
                    className="row-edit"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(game)
                    }}
                  >
                    ✎
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))
          )}
        </div>
      </main>

      {showLogin && <AdminLogin onClose={() => setShowLogin(false)} />}
      {editing && (
        <GameForm
          game={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          onDelete={editing !== 'new' ? (g, e) => {
            setEditing(null)
            handleDelete(g, e)
          } : null}
        />
      )}
    </>
  )
}
