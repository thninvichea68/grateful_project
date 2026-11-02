import type { KeyboardEvent } from 'react';

const FIELDS = 'input:not([type="hidden"]), select, textarea';

/**
 * Enter in a line item's box moves to the same box on the next line, as in Excel (Shift+Enter
 * goes up). Put it on each line's row as `onKeyDown`; it never submits the form.
 */
export function nextLineOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  const row = e.currentTarget;
  const col = [...row.querySelectorAll<HTMLElement>(FIELDS)].indexOf(e.target as HTMLElement);
  if (col < 0) return;
  e.preventDefault();
  let next = e.shiftKey ? row.previousElementSibling : row.nextElementSibling;
  // Skip anything between the lines that isn't one (a header, a datalist).
  while (next && next.className !== row.className)
    next = e.shiftKey ? next.previousElementSibling : next.nextElementSibling;
  const target = next?.querySelectorAll<HTMLElement>(FIELDS)[col];
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement) target.select();
}
