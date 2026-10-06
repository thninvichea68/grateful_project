import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingDoc,
  BillingDocListItem,
  BillingDocType,
  DeclarationOption,
  LedgerEntryInput,
  LedgerRow,
  LedgerSummary,
  Paginated,
} from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

const KEY = ['accounting'] as const;
type Query = Record<string, string | number | undefined>;

/** Ledger changes move net profit on the dashboards, so refresh those too. */
function useInvalidateAccounting() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [KEY, queryKeys.analytics, queryKeys.overview, queryKeys.clients].map((k) =>
        qc.invalidateQueries({ queryKey: k }),
      ),
    );
}

export function useLedger(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'ledger', q],
    queryFn: () =>
      api<Paginated<LedgerRow> & { totals: LedgerSummary }>('/accounting/ledger', { query: q }),
    placeholderData: keepPreviousData,
  });
}

export function useLedgerRow(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'ledger-row', id],
    queryFn: () => api<LedgerRow>(`/accounting/ledger/${id}`),
    enabled: !!id,
  });
}

export function useDeclarationOptions(q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'decl-options', q],
    queryFn: () =>
      api<DeclarationOption[]>('/accounting/declarations', { query: { q: q || undefined } }),
    enabled,
  });
}

export function useSaveLedger() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<LedgerEntryInput> }) =>
      id
        ? api<LedgerRow>(`/accounting/ledger/${id}`, { method: 'PATCH', json: body })
        : api<LedgerRow>('/accounting/ledger', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });
}

export function useDeleteLedger() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/accounting/ledger/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDocs(type: BillingDocType, q: Query) {
  return useQuery({
    queryKey: [...KEY, 'docs', type, q],
    queryFn: () => api<Paginated<BillingDocListItem>>(`/accounting/docs/${type}`, { query: q }),
    placeholderData: keepPreviousData,
  });
}

export function useDoc(type: BillingDocType, id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'doc', type, id],
    queryFn: () => api<BillingDoc>(`/accounting/docs/${type}/${id}`),
    enabled: !!id,
  });
}

export function usePrefill(type: BillingDocType, recordId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'prefill', type, recordId],
    queryFn: () =>
      api<Record<string, unknown>>(`/accounting/docs/${type}/prefill`, {
        query: { recordId: recordId! },
      }),
    enabled: !!recordId,
    staleTime: Infinity,
  });
}

export function useDocAction(type: BillingDocType) {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id?: string;
      action: 'create' | 'update' | 'issue' | 'void' | 'delete';
      body?: unknown;
    }) => {
      const base = `/accounting/docs/${type}`;
      switch (action) {
        case 'create':
          return api<BillingDoc>(base, { method: 'POST', json: body });
        case 'update':
          return api<BillingDoc>(`${base}/${id}`, { method: 'PUT', json: body });
        case 'issue':
          return api<BillingDoc>(`${base}/${id}/issue`, { method: 'POST' });
        case 'void':
          return api<BillingDoc>(`${base}/${id}/void`, { method: 'POST', json: body });
        case 'delete':
          return api<undefined>(`${base}/${id}`, { method: 'DELETE' });
      }
    },
    onSuccess: invalidate,
  });
}

export interface CompanyInfo {
  nameEn?: string;
  nameKm?: string;
  vattin?: string;
  addressEn?: string;
  addressKm?: string;
  phone?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
}
export function useCompany() {
  return useQuery({
    queryKey: ['meta', 'company'],
    queryFn: () => api<CompanyInfo>('/meta/company'),
    staleTime: 10 * 60_000,
  });
}
