/**
 * Open the native picker when a date-type input is clicked anywhere, not only on its small
 * calendar icon. One listener for the whole app, so every date / month field gets it.
 */
const PICKER_TYPES = new Set(['date', 'month', 'week', 'time', 'datetime-local']);

const pickerInput = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && PICKER_TYPES.has(el.type);

document.addEventListener('click', (e) => {
  const el = e.target;
  if (!pickerInput(el)) return;
  if (el.disabled || el.readOnly) return;
  try {
    el.showPicker();
  } catch {
    // Unsupported browser or picker already open: the icon still works.
  }
});
