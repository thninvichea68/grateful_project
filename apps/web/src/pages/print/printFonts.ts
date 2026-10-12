import moul from '@fontsource/moul/files/moul-khmer-400-normal.woff2';
import siemreap from '@fontsource/siemreap/files/siemreap-khmer-400-normal.woff2';

// The faces of the accounting engine's tax invoice / disbursement: Moul for the Khmer titles
// and customer name, Siemreap for the Khmer body text. Self-hosted (the CSP blocks Google
// Fonts) and registered for Khmer characters only; an installed "Khmer OS Muol Light" /
// "Khmer OS Siemreap" (as on the Excel sheets) is used first when the computer has it.
const KHMER = 'U+1780-17FF, U+19E0-19FF, U+200B-200D, U+25CC';
if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
  for (const [family, url] of [
    ['GS Moul', moul],
    ['GS Siemreap', siemreap],
  ] as const)
    document.fonts.add(
      new FontFace(family, `url(${url}) format('woff2')`, { unicodeRange: KHMER, display: 'swap' }),
    );
}
