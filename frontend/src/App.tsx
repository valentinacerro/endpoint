import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useSession } from './api/auth'
import { SyncBanner } from './components/SyncBanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import { requestPersistentStorage } from './offline/persister'
import { BookingDetail } from './routes/BookingDetail'
import { Login } from './routes/Login'
import { OfflineStatus } from './routes/OfflineStatus'
import { TripDetail } from './routes/TripDetail'
import { TripList } from './routes/TripList'

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
      {session.isPending ? (
        <div className="splash" />
      ) : authenticated ? (
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<TripList />} />
            <Route path="/trips/:tripId" element={<TripDetail />} />
            <Route path="/trips/:tripId/bookings/:bookingId" element={<BookingDetail />} />
            <Route path="/trips/:tripId/offline" element={<OfflineStatus />} />
            {/* Anything else goes home: the service worker serves index.html
                for every path, so a stale bookmark must not dead-end. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <Login />
      )}
    </>
  )
}
