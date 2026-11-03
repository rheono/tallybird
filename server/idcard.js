// A fake identity card, drawn as SVG. It says SPECIMEN in three places so a
// screenshot of it can never pass for a real document.
import { fakeBirthDate } from './seed.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function idCardSvg(profile) {
  const initials = profile.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const docNo = `SPECIMEN-${profile.id.slice(0, 4).toUpperCase()}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" role="img" aria-label="Specimen ID card for ${esc(profile.full_name)}">
<rect width="640" height="400" rx="18" fill="#e8eef5"/>
<rect x="0" y="0" width="640" height="64" rx="18" fill="#3b5b86"/>
<rect x="0" y="40" width="640" height="24" fill="#3b5b86"/>
<text x="28" y="42" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">IDENTITY CARD · SPECIMEN</text>
<text x="612" y="42" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#dbe6f3">NOT A REAL DOCUMENT</text>
<rect x="28" y="92" width="168" height="208" rx="10" fill="#c9d6e6"/>
<circle cx="112" cy="168" r="44" fill="#9fb3cc"/>
<rect x="56" y="222" width="112" height="60" rx="30" fill="#9fb3cc"/>
<text x="112" y="182" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#3b5b86">${esc(initials)}</text>
<text x="224" y="118" font-family="Arial, sans-serif" font-size="13" fill="#5b6b80">SURNAME / GIVEN NAMES</text>
<text x="224" y="146" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#1d2b3e">${esc(profile.full_name)}</text>
<text x="224" y="186" font-family="Arial, sans-serif" font-size="13" fill="#5b6b80">DATE OF BIRTH</text>
<text x="224" y="210" font-family="Arial, sans-serif" font-size="20" fill="#1d2b3e">${fakeBirthDate(profile.id)}</text>
<text x="224" y="248" font-family="Arial, sans-serif" font-size="13" fill="#5b6b80">DOCUMENT NO.</text>
<text x="224" y="272" font-family="Arial, sans-serif" font-size="20" fill="#1d2b3e">${esc(docNo)}</text>
<text x="320" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#3b5b86" fill-opacity="0.16" transform="rotate(-12 320 360)">SPECIMEN</text>
</svg>`;
}
