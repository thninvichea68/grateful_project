import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PayrollMonthDetail,
  PayrollMonthInput,
  PayrollMonthRow,
  ProductionProfile,
  ProductionProfileInput,
  ProductionReportData,
} from '@gs/shared';
import { api } from '../lib/api';

/** Reports → Payroll → Capacity report: the month's exports by product line and the setup. */
export const useProductionReport = (clientId: string | undefined, month: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'production', clientId, month],
    queryFn: () => api<ProductionReportData>('/reports/production', { query: { clientId, month } }),
    enabled: !!clientId && !!month,
  });

export function useSaveProductionProfile(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: ProductionProfileInput) =>
      api<ProductionProfile>(`/reports/production/profile/${clientId}`, {
        method: 'PUT',
        json: profile,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'production', clientId] }),
  });
}

/** Reports → Payroll: the saved months, newest first. */
export const usePayrollMonths = () =>
  useQuery({
    queryKey: ['reports', 'payroll'],
    queryFn: () => api<PayrollMonthRow[]>('/reports/payroll'),
  });

/** One saved month with its staff rows. */
export const usePayrollMonth = (id: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'payroll', id],
    queryFn: () => api<PayrollMonthDetail>(`/reports/payroll/${id}`),
    enabled: !!id,
  });

export function useSavePayrollMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayrollMonthInput) =>
      api<PayrollMonthDetail>('/reports/payroll', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'payroll'] }),
  });
}

export function useDeletePayrollMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/reports/payroll/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'payroll'] }),
  });
}
