import type { InputHTMLAttributes } from 'react';
import { icons } from '../layout/icons';
import s from './SearchBox.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  /** Classes for the outer box (e.g. to let it take the free width). */
  className?: string;
};

/** Page search field: one bordered box with the icon inside, like the top-bar search. */
export function SearchBox({ className, ...input }: Props) {
  return (
    <label className={className ? `${s.box} ${className}` : s.box}>
      <input type="search" {...input} />
      {icons.search({})}
    </label>
  );
}
