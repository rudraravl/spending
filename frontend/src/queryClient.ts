import { QueryClient } from '@tanstack/react-query'

// Keep server-ish state fresh long enough to avoid “refetch on every click”
// while still updating after mutations via query invalidation.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export default queryClient

