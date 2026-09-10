/**
 * Queries and mutations for a trip and everything under it.
 *
 * Reads go through the bundle: one request holds the whole trip, every
 * screen selects its slice from that single cache entry. That is what makes
 * the app work offline after one successful sync, with no per-screen offline
 * handling anywhere.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { enqueue } from '../offline/outbox'
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
  Expense,
  ExpenseWrite,
  Place,
  PlaceCreate,
  PlaceUpdate,
  Stop,
  StopCreate,
  StopUpdate,
  Trip,
  TripBundle,
  TripCreate,
  TripUpdate,
} from './types'

export const keys = {
  trips: ['trips'] as const,
  bundle: (tripId: string) => ['trip', tripId, 'bundle'] as const,
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

export function useCreateTrip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TripCreate) => apiFetch<Trip>('/api/trips', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.trips }),
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

export function useCreateStop(tripId: string) {
  return useTripMutation(tripId, (body: StopCreate) =>
    apiFetch<Stop>(`/api/trips/${tripId}/stops`, { method: 'POST', body }),
  )
}

export function useUpdateStop(tripId: string) {
  return useTripMutation(tripId, ({ id, ...body }: StopUpdate & { id: string }) =>
    apiFetch<Stop>(`/api/trips/${tripId}/stops/${id}`, { method: 'PATCH', body }),
  )
}

export function useDeleteStop(tripId: string) {
  return useTripMutation(tripId, (stopId: string) =>
    apiFetch<void>(`/api/trips/${tripId}/stops/${stopId}`, { method: 'DELETE' }),
  )
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

export function useCreateBooking(tripId: string) {
  return useTripMutation(tripId, (body: BookingCreate) =>
    apiFetch<Booking>(`/api/trips/${tripId}/bookings`, { method: 'POST', body }),
  )
}

export function useUpdateBooking(tripId: string) {
  return useTripMutation(tripId, ({ id, ...body }: BookingUpdate & { id: string }) =>
    apiFetch<Booking>(`/api/trips/${tripId}/bookings/${id}`, { method: 'PATCH', body }),
  )
}

export function useDeleteBooking(tripId: string) {
  return useTripMutation(tripId, (bookingId: string) =>
    apiFetch<void>(`/api/trips/${tripId}/bookings/${bookingId}`, { method: 'DELETE' }),
  )
}

// --- Places ---

export function useCreatePlace(tripId: string) {
  return useTripMutation(tripId, (body: PlaceCreate) =>
    apiFetch<Place>(`/api/trips/${tripId}/places`, { method: 'POST', body }),
  )
}

export function useUpdatePlace(tripId: string) {
  return useTripMutation(tripId, ({ id, ...body }: PlaceUpdate & { id: string }) =>
    apiFetch<Place>(`/api/trips/${tripId}/places/${id}`, { method: 'PATCH', body }),
  )
}

export function useDeletePlace(tripId: string) {
  return useTripMutation(tripId, (placeId: string) =>
    apiFetch<void>(`/api/trips/${tripId}/places/${placeId}`, { method: 'DELETE' }),
  )
}

// --- Google Maps links ---

export interface ResolvedPlace {
  name: string | null
  lat: number | null
  lon: number | null
  url: string
}

/**
 * Ask the server to read a Google Maps link.
 *
 * It has to be the server: a shared link is a `maps.app.goo.gl` redirect,
 * and the browser cannot follow one cross-origin to see where it lands.
 */
export function useResolveMapsLink() {
  return useMutation<ResolvedPlace, ApiError, string>({
    mutationFn: (url) => apiFetch<ResolvedPlace>('/api/maps/resolve', { method: 'POST', body: { url } }),
  })
}

export interface ImportSummary {
  created: number
  with_position: number
  without_position: number
  skipped: number
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
        await enqueue({ key: `expense:${id}`, method: 'PUT', url, body })
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
        await enqueue({ key: `checklist:${id}`, method: 'PUT', url, body })
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

// --- Day notes ---

export function useSetDayNote(tripId: string) {
  return useTripMutation(tripId, ({ day, note }: { day: string; note: string }) =>
    // PUT addressed by date: there is at most one note per day, so the
    // client already knows the address and repeating the call is harmless.
    apiFetch<DayNote>(`/api/trips/${tripId}/days/${day}/note`, {
      method: 'PUT',
      body: { note },
    }),
  )
}

export function useClearDayNote(tripId: string) {
  return useTripMutation(tripId, (day: string) =>
    apiFetch<void>(`/api/trips/${tripId}/days/${day}/note`, { method: 'DELETE' }),
  )
}

// --- Attachments ---

export interface UploadVars {
  file: File
  kind?: Attachment['kind']
  bookingId?: string
  stopId?: string
}

export function useUploadAttachment(tripId: string) {
  return useTripMutation(tripId, async ({ file, kind, bookingId, stopId }: UploadVars) => {
    const form = new FormData()
    form.append('file', file)
    if (kind) form.append('kind', kind)
    if (bookingId) form.append('booking_id', bookingId)
    if (stopId) form.append('stop_id', stopId)
    // No Content-Type header: the browser has to set the multipart boundary
    // itself, and overriding it makes the request unparseable.
    return apiFetch<Attachment>(`/api/trips/${tripId}/attachments`, {
      method: 'POST',
      body: form,
    })
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
