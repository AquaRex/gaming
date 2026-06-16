import { useEffect, useState } from 'react'
import { useAdmin } from '../lib/AdminContext.jsx'

export default function AdminLogin({ onClose }) {
  const { login } = useAdmin()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e) {
    e.preventDefault()
    if (login(password)) {
      onClose()
    } else {
      setError(true)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Admin access</h2>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(false)
            }}
            placeholder="••••"
          />
          {error && <div className="error-text">Wrong password.</div>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <div className="right">
            <button type="submit" className="btn btn-primary">
              Unlock
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
