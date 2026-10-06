import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClientDetail,
  ClientInput,
  ClientListItem,
  CutStockImportResult,
  CutStockItemInput,
  CutStockMovement,
  CutStockRow,
  CutStockSummary,
  LookupsResponse,
  Paginated,
  ShipmentDetail,
  ShipmentInput,
  ShipmentListItem,
} from '@gs/shared';
import { api } from '../lib/api';
import { uploadFile } from '../lib/files';
import { queryKeys } from '../lib/queryKeys';

type Query = Record<
  string,
  string | number | boolean | undefined | null | readonly (string | number)[]
>;

/* ---------- Lookups (dropdowns) ---------- */
export function useLookups() {
  return useQuery({
    queryKey: queryKeys.lookups,
    queryFn: () => api<LookupsResponse>('/lookups'),
    staleTime: 5 * 60_000,
  });
}

export function useAddConsignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; clientId?: string | null; countryIso2?: string | null }) =>
      api<{ id: string; name: string }>('/lookups/consignees', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lookups }),
  });
}

export function useAddForwarder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api<{ id: string; name: string }>('/lookups/forwarders', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lookups }),
  });
}

/* ---------- Clients ---------- */
export function useClients(query: Query) {
  return useQuery({
    queryKey: [...queryKeys.clients, 'list', query],
    queryFn: () => api<Paginated<ClientListItem>>('/clients', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: queryKeys.client(id),
    queryFn: () => api<ClientDetail>(`/clients/${id}`),
  });
}

export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<ClientInput> }) =>
      id
        ? api<{ id: string }>(`/clients/${id}`, { method: 'PATCH', json: body })
        : api<{ id: string }>('/clients', { method: 'POST', json: body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.clients }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.clients }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

/* ---------- Shipments ---------- */
export function useShipments(query: Query) {
  return useQuery({
    queryKey: [...queryKeys.shipments, 'list', query],
    queryFn: () => api<Paginated<ShipmentListItem>>('/shipments', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.shipment(id ?? 'new'),
    queryFn: () => api<ShipmentDetail>(`/shipments/${id}`),
    enabled: !!id,
  });
}

/** Everything that shows shipment-derived numbers must refetch after a write. */
function invalidateShipmentData(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    [
      queryKeys.shipments,
      queryKeys.clients,
      queryKeys.cutStock,
      queryKeys.analytics,
      queryKeys.overview,
      queryKeys.navCounts,
    ].map((k) => qc.invalidateQueries({ queryKey: k })),
  );
}

export function useSaveShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ShipmentInput }) =>
      id
        ? api<ShipmentDetail>(`/shipments/${id}`, { method: 'PUT', json: body })
        : api<ShipmentDetail>('/shipments', { method: 'POST', json: body }),
    onSuccess: () => invalidateShipmentData(qc),
  });
}

export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/shipments/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateShipmentData(qc),
  });
}

/* ---------- Cut stock ---------- */
export type CutStockList = Paginated<CutStockRow> & { summary: CutStockSummary };

export function useCutStock(query: Query & { clientId?: string }, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.cutStock, 'list', query],
    queryFn: () => api<CutStockList>('/cut-stock', { query }),
    enabled: enabled && !!query.clientId,
    placeholderData: keepPreviousData,
  });
}

export function useCutStockItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.cutStockItem(id ?? 'none'),
    queryFn: () =>
      api<CutStockRow & { movements: CutStockMovement[]; openingImportedQty: string }>(
        `/cut-stock/${id}`,
      ),
    enabled: !!id,
  });
}

export function useSaveCutStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CutStockItemInput> }) =>
      id
        ? api<CutStockRow>(`/cut-stock/${id}`, { method: 'PATCH', json: body })
        : api<CutStockRow>('/cut-stock', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}

export function useDeleteCutStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/cut-stock/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}

export function useImportMasterList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      file,
      dryRun,
      updateOpening,
    }: {
      clientId: string;
      file: File;
      dryRun: boolean;
      updateOpening: boolean;
    }) =>
      uploadFile<CutStockImportResult>('/cut-stock/import', file, {
        clientId,
        dryRun: String(dryRun),
        updateOpening: String(updateOpening),
      }),
    onSuccess: (r) =>
      r.dryRun ? undefined : qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}
