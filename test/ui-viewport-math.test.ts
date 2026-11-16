// Regression coverage for the browser panel's input mapping (src/ui/browser/viewportMath.ts).
// The streamed bitmap paints with object-fit: contain, so every container whose aspect ratio
// differs from the viewport's letterboxes on one axis; mapping through the element box instead
// of the contained image rect sent real clicks to the wrong page coordinates (J-BROWSER E2E,
// 2026-11-03). This matrix pins the geometry: both letterbox axes, exact fit, extreme docks,
// resize, HiDPI, margin clamping, and the not-yet-arrived-bitmap fallback.
import { describe, expect, test } from "bun:test";
import { mapViewportPoint } from "../src/ui/browser/viewportMath.ts";

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe("mapViewportPoint", () => {
  test("exact fit: identity between the element box and the bitmap", () => {
    // A 1280x633 frame in an exactly matching box.
    const b = box(280, 654, 1280, 633);
    const center = mapViewportPoint(280 + 640, 654 + 316.5, b, 1280, 633);
    expect(center.x).toBe(640);
    expect(center.y).toBe(317); // rounding of 316.5
    expect(center.insideImage).toBe(true);
    const corner = mapViewportPoint(280 + 1279.2, 654 + 632.7, b, 1280, 633);
    expect(corner.x).toBe(1279);
    expect(corner.y).toBe(633);
    expect(corner.insideImage).toBe(true);
  });

  test("pillarbox (container wider than the frame): horizontal margins, x spans the bitmap", () => {
    // 1280x720 frame in a wide, short dock: scale is height-bound, pillars left and right.
    const b = box(0, 0, 1710, 214); // height-bound: 214/720 ≈ 0.2972, image width ≈ 380.4
    const scale = 214 / 720;
    const imageWidth = 1280 * scale;
    const leftMargin = (1710 - imageWidth) / 2;
    // A click at the drawn image's left edge maps to x≈0; at its right edge to x≈1280.
    const atLeftEdge = mapViewportPoint(leftMargin, 107, b, 1280, 720);
    expect(atLeftEdge.x).toBe(0);
    expect(atLeftEdge.y).toBe(360);
    const atRightEdge = mapViewportPoint(leftMargin + imageWidth, 107, b, 1280, 720);
    expect(atRightEdge.x).toBe(1280);
    // The margins themselves clamp to the edges and report they were off the image.
    const inLeftPillar = mapViewportPoint(leftMargin / 2, 107, b, 1280, 720);
    expect(inLeftPillar.x).toBe(0);
    expect(inLeftPillar.insideImage).toBe(false);
    const inRightPillar = mapViewportPoint(leftMargin + imageWidth + 40, 107, b, 1280, 720);
    expect(inRightPillar.x).toBe(1280);
    expect(inRightPillar.insideImage).toBe(false);
  });

  test("letterbox (container taller than the frame): vertical margins, y spans the bitmap", () => {
    // 1280x720 frame in a tall narrow pane: scale is width-bound, bars top and bottom.
    const b = box(0, 0, 300, 900); // width-bound: 300/1280, image height ≈ 168.75
    const scale = 300 / 1280;
    const imageHeight = 720 * scale;
    const topMargin = (900 - imageHeight) / 2;
    const atTopEdge = mapViewportPoint(150, topMargin, b, 1280, 720);
    expect(atTopEdge.y).toBe(0);
    const atBottomEdge = mapViewportPoint(150, topMargin + imageHeight, b, 1280, 720);
    expect(atBottomEdge.y).toBe(720);
    const inTopBar = mapViewportPoint(150, topMargin / 2, b, 1280, 720);
    expect(inTopBar.y).toBe(0);
    expect(inTopBar.insideImage).toBe(false);
    const inBottomBar = mapViewportPoint(150, topMargin + imageHeight + 25, b, 1280, 720);
    expect(inBottomBar.y).toBe(720);
    expect(inBottomBar.insideImage).toBe(false);
  });

  test("the regression shape: real dock box around a 1280x633 frame maps the fixture button correctly", () => {
    // The shape from the failing E2E run: canvas box {x:280, y:654, w:820, h:214}, bitmap
    // 1280x633. The fixture button at page (79, 37) must land on the drawn image, and the
    // element-box mapping (the old, wrong math) must NOT produce it — this is the pin.
    const b = box(280, 654, 820, 214);
    const scale = Math.min(820 / 1280, 214 / 633); // 214/633 ≈ 0.3381, width-bound
    const imageWidth = 1280 * scale;
    const leftMargin = (820 - imageWidth) / 2;
    const correct = mapViewportPoint(280 + leftMargin + 79 * scale, 654 + 37 * scale, b, 1280, 633);
    expect(correct.x).toBe(79);
    expect(correct.y).toBe(37);
    expect(correct.insideImage).toBe(true);
  });

  test("extreme dock aspect ratios stay exact along the binding axis", () => {
    // Very wide (maximize on an ultrawide): 1280x633 into 2400x180.
    const wide = box(0, 0, 2400, 180);
    const wideScale = 180 / 633;
    const wideClick = mapViewportPoint((2400 - 1280 * wideScale) / 2 + 640 * wideScale, 90, wide, 1280, 633);
    expect(wideClick.x).toBe(640);
    expect(wideClick.y).toBe(317);
    // Very tall (mobile pane): 1280x633 into 200x1600.
    const tall = box(0, 0, 200, 1600);
    const tallScale = 200 / 1280;
    const tallClick = mapViewportPoint(100, (1600 - 633 * tallScale) / 2 + 316.5 * tallScale, tall, 1280, 633);
    expect(tallClick.x).toBe(640);
    expect(tallClick.y).toBe(317);
  });

  test("resize: the same page point moves with the box, always landing on the same bitmap pixel", () => {
    const bitmap = { w: 1280, h: 633 };
    const pagePixel = { x: 960, y: 475 }; // three-quarters across, three-quarters down
    for (const [width, height] of [[500, 200], [820, 214], [1024, 500], [1440, 633]] as const) {
      const b = box(0, 0, width, height);
      const scale = Math.min(width / bitmap.w, height / bitmap.h);
      const offsetX = (width - bitmap.w * scale) / 2;
      const offsetY = (height - bitmap.h * scale) / 2;
      const result = mapViewportPoint(offsetX + pagePixel.x * scale, offsetY + pagePixel.y * scale, b, bitmap.w, bitmap.h);
      expect(result.x).toBe(pagePixel.x);
      expect(result.y).toBe(pagePixel.y);
      expect(result.insideImage).toBe(true);
    }
  });

  test("HiDPI: scaling the box and the client position together changes nothing", () => {
    // CSS-pixel geometry is DPR-independent: at devicePixelRatio 2 every box and client value
    // doubles, and the mapping must return the same bitmap coordinates.
    const bitmap = { w: 1280, h: 720 };
    const dpr = 2;
    const logical = box(100, 50, 640, 360);
    const physical = box(100 * dpr, 50 * dpr, 640 * dpr, 360 * dpr);
    const clientX = 100 + 480; // inside the drawn image
    const clientY = 50 + 200;
    const atDpr1 = mapViewportPoint(clientX, clientY, logical, bitmap.w, bitmap.h);
    const atDpr2 = mapViewportPoint(clientX * dpr, clientY * dpr, physical, bitmap.w, bitmap.h);
    expect(atDpr2.x).toBe(atDpr1.x);
    expect(atDpr2.y).toBe(atDpr1.y);
    expect(atDpr1.insideImage).toBe(true);
  });

  test("a bitmap that has not arrived yet (0x0) stretches the box itself", () => {
    const b = box(0, 0, 800, 400);
    const beforeFirstFrame = mapViewportPoint(400, 200, b, 0, 0);
    expect(beforeFirstFrame.x).toBe(400);
    expect(beforeFirstFrame.y).toBe(200);
  });

  test("fractional client coordinates round to integer viewport pixels", () => {
    const b = box(0, 0, 640, 360); // exact 2:1 downscale of 1280x720
    const result = mapViewportPoint(100.6, 200.4, b, 1280, 720);
    expect(result.x).toBe(201);
    expect(result.y).toBe(401);
  });
});
