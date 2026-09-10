import { useEffect } from 'react'

import { useSession } from './api/auth'
import { SyncBanner } from './components/SyncBanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import { requestPersistentStorage } from './offline/persister'
import { Home } from './routes/Home'
import { Login } from './routes/Login'

export default function App() {
  const session = useSession()
  const authenticated = session.data?.authenticated === true

  useEffect(() => {
    // Asked for after a successful sign-in: Chrome grants persistent storage
    // more readily to an app the browser considers actually used.
    if (authenticated) void requestPersistentStorage()
  }, [authenticated])

  return (
    <>
      <SyncBanner />
      <UpdatePrompt />
      {session.isPending ? <div className="splash" /> : authenticated ? <Home /> : <Login />}
    </>
  )
}
