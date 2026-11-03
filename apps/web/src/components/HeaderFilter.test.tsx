import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderFilter, type SortDir } from './HeaderFilter';

/** A header with its values loaded, open/closed as the list page keeps it. */
function Harness({
  selected,
  onApply,
  onSort = () => {},
}: {
  selected?: string[];
  onApply: (kept: string[] | undefined) => void;
  onSort?: (d: SortDir) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HeaderFilter
      label="Freight"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      values={['AIR', 'SEA', 'ROAD', '']}
      loading={false}
      selected={selected}
      sort={undefined}
      format={(v) => (v === 'ROAD' ? 'TRUCK' : v)}
      onApply={onApply}
      onSort={onSort}
    />
  );
}

describe('HeaderFilter', () => {
  it('keeps the ticked values; all of them clears the filter', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /freight/i }));
    // Shown with the column's labels; blanks as (Blanks).
    expect(screen.getByLabelText('TRUCK')).toBeChecked();
    expect(screen.getByLabelText('(Blanks)')).toBeChecked();
    await userEvent.click(screen.getByLabelText('SEA'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith(['AIR', 'ROAD', '']);

    await userEvent.click(screen.getByRole('button', { name: /freight/i }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith(undefined);
  });

  it('opens with the current filter ticked; OK is off with nothing ticked', async () => {
    const onApply = vi.fn();
    render(<Harness selected={['AIR']} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /freight/i }));
    expect(screen.getByLabelText('AIR')).toBeChecked();
    expect(screen.getByLabelText('SEA')).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('(Select All)'));
    await userEvent.click(screen.getByLabelText('(Select All)'));
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('searching keeps only the ticked values found, as Excel', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /freight/i }));
    // Searched on the labels shown: "r" finds AIR and TRUCK (ROAD), not SEA or (Blanks).
    await userEvent.type(screen.getByRole('searchbox'), 'r');
    expect(screen.queryByLabelText('SEA')).toBeNull();
    await userEvent.click(screen.getByLabelText('TRUCK'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith(['AIR']);
  });

  it('sorts and closes', async () => {
    const onSort = vi.fn();
    render(<Harness onApply={() => {}} onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: /freight/i }));
    await userEvent.click(screen.getByRole('button', { name: /sort z to a/i }));
    expect(onSort).toHaveBeenCalledWith('desc');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
