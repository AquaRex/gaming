import { useEffect, useState } from 'react'
import { createGame, updateGame, uploadImage } from '../lib/games'
import { buildReleaseDate, releaseToForm, MONTHS, PRECISIONS } from '../lib/releaseDate'
import { thumbnailUrl, youTubeId } from '../lib/youtube'

const blank = {
  title: '',
  genre: '',
  tags: '',
  description: '',
  trailer_url: '',
}

export default function GameForm({ game, onClose, onSaved, onDelete }) {
  const isEdit = Boolean(game)

  const [fields, setFields] = useState(() =>
    game
      ? {
          title: game.title || '',
          genre: game.genre || '',
          tags: (game.tags || []).join(', '),
          description: game.description || '',
          trailer_url: game.trailer_url || '',
        }
      : blank
  )
  const [release, setRelease] = useState(() =>
    game
      ? releaseToForm(game.release_date, game.release_precision)
      : { precision: 'unknown', year: '', month: '', day: '' }
  )
  const [images, setImages] = useState(() => game?.images || [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(key, value) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  async function handleFiles(e) {
    const files = [...e.target.files]
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const urls = []
      for (const file of files) urls.push(await uploadImage(file))
      setImages((imgs) => [...imgs, ...urls])
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!fields.title.trim()) {
      setError('Title is required.')
      return
    }
    if (fields.trailer_url && !youTubeId(fields.trailer_url)) {
      setError('That trailer URL doesn’t look like a YouTube link.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      title: fields.title.trim(),
      genre: fields.genre.trim() || null,
      tags: fields.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description: fields.description.trim() || null,
      trailer_url: fields.trailer_url.trim() || null,
      images,
      ...buildReleaseDate(release),
    }
    try {
      if (isEdit) await updateGame(game.id, payload)
      else await createGame(payload)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{isEdit ? 'Edit game' : 'Add game'}</h2>

        <div className="field">
          <label>Title *</label>
          <input value={fields.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label>Genre</label>
          <input
            value={fields.genre}
            onChange={(e) => set('genre', e.target.value)}
            placeholder="e.g. Action RPG"
          />
        </div>

        <div className="field">
          <label>Tags (comma separated)</label>
          <input
            value={fields.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="souls-like, co-op, open-world"
          />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            rows={3}
            value={fields.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="field">
          <label>Trailer (YouTube URL)</label>
          <input
            value={fields.trailer_url}
            onChange={(e) => set('trailer_url', e.target.value)}
            placeholder="https://youtu.be/…"
          />
          {thumbnailUrl(fields.trailer_url) && (
            <div className="thumb-strip">
              <img src={thumbnailUrl(fields.trailer_url)} alt="trailer thumbnail" />
            </div>
          )}
        </div>

        <div className="field">
          <label>Release date</label>
          <div className="field-row">
            <select
              value={release.precision}
              onChange={(e) => setRelease((r) => ({ ...r, precision: e.target.value }))}
            >
              {PRECISIONS.map((p) => (
                <option key={p} value={p}>
                  {p === 'unknown' ? 'Unknown / TBA' : `By ${p}`}
                </option>
              ))}
            </select>
            {release.precision !== 'unknown' && (
              <input
                type="number"
                placeholder="Year"
                value={release.year}
                onChange={(e) => setRelease((r) => ({ ...r, year: e.target.value }))}
              />
            )}
            {(release.precision === 'month' || release.precision === 'day') && (
              <select
                value={release.month}
                onChange={(e) => setRelease((r) => ({ ...r, month: e.target.value }))}
              >
                <option value="">Month</option>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            {release.precision === 'day' && (
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Day"
                value={release.day}
                onChange={(e) => setRelease((r) => ({ ...r, day: e.target.value }))}
              />
            )}
          </div>
        </div>

        <div className="field">
          <label>Images</label>
          <input type="file" accept="image/*" multiple onChange={handleFiles} />
          {uploading && <div className="hint">Uploading…</div>}
          {images.length > 0 && (
            <div className="thumb-strip">
              {images.map((url) => (
                <div className="thumb" key={url}>
                  <img src={url} alt="" />
                  <button
                    type="button"
                    className="remove"
                    onClick={() => setImages((imgs) => imgs.filter((u) => u !== url))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          {isEdit && onDelete ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={(e) => onDelete(game, e)}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Add game'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
