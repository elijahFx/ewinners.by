import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, setToken } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [company, setCompany] = useState(null)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const data = await api('/api/auth/me')
      setUser(data.user)
      setCompany(data.company)
      setCompanies(data.companies || [])
      return data
    } catch {
      setUser(null)
      setCompany(null)
      setCompanies([])
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

  async function applySession(data) {
    setToken(data.token)
    setUser(data.user)
    await refresh()
    return data.user
  }

  async function login(login, password) {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { login, password },
    })
    if (data.requires2fa) {
      return data
    }
    return applySession(data)
  }

  async function verify2fa(challengeId, code) {
    const data = await api('/api/auth/2fa/verify', {
      method: 'POST',
      body: { challengeId, code },
    })
    return applySession(data)
  }

  async function resend2fa(challengeId) {
    return api('/api/auth/2fa/resend', {
      method: 'POST',
      body: { challengeId },
    })
  }

  function logout() {
    setToken(null)
    setUser(null)
    setCompany(null)
    setCompanies([])
  }

  async function switchCompany(companyId) {
    const data = await api(`/api/cabinet/companies/${companyId}/activate`, { method: 'POST' })
    await refresh()
    return data
  }

  const value = useMemo(
    () => ({
      user,
      company,
      companies,
      loading,
      login,
      verify2fa,
      resend2fa,
      logout,
      refresh,
      setCompany,
      switchCompany,
    }),
    [user, company, companies, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
