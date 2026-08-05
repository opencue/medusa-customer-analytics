import { type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Medusa Admin v2 instantiates its own QueryClient internally but does NOT
// expose it via context to extension widgets / routes. Hooks like useQuery
// imported from @tanstack/react-query therefore throw "No QueryClient set,
// use QueryClientProvider to set one" the moment they run.
//
// The fix is to provide our own client for the extension subtree. One shared
// instance across the admin keeps cache coherent between widgets that touch
// the same resource (e.g. the customer-notes widget and any customer-list
// widget) and avoids re-fetching when the operator navigates between pages.
const adminQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export const AdminQueryProvider = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={adminQueryClient}>{children}</QueryClientProvider>
)
