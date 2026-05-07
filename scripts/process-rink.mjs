// One-shot rink-image cleanup. Crops the ice surface tight to the boards
// and masks the Olympic ring watermarks with white circles.
//
// Usage: drop your raw rink image at public/rink-source.png and run:
//   node scripts/process-rink.mjs

import sharp from "sharp";
import fs from "fs";
import path from "path";

const SRC = path.resolve("public/rink-source.png");
const OUT = path.resolve("public/rink.png");

// Tunable crop margins (fraction of source dimensions)
const MARGIN_X = 0.07;
const MARGIN_Y = 0.06;

// Olympic ring overlay positions, expressed as fractions of the CROPPED image
// (left ring on lower-left, right ring on upper-right based on source layout).
const RINGS = [
  { xFrac: 0.025, yFrac: 0.7,  rFrac: 0.05 }, // lower-left
  { xFrac: 0.975, yFrac: 0.3,  rFrac: 0.05 }, // upper-right
];

// Ice color to blend with — slight cool tint
const ICE_COLOR = "#f4f8fc";

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    console.error("Save your rink image at public/rink-source.png and re-run.");
    process.exit(1);
  }

  const meta = await sharp(SRC).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  console.log(`Source: ${w}×${h} ${meta.format}`);

  const left = Math.round(w * MARGIN_X);
  const top = Math.round(h * MARGIN_Y);
  const cw = w - left * 2;
  const ch = h - top * 2;

  // Build SVG mask for ring overlays
  const overlays = RINGS.map(({ xFrac, yFrac, rFrac }) => {
    const cx = Math.round(cw * xFrac);
    const cy = Math.round(ch * yFrac);
    const r = Math.round(Math.min(cw, ch) * rFrac);
    return { cx, cy, r };
  });
  const maskSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">
      ${overlays
        .map(
          ({ cx, cy, r }) =>
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ICE_COLOR}"/>`
        )
        .join("\n")}
    </svg>
  `;

  await sharp(SRC)
    .extract({ left, top, width: cw, height: ch })
    .composite([{ input: Buffer.from(maskSvg), top: 0, left: 0 }])
    .toFile(OUT);

  const outMeta = await sharp(OUT).metadata();
  console.log(
    `Output: ${outMeta.width}×${outMeta.height} → ${OUT}\n` +
      `Aspect ratio: ${(
        (outMeta.width ?? 1) / (outMeta.height ?? 1)
      ).toFixed(2)}:1 (NHL rink target ≈ 2.35:1)\n` +
      `Masked ${RINGS.length} ring positions with ${ICE_COLOR}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
