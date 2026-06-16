import { createContext, useContext, useState, useCallback } from 'react'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || '4054'
const STORAGE_KEY = 'gaming.admin'

const AdminContext = createContext(null)

export function AdminProvider({ children }) {
  const [isAdmin, setIsAdmin] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) === '1'
  )

  const login = useCallback((password) => {
    const ok = password === ADMIN_PASSWORD
    if (ok) {
      sessionStorage.setItem(STORAGE_KEY, '1')
      setIsAdmin(true)
    }
    return ok
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setIsAdmin(false)
  }, [])

  return (
    <AdminContext.Provider value={{ isAdmin, login, logout }}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider')
  return ctx
}
