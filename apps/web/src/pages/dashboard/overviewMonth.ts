import { useSearchParams } from 'react-router-dom';

/** This month as YYYY-MM on the viewer's clock. */
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * The Overview's month, kept in the address (?month=YYYY-MM) so a refresh or a shared link
 * shows the same month. `month` is undefined for the live (current) month.
 */
export function useOverviewMonth() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month') ?? '';
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < currentMonth();
  const month = valid ? asked : undefined;
  const setMonth = (m: string | undefined) => {
    const next = new URLSearchParams(params);
    if (m && m < currentMonth()) next.set('month', m);
    else next.delete('month');
    setParams(next, { replace: true });
  };
  return { month, setMonth };
}
