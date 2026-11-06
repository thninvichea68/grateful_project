// Apply the saved theme before first paint (external file so the CSP can forbid inline scripts).
// Light is the default; dark only when the user picked it.
try {
  if (localStorage.getItem('gs:theme') !== 'dark') document.documentElement.setAttribute('data-theme', 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
