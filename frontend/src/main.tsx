import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import App from './App'
import { warmUp } from './api/client'
import { persister } from './offline/persister'
import './index.css'

// Before React even starts: the free server begins waking up while the app
// paints itself from data already in cache.
warmUp()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays cached forever: it is our offline archive, not an
      // optimisation.
      gcTime: Infinity,
      staleTime: 5 * 60_000,
      // With no network, serve the cache instead of hanging.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      // Retries are handled by apiFetch, with a backoff designed around
      // Render's cold start.
      retry: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: Infinity }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
