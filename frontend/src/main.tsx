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
    mutations: {
      /**
       * Run the write even with no network, so our own queue can have it.
       *
       * This line is what makes the offline queue exist at all. React
       * Query's default is `'online'`, under which a mutation started
       * with `navigator.onLine` false is *paused*: `onMutate` runs, the
       * screen updates optimistically, and `mutationFn` is simply never
       * called. Every queued write in this app — the packing list, a
       * coffee, a place typed on a train — lives inside `mutationFn`, so
       * none of them were ever reached in aeroplane mode. The queue only
       * worked in the milder case it was not built for: the browser
       * online and the free instance asleep.
       *
       * Found by a Playwright test that actually turns the network off;
       * nothing short of that would have shown it, because with a server
       * merely unreachable the old behaviour looks perfect.
       */
      networkMode: 'offlineFirst',
      // Same reason as above, and `sendOrQueue` treats a failure as
      // "keep it for later" rather than as an error.
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
