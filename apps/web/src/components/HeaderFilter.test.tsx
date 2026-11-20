import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderFilter, type SortDir } from './HeaderFilter';

/** A header with its values loaded, open/closed and filtered as the list page keeps it. */
function Harness({
  onApply,
  onSort = () => {},
  sort,
}: {
  onApply: (kept: string[] | undefined) => void;
  onSort?: (d: SortDir) => void;
  sort?: SortDir;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[] | undefined>();
  return (
    <HeaderFilter
      label="Freight"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      values={['AIR', 'SEA', 'ROAD', '']}
      loading={false}
      selected={selected}
      sort={sort}
      format={(v) => (v === 'ROAD' ? 'TRUCK' : v)}
      onApply={(kept) => {
        setSelected(kept);
        onApply(kept);
      }}
      onSort={onSort}
    />
  );
}

const wait = () => act(() => new Promise((r) => setTimeout(r, 300)));

describe('HeaderFilter', () => {
  it('the arrow in the box sorts: A to Z, then Z to A', async () => {
    const onSort = vi.fn();
    const { rerender } = render(<Harness onApply={() => {}} onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Freight' }));
    expect(onSort).toHaveBeenLastCalledWith('asc');
    rerender(<Harness onApply={() => {}} onSort={onSort} sort="asc" />);
    await userEvent.click(screen.getByRole('button', { name: 'Freight: sorted A to Z' }));
    expect(onSort).toHaveBeenLastCalledWith('desc');
  });

  it('the header is the search box: typing filters, on the labels shown', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    const box = screen.getByRole('textbox', { name: 'Search Freight' });
    expect(box).toHaveAttribute('placeholder', 'Freight');
    // "r" finds AIR and TRUCK (ROAD), not SEA or blanks.
    await userEvent.type(box, 'r');
    await wait();
    expect(onApply).toHaveBeenLastCalledWith(['AIR', 'ROAD']);
    // Enter leaves the term in the box; × clears it.
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('r');
    await userEvent.click(screen.getByRole('button', { name: 'Clear Freight filter' }));
    expect(onApply).toHaveBeenLastCalledWith(undefined);
    expect(box).toHaveValue('');
  });

  it('a suggestion keeps just that value', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    await userEvent.type(screen.getByRole('textbox'), 'tru');
    await userEvent.click(screen.getByRole('option', { name: 'TRUCK' }));
    expect(onApply).toHaveBeenLastCalledWith(['ROAD']);
    expect(screen.getByRole('textbox')).toHaveValue('TRUCK');
  });

  it('a fixed list is a dropdown', async () => {
    const onApply = vi.fn();
    render(
      <HeaderFilter
        label="Status"
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        values={undefined}
        loading={false}
        selected={undefined}
        sort={undefined}
        options={[
          { value: 'COMPLETED', label: 'Completed' },
          { value: 'PENDING', label: 'Pending' },
        ]}
        onApply={onApply}
        onSort={() => {}}
      />,
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter Status' }),
      'COMPLETED',
    );
    expect(onApply).toHaveBeenLastCalledWith(['COMPLETED']);
  });
});
