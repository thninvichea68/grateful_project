import { CardToggle } from '../pages/dashboard/parts';
import s from './DirectionToggle.module.css';

const OPTIONS = [
  { value: '', label: 'All' },
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
];

/**
 * The lists' shipment filter as one button, like the Overview's Forwarder Statistics toggle:
 * each click moves All → Import → Export → back. '' means both. Pass `options` for another
 * cycle (e.g. Import ↔ Export only).
 */
export function DirectionToggle<T extends string = string>({
  value,
  onChange,
  options = OPTIONS as { value: T; label: string }[],
  label = 'Shipment',
}: {
  value: T | undefined;
  onChange: (direction: T) => void;
  options?: { value: T; label: string }[];
  label?: string;
}) {
  return (
    <CardToggle
      label={label}
      value={value ?? ('' as T)}
      onChange={onChange}
      options={options}
      triggerClass={s.trigger}
    />
  );
}
