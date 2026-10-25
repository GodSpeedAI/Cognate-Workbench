// Server-rendered QR code for the pairing link (inline SVG, no client library).
import { qrcodegen } from "./vendor/qrcodegen.ts";

export function qrSvg(text: string): string {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.getModule(x, y)) path += `M${x + 4},${y + 4}h1v1h-1z`;
    }
  }
  const edge = size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${edge} ${edge}" shape-rendering="crispEdges" role="img" aria-label="QR code for the phone pairing link"><rect width="${edge}" height="${edge}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
