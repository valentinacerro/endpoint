/**
 * Queries and mutations for a trip and everything under it.
 *
 * Reads go through the bundle: one request holds the whole trip, every
 * screen selects its slice from that single cache entry. That is what makes
 * the app work offline after one successful sync, with no per-screen offline
 * handling anywhere.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { guessBooking, guessPlace, guessStop, waitingAttachment } from '../lib/optimistic'
import { enqueue, payloadOf, type QueuedWrite } from '../offline/outbox'
import { shouldKeep } from '../offline/useOutbox'

import { ApiError, apiFetch } from './client'
import type {
  Attachment,
  Booking,
  BookingCreate,
  BookingUpdate,
  ChecklistItem,
  ChecklistItemWrite,
  DayNote,
  DiaryEntry,
  Expense,
  ExpenseWrite,
  Memory,
  MemoryWrite,
  Place,
  PlaceCreate,
  PlaceHit,
  PlaceUpdate,
  ResolvedPlace,
  Stop,
  StopCreate,
  StopUpdate,
  Suggestion,
  Trip,
  TripBundle,
  TripCreate,
  TripUpdate,
  Weather,
} from './types'

/** What an optimistic write puts back if the server turns it down. */
type Rollback = { previous: TripBundle | undefined }

/**
 * Send a write, or keep it until there is a network again.
 *
 * The same eight lines were written out at every queued mutation, and the
 * one that is easy to get wrong is `creates`: forget it on a create and a
 * place added in a tunnel and then deleted before surfacing sends a
 * deletion for a row the server was never told about.
 *
 * `guess` is what the caller believes the server would have stored. It is
 * returned in place of the server's answer, so the screen carries on as
 * though the write had landed — which, once the queue drains, it will have.
 */
export async function sendOrQueue<T>(
  request: {
    key: string
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url: string
    body?: unknown
    /** An upload. Stored in pieces, because a `FormData` cannot be. */
    form?: { file: File; fields: Record<string, string> }
    creates?: boolean
  },
  guess: () => T,
): Promise<T> {
  const { key, method, url, body, form, creates } = request
  try {
    // Built by the same function that will rebuild it out of the queue, so
    // a request that waited in a tunnel is the request that would have gone.
    return await apiFetch<T>(url, { method, body: payloadOf({ body, form } as QueuedWrite) })
  } catch (error) {
    if (!shouldKeep(error)) throw error
    await enqueue({ key, method, url, body, form, creates })
    return guess()
  }
}

export const keys = {
  trips: ['trips'] as const,
  bundle: (tripId: string) => ['trip', tripId, 'bundle'] as const,
  weather: (tripId: string) => ['trip', tripId, 'weather'] as const,
}

export function useTrips() {
  return useQuery({
    queryKey: keys.trips,
    queryFn: () => apiFetch<Trip[]>('/api/trips'),
  })
}

export function useTripBundle(tripId: string | undefined) {
  return useQuery({
    queryKey: keys.bundle(tripId ?? ''),
    queryFn: () => apiFetch<TripBundle>(`/api/trips/${tripId}/bundle`),
    enabled: Boolean(tripId),
  })
}

/**
 * A mutation that refreshes the trip afterwards.
 *
 * Everything below a trip lives in one cache entry, so any write invalidates
 * that entry rather than trying to patch it in place. Simpler, and it cannot
 * drift from what the server actually stored.
 */
function useTripMutation<TVars, TData>(
  tripId: string,
  mutationFn: (vars: TVars) => Promise<TData>,
) {
  const queryClient = useQueryClient()
  // The error type is named explicitly so callers can branch on `code`,
  // which is how user-facing messages are chosen.
  return useMutation<TData, ApiError, TVars>({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.bundle(tripId) })
      await queryClient.invalidateQueries({ queryKey: keys.trips })
    },
  })
}

// --- Trips ---

/**
 * Start a trip, at an id chosen here.
 *
 * The least likely of these to be made with no network — you plan a trip
 * at a kitchen table — but the first stop the form creates is addressed
 * by this id, so if this one could not be queued neither could that one.
 */
export function useCreateTrip() {
  const queryClient = useQueryClient()
  return useMutation<Trip, ApiError, TripCreate & { id: string }>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Trip>(
        { key: `trip:${id}`, method: 'PUT', url: `/api/trips/${id}`, body, creates: true },
        () => {
          const now = new Date().toISOString()
          return { ...body, id, created_at: now, updated_at: now } as Trip
        },
      ),
    // The reply is the whole trip, so there is nothing to go back and ask
    // for — and asking would fail in the one case this exists for.
    onSuccess: (trip) =>
      queryClient.setQueryData<Trip[]>(keys.trips, (trips) => [
        ...(trips ?? []).filter((entry) => entry.id !== trip.id),
        trip,
      ]),
  })
}

export function useUpdateTrip(tripId: string) {
  return useTripMutation(tripId, (body: TripUpdate) =>
    apiFetch<Trip>(`/api/trips/${tripId}`, { method: 'PATCH', body }),
  )
}

export function useDeleteTrip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tripId: string) =>
      apiFetch<void>(`/api/trips/${tripId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.trips }),
  })
}

// --- Stops ---

/**
 * Add a city, at an id chosen here rather than by the server.
 *
 * A POST cannot be queued: the server names the row, so a request whose
 * reply was lost would be sent again and produce a second Kyoto. Naming it
 * on the phone is what makes the write safe to repeat, and therefore what
 * makes it possible to add a stop with no network at all.
 *
 * `position` is the server's to decide, so the guess drawn on screen puts
 * the new stop last — which is where it goes. The server's answer replaces
 * the guess as soon as one arrives.
 */
export function useCreateStop(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Stop, ApiError, StopCreate & { id: string }, Rollback>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Stop>(
        {
          key: `stop:${id}`,
          method: 'PUT',
          url: `/api/trips/${tripId}/stops/${id}`,
          body,
          creates: true,
        },
        () => guessStop(tripId, id, body, snapshotBundle(queryClient, tripId)?.stops),
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      const optimistic = guessStop(tripId, id, body, previous?.stops)
      patchStops(queryClient, tripId, (stops) => [
        ...stops.filter((stop) => stop.id !== id),
        optimistic,
      ])
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (stop) =>
      patchStops(queryClient, tripId, (stops) =>
        stops.map((entry) => (entry.id === stop.id ? stop : entry)),
      ),
  })
}

export function useUpdateStop(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Stop, ApiError, StopUpdate & { id: string }, Rollback>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Stop>(
        { key: `stop:${id}`, method: 'PATCH', url: `/api/trips/${tripId}/stops/${id}`, body },
        () => {
          const existing = snapshotBundle(queryClient, tripId)?.stops.find((stop) => stop.id === id)
          return { ...existing, ...body, id } as Stop
        },
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchStops(queryClient, tripId, (stops) =>
        stops.map((stop) =>
          stop.id === id ? ({ ...stop, ...body, updated_at: new Date().toISOString() } as Stop) : stop,
        ),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (stop) =>
      patchStops(queryClient, tripId, (stops) =>
        stops.map((entry) => (entry.id === stop.id ? stop : entry)),
      ),
  })
}

export function useDeleteStop(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string, Rollback>({
    mutationFn: (stopId) =>
      sendOrQueue<void>(
        { key: `stop:${stopId}`, method: 'DELETE', url: `/api/trips/${tripId}/stops/${stopId}` },
        () => undefined,
      ),
    onMutate: async (stopId) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchStops(queryClient, tripId, (stops) => stops.filter((stop) => stop.id !== stopId))
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

export function useReorderStops(tripId: string) {
  return useTripMutation(tripId, (stopIds: string[]) =>
    apiFetch<Stop[]>(`/api/trips/${tripId}/stops/reorder`, {
      method: 'POST',
      body: { stop_ids: stopIds },
    }),
  )
}

// --- Bookings ---

/**
 * Record a booking, at an id chosen here.
 *
 * The write that most wants the queue: you are handed a confirmation at a
 * desk, in a building with no signal, and the alternative to recording it
 * there is remembering it until later.
 */
export function useCreateBooking(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Booking, ApiError, BookingCreate & { id: string }, Rollback>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Booking>(
        {
          key: `booking:${id}`,
          method: 'PUT',
          url: `/api/trips/${tripId}/bookings/${id}`,
          body,
          creates: true,
        },
        () => guessBooking(tripId, id, body),
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchBookings(queryClient, tripId, (bookings) => [
        ...bookings.filter((booking) => booking.id !== id),
        guessBooking(tripId, id, body),
      ])
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (booking) =>
      patchBookings(queryClient, tripId, (bookings) =>
        bookings.map((entry) => (entry.id === booking.id ? booking : entry)),
      ),
  })
}

export function useUpdateBooking(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Booking, ApiError, BookingUpdate & { id: string }, Rollback>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Booking>(
        { key: `booking:${id}`, method: 'PATCH', url: `/api/trips/${tripId}/bookings/${id}`, body },
        () => {
          const existing = snapshotBundle(queryClient, tripId)?.bookings.find(
            (booking) => booking.id === id,
          )
          return { ...existing, ...body, id } as Booking
        },
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchBookings(queryClient, tripId, (bookings) =>
        bookings.map((booking) =>
          booking.id === id
            ? ({ ...booking, ...body, updated_at: new Date().toISOString() } as Booking)
            : booking,
        ),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (booking) =>
      patchBookings(queryClient, tripId, (bookings) =>
        bookings.map((entry) => (entry.id === booking.id ? booking : entry)),
      ),
  })
}

export function useDeleteBooking(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string, Rollback>({
    mutationFn: (bookingId) =>
      sendOrQueue<void>(
        {
          key: `booking:${bookingId}`,
          method: 'DELETE',
          url: `/api/trips/${tripId}/bookings/${bookingId}`,
        },
        () => undefined,
      ),
    onMutate: async (bookingId) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchBookings(queryClient, tripId, (bookings) =>
        bookings.filter((booking) => booking.id !== bookingId),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

// --- Places ---

/**
 * Add a place, at an id chosen here.
 *
 * Collecting places is the thing you do on a train, and a train is where
 * this used to fail: the form said "saving" and then said nothing.
 *
 * The queue key is per place, so adding one underground and correcting its
 * name twice before surfacing sends one write carrying the last version.
 */
export function useCreatePlace(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Place, ApiError, PlaceCreate & { id: string }, Rollback>({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Place>(
        {
          key: `place:${id}`,
          method: 'PUT',
          url: `/api/trips/${tripId}/places/${id}`,
          body,
          creates: true,
        },
        () => guessPlace(tripId, id, body),
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchPlaces(queryClient, tripId, (places) => [
        ...places.filter((place) => place.id !== id),
        guessPlace(tripId, id, body),
      ])
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (place) =>
      patchPlaces(queryClient, tripId, (places) =>
        places.map((entry) => (entry.id === place.id ? place : entry)),
      ),
  })
}

/**
 * Change a place, queueing the change when there is no network.
 *
 * This is the write you make while travelling: move a temple to Thursday,
 * take it off a day that filled up, shorten a visit standing outside it.
 * It used to fail outright underground, in an app whose whole claim is
 * that it works there.
 *
 * A PATCH naming the fields it sets is already safe to replay — sending
 * it twice leaves the same place — so this needed no new endpoint, only
 * the queue that was already carrying expenses and the packing list.
 *
 * The queue key is per place, so dragging one across three days in a
 * tunnel sends one write carrying where it ended up, not three.
 */
export function useUpdatePlace(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    Place,
    ApiError,
    PlaceUpdate & { id: string },
    { previous: TripBundle | undefined }
  >({
    mutationFn: ({ id, ...body }) =>
      sendOrQueue<Place>(
        { key: `place:${id}`, method: 'PATCH', url: `/api/trips/${tripId}/places/${id}`, body },
        () => {
          const existing = snapshotBundle(queryClient, tripId)?.places.find(
            (place) => place.id === id,
          )
          return { ...existing, ...body, id } as Place
        },
      ),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchPlaces(queryClient, tripId, (places) =>
        places.map((place) =>
          place.id === id
            ? ({ ...place, ...body, updated_at: new Date().toISOString() } as Place)
            : place,
        ),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    onSuccess: (place) =>
      patchPlaces(queryClient, tripId, (places) =>
        places.map((entry) => (entry.id === place.id ? place : entry)),
      ),
  })
}

/** Deleting by id is safe to repeat: the second one finds nothing to do. */
export function useDeletePlace(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string, { previous: TripBundle | undefined }>({
    mutationFn: (placeId) =>
      sendOrQueue<void>(
        { key: `place:${placeId}`, method: 'DELETE', url: `/api/trips/${tripId}/places/${placeId}` },
        () => undefined,
      ),
    onMutate: async (placeId) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchPlaces(queryClient, tripId, (places) =>
        places.filter((place) => place.id !== placeId),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

// --- Google Maps links ---

/**
 * Ask the server to read a Google Maps link.
 *
 * It has to be the server: a shared link is a `maps.app.goo.gl` redirect,
 * and the browser cannot follow one cross-origin to see where it lands.
 *
 * `near` is where the trip is. A share link does not always carry a
 * position — the page behind it draws its map in JavaScript — and then
 * the server looks the name up instead; the bias is what makes it find
 * the Ichiran in Tokyo rather than the one in Hong Kong. The answer's
 * `position` says which happened.
 */
export function useResolveMapsLink() {
  return useMutation<ResolvedPlace, ApiError, { url: string; near: { lat: number; lon: number } | null }>({
    mutationFn: ({ url, near }) =>
      apiFetch<ResolvedPlace>('/api/maps/resolve', {
        method: 'POST',
        body: { url, near_lat: near?.lat ?? null, near_lon: near?.lon ?? null },
      }),
  })
}

export interface ImportSummary {
  created: number
  with_position: number
  without_position: number
  skipped: number
  /** Saved lists in the upload: one for a CSV, however many for a zip. */
  lists: number
}

export function useImportPlaces(tripId: string) {
  return useTripMutation(tripId, (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<ImportSummary>(`/api/trips/${tripId}/places/import`, {
      method: 'POST',
      body: form,
    })
  })
}

// --- Expenses ---

export interface RateOut {
  rate: number
  date: string
  source: 'ecb' | 'manual'
}

/**
 * Write an expense at an id the client chose.
 *
 * PUT, not POST: you record a coffee where there is no signal, the write is
 * queued, and a replay must leave one coffee rather than two.
 */
/** Put the expense straight into the cached trip, so it shows at once. */
function cacheExpense(queryClient: QueryClient, tripId: string, expense: Expense) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) => {
    if (!bundle) return bundle
    const without = bundle.expenses.filter((item) => item.id !== expense.id)
    return { ...bundle, expenses: [...without, expense] }
  })
}

function uncacheExpense(queryClient: QueryClient, tripId: string, expenseId: string) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle
      ? { ...bundle, expenses: bundle.expenses.filter((item) => item.id !== expenseId) }
      : bundle,
  )
}

export function usePutExpense(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Expense, ApiError, ExpenseWrite & { id: string }>({
    mutationFn: async ({ id, ...body }) => {
      const url = `/api/trips/${tripId}/expenses/${id}`
      try {
        return await apiFetch<Expense>(url, { method: 'PUT', body })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        // No signal: queue it and hand back a stand-in, so the list shows
        // the coffee you just paid for instead of looking like it failed.
        // `creates` when the server has never seen this row: deleting it
        // while still offline then cancels both writes, instead of asking
        // the server to remove something it was never told about.
        const known = snapshotBundle(queryClient, tripId)?.expenses
        await enqueue({
          key: `expense:${id}`,
          method: 'PUT',
          url,
          body,
          creates: !known?.some((item) => item.id === id),
        })
        const now = new Date().toISOString()
        return {
          ...body,
          id,
          trip_id: tripId,
          rate: body.rate ?? null,
          rate_date: body.rate_date ?? null,
          rate_source: body.rate_source ?? null,
          stop_id: body.stop_id ?? null,
          booking_id: body.booking_id ?? null,
          notes: body.notes ?? null,
          created_at: now,
          updated_at: now,
        } as Expense
      }
    },
    onSuccess: async (expense) => {
      cacheExpense(queryClient, tripId, expense)
      await queryClient.invalidateQueries({ queryKey: keys.bundle(tripId) })
    },
  })
}

export function useDeleteExpense(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: async (expenseId) => {
      const url = `/api/trips/${tripId}/expenses/${expenseId}`
      try {
        await apiFetch<void>(url, { method: 'DELETE' })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        await enqueue({ key: `expense:${expenseId}`, method: 'DELETE', url })
      }
    },
    onSuccess: async (_result, expenseId) => {
      uncacheExpense(queryClient, tripId, expenseId)
      await queryClient.invalidateQueries({ queryKey: keys.bundle(tripId) })
    },
  })
}

export function useFetchRate() {
  return useMutation<RateOut, ApiError, { base: string; quote: string; on: string }>({
    mutationFn: ({ base, quote, on }) =>
      apiFetch<RateOut>(`/api/rates?base=${base}&quote=${quote}&on=${on}`),
  })
}

/**
 * Apply a whole trip's worth of scheduling at once.
 *
 * One request, all or nothing. As separate PATCHes, thirty visits were
 * thirty round trips against a service that can take a minute to wake,
 * and sixty refetches — and a connection dropping halfway left the
 * itinerary half rearranged with no way to tell which half.
 */
interface ScheduleBody {
  /** Places that do not exist yet, made and given a time in one act. */
  created?: (PlaceCreate & { id: string })[]
  scheduled: { id: string; planned_start_at: string; planned_tz: string }[]
  cleared?: string[]
}

export function useSchedulePlaces(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    { created: number; scheduled: number; cleared: number },
    ApiError,
    ScheduleBody,
    Rollback
  >({
    mutationFn: (body) =>
      sendOrQueue(
        {
          // A key of its own each time, rather than one per trip: planning
          // Tuesday and then Wednesday are two different plans, and folding
          // them onto one key would send only Wednesday's. They are small,
          // they are ordered, and the later one wins where they overlap
          // because it names every place it moves.
          key: `schedule:${crypto.randomUUID()}`,
          method: 'POST',
          url: `/api/trips/${tripId}/places/schedule`,
          body,
        },
        () => ({
          created: body.created?.length ?? 0,
          scheduled: body.scheduled.length,
          cleared: body.cleared?.length ?? 0,
        }),
      ),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      const moved = new Map(body.scheduled.map((entry) => [entry.id, entry]))
      const cleared = new Set(body.cleared ?? [])
      patchPlaces(queryClient, tripId, (places) =>
        places.map((place) => {
          const to = moved.get(place.id)
          if (to) {
            return { ...place, planned_start_at: to.planned_start_at, planned_tz: to.planned_tz }
          }
          return cleared.has(place.id)
            ? { ...place, planned_start_at: null, planned_tz: null }
            : place
        }),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

// --- Looking a place up by name ---

/**
 * Suggestions for a place being typed.
 *
 * A query, not a mutation, so React Query does the caching: going back
 * a letter and forward again does not ask twice. `keepPreviousData` is
 * what stops the list blinking empty between keystrokes, which reads as
 * "nothing found" for a moment and is the single most annoying thing a
 * search box can do.
 */
export function usePlaceSearch(query: string, near: { lat: number; lon: number } | null) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['geo', trimmed, near?.lat ?? null, near?.lon ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ q: trimmed })
      if (near) {
        params.set('lat', String(near.lat))
        params.set('lon', String(near.lon))
      }
      return apiFetch<PlaceHit[]>(`/api/geo/search?${params}`)
    },
    // Two letters match half the world and cost somebody else a request.
    enabled: trimmed.length >= 3,
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * One lookup, on demand.
 *
 * The query above is for a box being typed into. Filling in a list of
 * stops is a loop, and a loop wants to ask rather than to subscribe.
 */
/**
 * What there is to see around a point, best known first.
 *
 * Cached for good, like everything else here: Overpass is a volunteer
 * service that falls over regularly and takes seconds when it does not,
 * so the second look at a city must not pay for the first. An empty
 * answer is a legitimate one — the screen says so rather than retrying.
 */
/**
 * Ask what is around a point, now, rather than while a screen renders.
 *
 * `useSuggestions` is the hook a panel uses for one city. The planner
 * needs several, chosen after a plan has been computed, so it cannot
 * declare them up front. `fetchQuery` gets the same cache: a city the
 * suggestion panel already looked at is not asked about twice.
 */
export function useDiscover() {
  const queryClient = useQueryClient()
  return (near: { lat: number; lon: number }, radiusKm = 5) =>
    queryClient.fetchQuery({
      queryKey: ['discover', near.lat, near.lon, radiusKm] as const,
      queryFn: () =>
        apiFetch<Suggestion[]>(
          `/api/geo/discover?${new URLSearchParams({
            lat: String(near.lat),
            lon: String(near.lon),
            radius_km: String(radiusKm),
          })}`,
        ),
      staleTime: Infinity,
    })
}

export function useSuggestions(near: { lat: number; lon: number } | null, radiusKm = 5) {
  return useQuery({
    queryKey: ['discover', near?.lat ?? null, near?.lon ?? null, radiusKm] as const,
    queryFn: () =>
      apiFetch<Suggestion[]>(
        `/api/geo/discover?${new URLSearchParams({
          lat: String(near!.lat),
          lon: String(near!.lon),
          radius_km: String(radiusKm),
        })}`,
      ),
    enabled: near !== null,
    // A city's notable places do not change between two looks at a trip.
    staleTime: Infinity,
  })
}

/**
 * Where a saved place is, by its name.
 *
 * For repairing a list rather than for typing: it tries the whole name
 * and then the part before the first comma, because a share from Maps
 * writes the entire postal address into the name.
 */
export function useLocatePlace() {
  return useMutation<
    PlaceHit | null,
    ApiError,
    { name: string; near: { lat: number; lon: number } | null }
  >({
    mutationFn: ({ name, near }) =>
      apiFetch<PlaceHit | null>(
        `/api/geo/locate?${new URLSearchParams({
          name,
          ...(near ? { lat: String(near.lat), lon: String(near.lon) } : {}),
        })}`,
      ),
  })
}

/**
 * Record how long a leg really takes.
 *
 * A PUT at an address the client already knows — the pair of coordinates
 * — so writing the same thing twice is harmless, which is what the
 * offline queue needs.
 */
export function useSetTravelTime(tripId: string) {
  return useTripMutation<
    { from: { lat: number; lon: number }; to: { lat: number; lon: number }; minutes: number },
    unknown
  >(tripId, ({ from, to, minutes }) =>
    apiFetch(`/api/trips/${tripId}/travel-times`, {
      method: 'PUT',
      body: {
        from_lat: from.lat,
        from_lon: from.lon,
        to_lat: to.lat,
        to_lon: to.lon,
        minutes,
      },
    }),
  )
}

export function useLookupPlace() {
  return useMutation<PlaceHit[], ApiError, { query: string }>({
    mutationFn: ({ query }) =>
      apiFetch<PlaceHit[]>(`/api/geo/search?${new URLSearchParams({ q: query })}`),
  })
}

// --- Weather ---

/** Roughly how often a forecast is worth re-fetching. */
const FORECAST_FRESH_MS = 3 * 60 * 60 * 1000

/**
 * The forecast for the trip.
 *
 * Its own cache entry, not part of the bundle: the bundle is your data,
 * revalidated by an ETag from when you last changed it, while a forecast
 * changes several times a day on its own. It is persisted like everything
 * else, so offline you still see the last one fetched — which is why the
 * screen always shows when that was.
 */
export function useWeather(tripId: string | undefined) {
  return useQuery({
    queryKey: keys.weather(tripId ?? ''),
    queryFn: () => apiFetch<Weather>(`/api/trips/${tripId}/weather`),
    enabled: Boolean(tripId),
    staleTime: FORECAST_FRESH_MS,
  })
}

// --- Packing checklist ---

function patchChecklist(
  queryClient: QueryClient,
  tripId: string,
  change: (items: ChecklistItem[]) => ChecklistItem[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, checklist: change(bundle.checklist) } : bundle,
  )
}

function patchAttachments(
  queryClient: QueryClient,
  tripId: string,
  change: (attachments: Attachment[]) => Attachment[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, attachments: change(bundle.attachments) } : bundle,
  )
}

function patchStops(queryClient: QueryClient, tripId: string, change: (stops: Stop[]) => Stop[]) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, stops: change(bundle.stops) } : bundle,
  )
}

function patchBookings(
  queryClient: QueryClient,
  tripId: string,
  change: (bookings: Booking[]) => Booking[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, bookings: change(bundle.bookings) } : bundle,
  )
}

function patchPlaces(
  queryClient: QueryClient,
  tripId: string,
  change: (places: Place[]) => Place[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, places: change(bundle.places) } : bundle,
  )
}

function patchDayNotes(
  queryClient: QueryClient,
  tripId: string,
  change: (notes: DayNote[]) => DayNote[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, day_notes: change(bundle.day_notes) } : bundle,
  )
}

/** The bundle as it stands, so a failed write can be put back. */
function snapshotBundle(queryClient: QueryClient, tripId: string) {
  return queryClient.getQueryData<TripBundle>(keys.bundle(tripId))
}

function restore(queryClient: QueryClient, tripId: string, bundle: TripBundle | undefined) {
  if (bundle) queryClient.setQueryData(keys.bundle(tripId), bundle)
}

/**
 * Write one line of the packing list, at an id the client chose.
 *
 * The write this queue was built for. Packing happens at home the night
 * before and in hotel rooms, both places where the phone may have nothing,
 * so a tick has to land on the screen at once and reach the server later.
 *
 * The tick is applied to the cache before the request goes out. Waiting for
 * a reply would mean a box that ignores you for the length of a cold start,
 * which reads as a broken checkbox rather than a slow server. If the write
 * genuinely fails — not offline, an actual rejection — the box goes back.
 *
 * The queue key is per item, so tapping the same box four times underground
 * sends one write carrying the state it ended in, not four.
 */
export function usePutChecklistItem(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    ChecklistItem,
    ApiError,
    ChecklistItemWrite & { id: string },
    { previous: TripBundle | undefined }
  >({
    mutationFn: async ({ id, ...body }) => {
      const url = `/api/trips/${tripId}/checklist/${id}`
      try {
        return await apiFetch<ChecklistItem>(url, { method: 'PUT', body })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        // `creates` when the server has never seen this row: deleting it
        // while still offline then cancels both writes, instead of asking
        // the server to remove something it was never told about.
        const known = snapshotBundle(queryClient, tripId)?.checklist
        await enqueue({
          key: `checklist:${id}`,
          method: 'PUT',
          url,
          body,
          creates: !known?.some((item) => item.id === id),
        })
        const now = new Date().toISOString()
        return { ...body, id, trip_id: tripId, created_at: now, updated_at: now } as ChecklistItem
      }
    },
    onMutate: async ({ id, ...body }) => {
      // Stop an in-flight bundle refresh from landing on top of the tick.
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      const existing = previous?.checklist.find((item) => item.id === id)
      const now = new Date().toISOString()
      const optimistic = {
        ...body,
        id,
        trip_id: tripId,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      } as ChecklistItem
      patchChecklist(queryClient, tripId, (items) => [
        ...items.filter((item) => item.id !== id),
        optimistic,
      ])
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
    // What the server stored replaces the guess, but no invalidate:
    // refetching the whole bundle on every tap would make a list of thirty
    // items unusable on a slow connection. The next sync reconciles it.
    onSuccess: (item) =>
      patchChecklist(queryClient, tripId, (items) => [
        ...items.filter((entry) => entry.id !== item.id),
        item,
      ]),
  })
}

export function useDeleteChecklistItem(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string, { previous: TripBundle | undefined }>({
    mutationFn: async (itemId) => {
      const url = `/api/trips/${tripId}/checklist/${itemId}`
      try {
        await apiFetch<void>(url, { method: 'DELETE' })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        await enqueue({ key: `checklist:${itemId}`, method: 'DELETE', url })
      }
    },
    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchChecklist(queryClient, tripId, (items) =>
        items.filter((item) => item.id !== itemId),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

// --- Memory points ---

/**
 * Write one point, at an id derived from the photograph.
 *
 * Queued when there is no signal, like everything else addressed by a
 * client-chosen id. Importing a folder writes one of these per photo, so
 * the queue may take a few hundred at once — which is fine, they are a
 * hundred bytes each and replaying them is a no-op.
 */
export function usePutMemory(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Memory, ApiError, MemoryWrite & { id: string }>({
    mutationFn: async ({ id, ...body }) => {
      const url = `/api/trips/${tripId}/memories/${id}`
      try {
        return await apiFetch<Memory>(url, { method: 'PUT', body })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        // `creates` when the server has never seen this row: deleting it
        // while still offline then cancels both writes, instead of asking
        // the server to remove something it was never told about.
        const known = snapshotBundle(queryClient, tripId)?.memories
        await enqueue({
          key: `memory:${id}`,
          method: 'PUT',
          url,
          body,
          creates: !known?.some((item) => item.id === id),
        })
        const now = new Date().toISOString()
        return {
          ...body,
          id,
          trip_id: tripId,
          filename: body.filename ?? null,
          caption: body.caption ?? null,
          created_at: now,
          updated_at: now,
        } as Memory
      }
    },
    onSuccess: (memory) =>
      queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
        bundle
          ? {
              ...bundle,
              memories: [...bundle.memories.filter((item) => item.id !== memory.id), memory],
            }
          : bundle,
      ),
  })
}

export function useDeleteMemory(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: async (memoryId) => {
      const url = `/api/trips/${tripId}/memories/${memoryId}`
      try {
        await apiFetch<void>(url, { method: 'DELETE' })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        await enqueue({ key: `memory:${memoryId}`, method: 'DELETE', url })
      }
    },
    onSuccess: (_result, memoryId) =>
      queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
        bundle
          ? { ...bundle, memories: bundle.memories.filter((item) => item.id !== memoryId) }
          : bundle,
      ),
  })
}

// --- Travel diary ---

function patchDiary(
  queryClient: QueryClient,
  tripId: string,
  change: (entries: DiaryEntry[]) => DiaryEntry[],
) {
  queryClient.setQueryData<TripBundle>(keys.bundle(tripId), (bundle) =>
    bundle ? { ...bundle, diary: change(bundle.diary) } : bundle,
  )
}

/**
 * Write the entry for a day.
 *
 * Queued when there is no signal, like an expense and for a stronger
 * reason: this is written at the end of a day in a hotel room, and the
 * text is the one thing in the app you would be sorry to lose. Addressed
 * by date, so replaying the write leaves one entry rather than two.
 */
export function usePutDiaryEntry(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<DiaryEntry, ApiError, { day: string; text: string }>({
    mutationFn: async ({ day, text }) => {
      const url = `/api/trips/${tripId}/diary/${day}`
      try {
        return await apiFetch<DiaryEntry>(url, { method: 'PUT', body: { text } })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        const known = snapshotBundle(queryClient, tripId)?.diary
        await enqueue({
          key: `diary:${day}`,
          method: 'PUT',
          url,
          body: { text },
          creates: !known?.some((entry) => entry.day === day),
        })
        const now = new Date().toISOString()
        // A stand-in so the page shows what you just wrote. The id is
        // provisional and is replaced by the server's on the next sync.
        return {
          id: `pending:${day}`,
          trip_id: tripId,
          day,
          text,
          created_at: now,
          updated_at: now,
        } as DiaryEntry
      }
    },
    onSuccess: (entry) =>
      patchDiary(queryClient, tripId, (entries) => [
        ...entries.filter((existing) => existing.day !== entry.day),
        entry,
      ]),
  })
}

export function useDeleteDiaryEntry(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: async (day) => {
      const url = `/api/trips/${tripId}/diary/${day}`
      try {
        await apiFetch<void>(url, { method: 'DELETE' })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        await enqueue({ key: `diary:${day}`, method: 'DELETE', url })
      }
    },
    onSuccess: (_result, day) =>
      patchDiary(queryClient, tripId, (entries) =>
        entries.filter((entry) => entry.day !== day),
      ),
  })
}

// --- Day notes ---

/**
 * The note for a day, queued when there is no network.
 *
 * PUT addressed by date: there is at most one note per day, so the client
 * already knows the address and repeating the call is harmless. That was
 * true from the start and the queue simply was not wired to it — which
 * meant "chiuso il lunedì", written on a train, was lost.
 */
export function useSetDayNote(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    DayNote,
    ApiError,
    { day: string; note: string },
    { previous: TripBundle | undefined }
  >({
    mutationFn: async ({ day, note }) => {
      const url = `/api/trips/${tripId}/days/${day}/note`
      try {
        return await apiFetch<DayNote>(url, { method: 'PUT', body: { note } })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        const known = snapshotBundle(queryClient, tripId)?.day_notes
        await enqueue({
          key: `day-note:${day}`,
          method: 'PUT',
          url,
          body: { note },
          creates: !known?.some((entry) => entry.day === day),
        })
        const now = new Date().toISOString()
        return { id: day, trip_id: tripId, day, note, created_at: now, updated_at: now } as DayNote
      }
    },
    onMutate: async ({ day, note }) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      const now = new Date().toISOString()
      patchDayNotes(queryClient, tripId, (notes) => [
        ...notes.filter((entry) => entry.day !== day),
        { id: day, trip_id: tripId, day, note, created_at: now, updated_at: now } as DayNote,
      ])
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

export function useClearDayNote(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string, { previous: TripBundle | undefined }>({
    mutationFn: async (day) => {
      const url = `/api/trips/${tripId}/days/${day}/note`
      try {
        await apiFetch<void>(url, { method: 'DELETE' })
      } catch (error) {
        if (!shouldKeep(error)) throw error
        await enqueue({ key: `day-note:${day}`, method: 'DELETE', url })
      }
    },
    onMutate: async (day) => {
      await queryClient.cancelQueries({ queryKey: keys.bundle(tripId) })
      const previous = snapshotBundle(queryClient, tripId)
      patchDayNotes(queryClient, tripId, (notes) => notes.filter((entry) => entry.day !== day))
      return { previous }
    },
    onError: (_error, _vars, context) => restore(queryClient, tripId, context?.previous),
  })
}

// --- Attachments ---

export interface UploadVars {
  file: File
  kind?: Attachment['kind']
  bookingId?: string
  stopId?: string
}

/**
 * Put a document on the trip, queueing the file itself when offline.
 *
 * Still a POST, and still safe to replay: the server stores a document
 * under the hash of its bytes and hands back the one it already has
 * rather than making a second copy — which it did long before there was
 * a queue, because tapping "upload" twice on a slow connection is the
 * ordinary case.
 *
 * What had to change is the queue, not the route. A `FormData` cannot be
 * put in IndexedDB, so the file and the fields are stored apart and the
 * multipart body is rebuilt at the moment of sending. A `File` survives
 * both the storing and the app being closed, so a voucher photographed
 * in a hotel with no wifi is still there in the morning.
 */
export function useUploadAttachment(tripId: string) {
  const queryClient = useQueryClient()
  return useMutation<Attachment, ApiError, UploadVars, Rollback>({
    mutationFn: ({ file, kind, bookingId, stopId }) => {
      const fields: Record<string, string> = {}
      if (kind) fields.kind = kind
      if (bookingId) fields.booking_id = bookingId
      if (stopId) fields.stop_id = stopId
      return sendOrQueue<Attachment>(
        {
          // Never folded onto another upload: two documents are two
          // documents, even for the same booking.
          key: `attachment:${crypto.randomUUID()}`,
          method: 'POST',
          url: `/api/trips/${tripId}/attachments`,
          form: { file, fields },
        },
        () => {
          // Drawn only when the write was queued. Online the row comes
          // from the server, with the id and the type it decided on.
          const waiting = waitingAttachment(tripId, file, fields)
          patchAttachments(queryClient, tripId, (all) => [...all, waiting])
          return waiting
        },
      )
    },
    onSuccess: async () => {
      // The stand-in carries an id no server will ever agree with, so the
      // list has to be re-read rather than patched. Offline this simply
      // fails and leaves the stand-in in place, which is correct.
      await queryClient.invalidateQueries({ queryKey: keys.bundle(tripId) })
    },
  })
}


export function useDeleteAttachment(tripId: string) {
  return useTripMutation(tripId, (attachmentId: string) =>
    apiFetch<void>(`/api/trips/${tripId}/attachments/${attachmentId}`, { method: 'DELETE' }),
  )
}

export function attachmentUrl(tripId: string, attachmentId: string): string {
  return `/api/trips/${tripId}/attachments/${attachmentId}/file`
}
