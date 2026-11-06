import { useId, type ReactNode } from 'react';
import s from './InfoTip.module.css';

/**
 * A circled "!" (or "?") beside a title; its explanation shows on hover or keyboard focus.
 * `align="end"` opens the tip leftwards, for an icon at the right edge.
 */
export function InfoTip({
  label = 'More info',
  symbol = '!',
  align = 'start',
  children,
}: {
  label?: string;
  symbol?: '!' | '?';
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className={s.wrap} data-align={align}>
      <button type="button" className={s.icon} aria-label={label} aria-describedby={id}>
        {symbol}
      </button>
      <span role="tooltip" id={id} className={s.tip}>
        {children}
      </span>
    </span>
  );
}
