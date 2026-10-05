/**
 * Central TanStack Query keys. Mutations invalidate by prefix, e.g. creating a
 * shipment invalidates ['shipments'], ['analytics'] and ['overview'] so every chart refetches.
 */
export const queryKeys = {
  navCounts: ['meta', 'nav-counts'] as const,
};
