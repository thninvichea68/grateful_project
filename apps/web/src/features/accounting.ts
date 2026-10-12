import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingDoc,
  BillingDocListItem,
  BillingDocType,
  CreditNoteMessage,
  CreditNoteReviewCounts,
  CreditNoteReviewRow,
  CreditNoteReviewStatus,
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

/** A ready-to-edit draft from a ledger row (or, for credit notes, from a declaration). */
export function usePrefill(
  type: BillingDocType,
  recordId: string | null,
  declarationId: string | null = null,
) {
  return useQuery({
    queryKey: [...KEY, 'prefill', type, recordId, declarationId],
    queryFn: () =>
      api<Record<string, unknown>>(`/accounting/docs/${type}/prefill`, {
        query: declarationId ? { declarationId } : { recordId: recordId! },
      }),
    enabled: !!recordId || !!declarationId,
    staleTime: Infinity,
  });
}

export type CreditNoteDeclaration = DeclarationOption & { creditNoteNo: string | null };

/** Declarations a new Credit Noted can start from (with or without a ledger row). */
export function useCreditNoteDeclarations(q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'cn-declarations', q],
    queryFn: () =>
      api<CreditNoteDeclaration[]>('/accounting/credit-notes/declarations', {
        query: { q: q || undefined },
      }),
    enabled,
  });
}

/** Accounting → Credit Noted: submitted notes with Checked / Unchecked / Revised counts. */
export function useCreditNoteReview(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'cn-review', q],
    queryFn: () =>
      api<Paginated<CreditNoteReviewRow> & { counts: CreditNoteReviewCounts }>(
        '/accounting/credit-notes/review',
        { query: q },
      ),
    placeholderData: keepPreviousData,
  });
}

/** Sidebar → Credit Noted: every credit note (drafts too) with shipment details. */
export function useCreditNoteList(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'cn-list', q],
    queryFn: () =>
      api<Paginated<CreditNoteReviewRow>>('/accounting/credit-notes/list', { query: q }),
    placeholderData: keepPreviousData,
  });
}

/** Accounting's check; "Revised" sends the note back to the broker with a message. */
export function useSetCreditNoteReview() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({
      id,
      reviewStatus,
      message,
    }: {
      id: string;
      reviewStatus: CreditNoteReviewStatus;
      message?: string;
    }) =>
      api<undefined>(`/accounting/docs/credit-notes/${id}/review`, {
        method: 'PATCH',
        json: { reviewStatus, message },
      }),
    // Revising takes the fee out of the ledger, so refresh everything accounting shows.
    onSuccess: invalidate,
  });
}

/** My Credit Noted inbox (messages from accounting). */
export function useCreditNoteInbox(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'cn-inbox'],
    queryFn: () =>
      api<{ data: CreditNoteMessage[]; unread: number }>('/accounting/credit-notes/inbox'),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMarkInboxRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId?: string) =>
      api<undefined>('/accounting/credit-notes/inbox/read', {
        method: 'POST',
        json: { messageId },
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, 'cn-inbox'] }),
        qc.invalidateQueries({ queryKey: queryKeys.navCounts }),
      ]),
  });
}

/** Accounting's messages about one credit note, newest first. */
export function useCreditNoteMessages(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'cn-messages', id],
    queryFn: () => api<CreditNoteMessage[]>(`/accounting/docs/credit-notes/${id}/messages`),
    enabled: !!id,
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
