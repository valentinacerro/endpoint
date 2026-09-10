/**
 * Queries and mutations for a trip and everything under it.
 *
 * Reads go through the bundle: one request holds the whole trip, every
 * screen selects its slice from that single cache entry. That is what makes
 * the app work offline after one successful sync, with no per-screen offline
 * handling anywhere.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, apiFetch } from './client'
import type {
  Attachment,
  Booking,
  BookingCreate,
  BookingUpdate,
  Place,
  PlaceCreate,
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

export function useDeletePlace(tripId: string) {
  return useTripMutation(tripId, (placeId: string) =>
    apiFetch<void>(`/api/trips/${tripId}/places/${placeId}`, { method: 'DELETE' }),
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
