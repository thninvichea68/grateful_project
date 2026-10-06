import { useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { ErrorBanner } from '../../components/ui';

/** A select with a "+ Add new…" option that opens the prototype's small add-new modal. */
export function AddNewSelect({
  id,
  label,
  options,
  registration,
  onCreate,
  placeholder,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  registration: UseFormRegisterReturn;
  onCreate?: ((name: string) => Promise<string>) | undefined;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!onCreate || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await onCreate(name.trim());
      // Let the refreshed option list render, then select the new value.
      setTimeout(() => {
        const el = document.getElementById(id) as HTMLSelectElement | null;
        if (el) {
          el.value = newId;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 50);
      setOpen(false);
      setName('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <select
        id={id}
        className="form-select-box addnew-select"
        {...registration}
        onChange={(e) => {
          if (e.target.value === '__add__') {
            e.target.value = '';
            setOpen(true);
            return;
          }
          void registration.onChange(e);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {onCreate && <option value="__add__">+ Add new {label.toLowerCase()}…</option>}
      </select>
      <div
        className={`addnew-modal-overlay${open ? ' open' : ''}`}
        onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      >
        {open && (
          <div
            className="addnew-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-add-title`}
          >
            <h4 id={`${id}-add-title`}>Add New {label}</h4>
            <p>Enter a {label.toLowerCase()} name to add it to the list.</p>
            <ErrorBanner error={error} />
            <input
              type="text"
              autoFocus
              value={name}
              placeholder={`e.g. ${label} name`}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <div className="addnew-modal-actions">
              <button type="button" className="addnew-modal-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="addnew-modal-save"
                disabled={busy || name.trim().length < 2}
                onClick={() => void save()}
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
