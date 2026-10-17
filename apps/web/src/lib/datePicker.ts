/**
 * Open the native picker when a date-type input is clicked anywhere, not only on its small
 * calendar icon. One listener for the whole app, so every date / month field gets it.
 */
const PICKER_TYPES = new Set(['date', 'month', 'week', 'time', 'datetime-local']);

document.addEventListener('click', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !PICKER_TYPES.has(el.type)) return;
  if (el.disabled || el.readOnly) return;
  try {
    el.showPicker();
  } catch {
    // Unsupported browser or picker already open: the icon still works.
  }
});
