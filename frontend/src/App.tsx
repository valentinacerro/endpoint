import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useSession } from './api/auth'
import { useLocale } from './i18n'
import { SyncBanner } from './components/SyncBanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import { requestPersistentStorage } from './offline/persister'
import { BookingDetail } from './routes/BookingDetail'
import { Expenses } from './routes/Expenses'
import { Packing } from './routes/Packing'
import { Diary } from './routes/Diary'
import { Memories } from './routes/Memories'
import { Settings } from './routes/Settings'
import { Share } from './routes/Share'
import { Nearby } from './routes/Nearby'
import { Print } from './routes/Print'
import { Search } from './routes/Search'
import { Weather } from './routes/Weather'
import { Login } from './routes/Login'
import { OfflineStatus } from './routes/OfflineStatus'
import { PlacesPanel } from './routes/PlacesPanel'
import { PlanTrip } from './routes/PlanTrip'
import { StopsPanel } from './routes/StopsPanel'
import { TripDetail } from './routes/TripDetail'
import { TripEdit } from './routes/TripEdit'
import { TripLayout } from './routes/TripLayout'
import { Today } from './routes/Today'
import { TripList } from './routes/TripList'
import { TripMore } from './routes/TripMore'

// Split out: Leaflet and its tiles have no business delaying the screen
// that has to open instantly, offline, every morning of the trip.
const MapView = lazy(() =>
  import('./routes/MapView').then((module) => ({ default: module.MapView })),
)

export default function App() {
  const session = useSession()
  // Subscribing here is the whole language-switching mechanism. Nothing
  // in this app is memoised, so a render at the root reaches every
  // screen — which is why `t()` stays an ordinary function that any
  // module can import, rather than a hook that would have to be threaded
  // through `lib/` and `i18n/labels.ts` as well.
  useLocale()
  const authenticated = session.data?.authenticated === true

  useEffect(() => {
    // Asked for after a successful sign-in: Chrome grants persistent storage
    // more readily to an app the browser considers actually used.
    if (authenticated) void requestPersistentStorage()
  }, [authenticated])

  if (session.isPending) return <div className="splash" />
  if (!authenticated) {
    return (
      <>
        <SyncBanner />
        <Login />
      </>
    )
  }

  return (
    <BrowserRouter>
      <SyncBanner />
      <UpdatePrompt />
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/trips" element={<TripList />} />
        <Route path="/settings" element={<Settings />} />
        {/* Where Android's share sheet delivers a link. */}
        <Route path="/share" element={<Share />} />
        {/* Everything inside a trip shares the bottom bar, so it never
            unmounts and never flickers between sections. */}
        <Route path="/trips/:tripId" element={<TripLayout />}>
          <Route index element={<TripDetail />} />
          <Route path="places" element={<PlacesPanel />} />
          <Route path="plan" element={<PlanTrip />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="packing" element={<Packing />} />
          <Route path="weather" element={<Weather />} />
          <Route path="search" element={<Search />} />
          <Route path="nearby" element={<Nearby />} />
          <Route path="print" element={<Print />} />
          <Route path="diary" element={<Diary />} />
          <Route path="memories" element={<Memories />} />
          <Route path="more" element={<TripMore />} />
          <Route path="stops" element={<StopsPanel />} />
          <Route path="offline" element={<OfflineStatus />} />
          <Route path="edit" element={<TripEdit />} />
          <Route path="bookings/:bookingId" element={<BookingDetail />} />
          <Route
            path="map"
            element={
              <Suspense fallback={<main className="page" />}>
                <MapView />
              </Suspense>
            }
          />
        </Route>
        {/* Anything else goes home: the service worker serves index.html for
            every path, so a stale bookmark must not dead-end. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
