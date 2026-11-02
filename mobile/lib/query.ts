import { MutationCache, QueryClient } from '@tanstack/react-query';

import { tellFailure } from '@/lib/confirm';

// A mutation with this meta has no message of its own on screen, so failing must still say so.
export const REPORT_FAILURE = { reportFailure: true };

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  mutationCache: new MutationCache({
    onError: (_error, _variables, _context, mutation) => {
      if (mutation.meta?.reportFailure) tellFailure();
    },
  }),
});
