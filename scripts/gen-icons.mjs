/* Generates Iqra's placeholder app icons from an inline SVG.
 * Run: node scripts/gen-icons.mjs
 *
 * Design: an open-book mark (the Book / "Iqra" = "Read") in warm cream on the
 * Paper & Pine accent. Swap in a real design later and re-run. */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const ACCENT = "#1B6B53";
const ACCENT_DARK = "#14583F";
const CREAM = "#FBF9F2";

const OUT = new URL("../public/icons/", import.meta.url);

/** Open-book glyph centered in a 512 viewBox, scaled by `s` (0..1 of canvas). */
function book({ stroke, fill, fillOpacity }) {
  return `
    <g fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}"
       stroke-width="10" stroke-linejoin="round" stroke-linecap="round">
      <path d="M256 176 C212 158 156 158 104 176 L104 358 C156 340 212 340 256 358 Z"/>
      <path d="M256 176 C300 158 356 158 408 176 L408 358 C356 340 300 340 256 358 Z"/>
      <path d="M256 176 L256 358" fill="none"/>
      <g stroke-width="8" opacity="0.55">
        <path d="M138 212 H222" fill="none"/>
        <path d="M138 246 H222" fill="none"/>
        <path d="M138 280 H210" fill="none"/>
        <path d="M290 212 H374" fill="none"/>
        <path d="M290 246 H374" fill="none"/>
        <path d="M302 280 H374" fill="none"/>
      </g>
    </g>`;
}

function svgAny(radius) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${radius}" fill="${ACCENT}"/>
    ${book({ stroke: ACCENT_DARK, fill: CREAM, fillOpacity: 1 })}
  </svg>`;
}

function svgMaskable() {
  // Full-bleed background; glyph kept inside the ~80% safe zone (scaled 0.82).
  const inner = book({ stroke: ACCENT_DARK, fill: CREAM, fillOpacity: 1 });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${ACCENT}"/>
    <g transform="translate(256 256) scale(0.82) translate(-256 -256)">${inner}</g>
  </svg>`;
}

function svgBadge() {
  // Monochrome white silhouette on transparent for Android's status-bar badge.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    ${book({ stroke: "#FFFFFF", fill: "#FFFFFF", fillOpacity: 0 })}
  </svg>`;
}

async function render(svg, size, name) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(name, OUT).pathname);
  console.log("wrote", name, `${size}×${size}`);
}

await mkdir(OUT, { recursive: true });
await render(svgAny(114), 192, "icon-192.png");
await render(svgAny(114), 512, "icon-512.png");
await render(svgMaskable(), 512, "icon-maskable-512.png");
await render(svgBadge(), 72, "badge-72.png");
// Apple touch icon (no rounding — iOS applies its own squircle mask).
await render(svgAny(0), 180, "apple-touch-icon.png");
console.log("done");
