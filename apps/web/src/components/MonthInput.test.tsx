import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthInput } from './MonthInput';

function Harness({
  initial = '',
  onChange = () => {},
  ...rest
}: {
  initial?: string;
  onChange?: (v: string) => void;
  min?: string;
  max?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MonthInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      aria-label="Month"
      placeholder="All months"
      {...rest}
    />
  );
}

describe('MonthInput', () => {
  it('shows the placeholder, then the picked month as YYYY-MM', async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Month' });
    expect(trigger).toHaveTextContent('Oct 2026');

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }));
    expect(onChange).toHaveBeenLastCalledWith('2025-03');
    expect(trigger).toHaveTextContent('Mar 2025');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears to an empty value', async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('button', { name: 'Month' })).toHaveTextContent('All months');
  });

  it('disables months outside min/max', async () => {
    render(<Harness initial="2026-05" min="2026-03" max="2026-08" />);
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByRole('button', { name: 'Feb' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sep' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
