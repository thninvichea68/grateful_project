import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { rowSpans, useOverviewWidgets, WIDGETS } from './widgets';

beforeEach(() => localStorage.clear());

describe('Overview widgets', () => {
  it('shows key figures, summary, breakdown, ports and live tracking as it comes', () => {
    const shown = (canProfit: boolean) => {
      const w = renderHook(() => useOverviewWidgets('u1', canProfit)).result.current;
      return WIDGETS.filter((d) => w.shown(d.id)).map((d) => d.id);
    };
    const defaults = ['kpis', 'shipments', 'accounts', 'ports', 'live'];
    expect(shown(true)).toEqual(defaults);
    expect(shown(false)).toEqual(defaults);
  });

  it('remembers a removed or added widget per user, and resets', () => {
    const { result } = renderHook(() => useOverviewWidgets('u1', true));
    act(() => result.current.toggle('ports'));
    act(() => result.current.toggle('map'));
    expect([result.current.shown('ports'), result.current.shown('map')]).toEqual([false, true]);
    expect(result.current.customized).toBe(true);

    const again = renderHook(() => useOverviewWidgets('u1', true)).result.current;
    expect([again.shown('ports'), again.shown('map')]).toEqual([false, true]);
    expect(renderHook(() => useOverviewWidgets('u3', true)).result.current.shown('ports')).toBe(
      true,
    );

    act(() => result.current.reset());
    expect([result.current.shown('ports'), result.current.shown('map')]).toEqual([true, false]);
    expect(result.current.customized).toBe(false);
  });

  it('turns profit on for accounting, and back off without storing the default', () => {
    const { result } = renderHook(() => useOverviewWidgets('u1', true));
    act(() => result.current.toggle('profit'));
    expect(result.current.shown('profit')).toBe(true);
    act(() => result.current.toggle('profit'));
    expect(result.current.shown('profit')).toBe(false);
    expect(result.current.customized).toBe(false);
  });

  it('never shows profit without accounting access, even if stored', () => {
    localStorage.setItem('gs:overview-widgets:u1', JSON.stringify({ profit: true }));
    expect(renderHook(() => useOverviewWidgets('u1', false)).result.current.shown('profit')).toBe(
      false,
    );
  });
});

describe('rowSpans', () => {
  it('widens the cards on a part-filled row so it ends flush', () => {
    // Clients, map, breakdown (wide) | ports, forwarders
    expect(rowSpans([1, 1, 2, 1, 1], 4)).toEqual([1, 1, 2, 2, 2]);
    // Summary (wide), breakdown (wide) | ports alone takes the whole row
    expect(rowSpans([2, 2, 1], 4)).toEqual([2, 2, 4]);
    expect(rowSpans([1, 1, 1], 4)).toEqual([1, 1, 2]);
    expect(rowSpans([1, 1, 1, 1, 1], 2)).toEqual([1, 1, 1, 1, 2]);
  });
});
