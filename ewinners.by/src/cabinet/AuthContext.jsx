import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, setToken } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const data = await api('/api/auth/me')
      setUser(data.user)
      setCompany(data.company)
      return data
    } catch {
      setUser(null)
      setCompany(null)
      setToken(null)
      return null
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('ew_token')
    if (!token) {
      setLoading(false)
      return
    }
    refresh().finally(() => setLoading(false))
  }, [])

  async function login(email, password) {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setToken(data.token)
    setUser(data.user)
    await refresh()
    return data.user
  }

  function logout() {
    setToken(null)
    setUser(null)
    setCompany(null)
  }

  const value = useMemo(
    () => ({ user, company, loading, login, logout, refresh, setCompany }),
    [user, company, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
