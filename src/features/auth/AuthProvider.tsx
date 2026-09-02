import type { Session, User } from '@supabase/supabase-js'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { appConfig } from '../../lib/config'
import { disableGuestMode, enableGuestMode, isGuestMode } from '../../lib/guestMode'
import { getSupabaseClient } from '../../lib/supabase/client'

type AuthContextValue = {
  session: Session | null
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isGuest: boolean
  enterGuestMode: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [guest, setGuest] = useState(isGuestMode)
  const [isLoading, setIsLoading] = useState(() => !(appConfig.isDemo || isGuestMode()))

  useEffect(() => {
    if (appConfig.isDemo || guest) {
      setIsLoading(false)
      return
    }
    const client = getSupabaseClient()
    let isMounted = true

    void client.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [guest])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    isLoading,
    isAuthenticated: appConfig.isDemo || guest || Boolean(session),
    isGuest: guest,
    enterGuestMode() {
      enableGuestMode()
      setGuest(true)
    },
    async signOut() {
      if (guest) disableGuestMode()
      else if (!appConfig.isDemo) await getSupabaseClient().auth.signOut()
      setGuest(false)
      setSession(null)
    },
  }), [guest, isLoading, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider and its hook intentionally live together as one auth boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
