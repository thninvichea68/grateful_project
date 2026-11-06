import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthRangeInput } from './MonthRangeInput';

function Harness({ onChange = () => {} }: { onChange?: (f: string, t: string) => void }) {
  const [range, setRange] = useState<[string, string]>(['2026-01', '2026-10']);
  return (
    <MonthRangeInput
      from={range[0]}
      to={range[1]}
      onChange={(f, t) => {
        setRange([f, t]);
        onChange(f, t);
      }}
      aria-label="Months"
    />
  );
}

describe('MonthRangeInput', () => {
  it('shows the range in one field', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Months' })).toHaveTextContent('Jan 2026 – Oct 2026');
  });

  it('picks start then end, swapping a backwards pick', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Months' }));
    await userEvent.click(screen.getByRole('button', { name: 'Jun' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nov' }));
    expect(onChange).toHaveBeenLastCalledWith('2025-11', '2026-06');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Months' })).toHaveTextContent('Nov 2025 – Jun 2026');
  });

  it('a month clicked twice is a single-month range', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Months' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-03', '2026-03');
    expect(screen.getByRole('button', { name: 'Months' })).toHaveTextContent('Mar 2026');
  });
});
