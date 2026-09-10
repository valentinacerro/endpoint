import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useSession } from './api/auth'
import { SyncBanner } from './components/SyncBanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import { requestPersistentStorage } from './offline/persister'
import { BookingDetail } from './routes/BookingDetail'
import { Login } from './routes/Login'
import { OfflineStatus } from './routes/OfflineStatus'
import { PlacesPanel } from './routes/PlacesPanel'
import { StopsPanel } from './routes/StopsPanel'
import { TripDetail } from './routes/TripDetail'
import { TripEdit } from './routes/TripEdit'
import { TripList } from './routes/TripList'

// Split out: Leaflet and its tiles have no business delaying the screen
// that has to open instantly, offline, every morning of the trip.
const MapView = lazy(() =>
  import('./routes/MapView').then((module) => ({ default: module.MapView })),
)

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
            <Route
              path="/trips/:tripId/map"
              element={
                <Suspense fallback={<main className="page">…</main>}>
                  <MapView />
                </Suspense>
              }
            />
            <Route path="/trips/:tripId/stops" element={<StopsPanel />} />
            <Route path="/trips/:tripId/places" element={<PlacesPanel />} />
            <Route path="/trips/:tripId/edit" element={<TripEdit />} />
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
