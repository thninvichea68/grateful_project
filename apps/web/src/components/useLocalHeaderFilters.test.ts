import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLocalHeaderFilters, type LocalColumn } from './useLocalHeaderFilters';

interface Row {
  client: string;
  size: string | null;
  qty: number;
}
const ROWS: Row[] = [
  { client: 'JR', size: '40HC', qty: 9 },
  { client: 'JYX', size: null, qty: 100 },
  { client: 'JR', size: '20GP', qty: 20 },
];
const COLS: LocalColumn<Row>[] = [
  { key: 'client', label: 'Client', value: (r) => r.client },
  { key: 'size', label: 'Size', value: (r) => r.size },
  { key: 'qty', label: 'Qty', kind: 'number', value: (r) => String(r.qty) },
];
const run = (query: Record<string, string>) => {
  const { result } = renderHook(() =>
    useLocalHeaderFilters(ROWS, COLS, new URLSearchParams(query), () => {}),
  );
  return result.current;
};

describe('useLocalHeaderFilters', () => {
  it('keeps the rows whose cells are ticked, blanks as ""', () => {
    expect(run({ f: JSON.stringify({ size: ['', '20GP'] }) }).rows.map((r) => r.qty)).toEqual([
      100, 20,
    ]);
    expect(run({}).active).toBe(false);
    expect(run({ f: JSON.stringify({ client: ['JR'] }) }).active).toBe(true);
  });

  it('sorts numbers as numbers, either way', () => {
    expect(run({ sort: 'qty' }).rows.map((r) => r.qty)).toEqual([9, 20, 100]);
    expect(run({ sort: '-qty' }).rows.map((r) => r.qty)).toEqual([100, 20, 9]);
  });

  it('keeps blank cells last whichever way a column sorts', () => {
    expect(run({ sort: '-size' }).rows.map((r) => r.size)).toEqual(['40HC', '20GP', null]);
  });

  it('applies every column filter together', () => {
    const f = JSON.stringify({ client: ['JR'], size: ['40HC', ''] });
    expect(run({ f }).rows.map((r) => r.qty)).toEqual([9]);
  });
});
