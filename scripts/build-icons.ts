// One-off: rasterise assets/icons/cognate-workbench.svg to PNGs (16..256) and a PNG-embedded multi-size .ico.
// Needs playwright-core with an installed chromium. The outputs are committed, so packaging needs no browser.
//   bun scripts/build-icons.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const dir = join(import.meta.dir, "..", "assets", "icons");
const svg = await readFile(join(dir, "cognate-workbench.svg"), "utf8");
const sizes = [16, 32, 48, 64, 128, 256];
const browser = await chromium.launch();
const pngs = new Map<number, Buffer>();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  pngs.set(size, await page.screenshot({ omitBackground: true, type: "png" }));
  await page.close();
}
await browser.close();
await mkdir(dir, { recursive: true });
for (const [size, png] of pngs) await writeFile(join(dir, `cognate-workbench-${size}.png`), png);

// ICO: ICONDIR (6 bytes) + one 16-byte ICONDIRENTRY per image + the PNG payloads. Width/height 0 means 256.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size) => {
  const png = pngs.get(size)!;
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4);   // planes
  entry.writeUInt16LE(32, 6);  // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
await writeFile(join(dir, "cognate-workbench.ico"), Buffer.concat([header, ...entries, ...sizes.map((s) => pngs.get(s)!)]));
console.log(`icons: wrote ${sizes.length} PNGs and cognate-workbench.ico to ${dir}`);
