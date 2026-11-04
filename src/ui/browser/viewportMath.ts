// Geometry for the browser panel's canvas: the streamed bitmap is painted with
// object-fit: contain, so the drawn image can be smaller than the element box and centered
// in it. Pointer coordinates must map through the contained image rect — mapping through the
// element box lands every click in the wrong place whenever the dock's aspect ratio differs
// from the streamed viewport's (regression: J-BROWSER E2E, 2026-11-03).
export interface ElementBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
  /** False when the pointer was in the letterbox margin rather than on the drawn image. */
  readonly insideImage: boolean;
}

/**
 * Map a pointer position (client coordinates) from the canvas element box to the streamed
 * viewport's pixel coordinates. A pointer in the letterbox margin clamps to the nearest image
 * edge — a margin click should never produce a coordinate outside the page. Both the box and
 * the client position are CSS pixels, so display scaling cancels: HiDPI changes neither branch
 * nor result.
 */
export function mapViewportPoint(
  clientX: number,
  clientY: number,
  box: ElementBox,
  bitmapWidth: number,
  bitmapHeight: number,
): ViewportPoint {
  // A bitmap that has not arrived yet (0x0) falls back to stretching the box itself.
  const imageWidth = bitmapWidth > 0 ? bitmapWidth : box.width;
  const imageHeight = bitmapHeight > 0 ? bitmapHeight : box.height;
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const offsetX = (box.width - imageWidth * scale) / 2;
  const offsetY = (box.height - imageHeight * scale) / 2;
  const rawX = (clientX - box.left - offsetX) / scale;
  const rawY = (clientY - box.top - offsetY) / scale;
  const insideImage = rawX >= 0 && rawX <= imageWidth && rawY >= 0 && rawY <= imageHeight;
  return {
    x: Math.round(Math.max(0, Math.min(imageWidth, rawX))),
    y: Math.round(Math.max(0, Math.min(imageHeight, rawY))),
    insideImage,
  };
}
