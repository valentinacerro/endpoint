import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, apiFetch } from './client'

export interface SessionOut {
  authenticated: boolean
}

export const sessionKey = ['session'] as const

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: () => apiFetch<SessionOut>('/api/auth/me'),
    // A 401 is a legitimate answer ("you are not signed in"), not a fault to
    // retry. Every other failure mode is already handled inside apiFetch.
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation<SessionOut, ApiError, string>({
    mutationFn: (password) =>
      apiFetch<SessionOut>('/api/auth/login', { method: 'POST', body: { password } }),
    onSuccess: (data) => queryClient.setQueryData(sessionKey, data),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<SessionOut>('/api/auth/logout', { method: 'POST' }),
    onSuccess: async () => {
      // Cached data belongs to the session that just ended: it goes with it,
      // including the copy in IndexedDB.
      queryClient.setQueryData(sessionKey, { authenticated: false })
      await queryClient.invalidateQueries()
      queryClient.clear()
    },
  })
}
