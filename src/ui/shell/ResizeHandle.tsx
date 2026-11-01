// A vertical drag handle for a resizable column (sidebar, inspector). One component so both
// behave identically: pointer capture drag, col-resize cursor, arrow keys (8px, Shift 32px),
// Home/End to the limits, double-click to reset, and role="separator" with aria-valuenow so the
// width is exposed to assistive tech and tests.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export interface ResizeHandleProps {
  /** Which edge of the resized column the handle sits on. A handle on the column's `left` edge
   *  grows the column when dragged left; on its `right` edge, when dragged right. */
  readonly edge: "left" | "right";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly onChange: (next: number) => void;
  readonly label: string;
  /** id of the element being resized. */
  readonly controls?: string;
  readonly className?: string;
}

export function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}

export function ResizeHandle({ edge, value, min, max, defaultValue, onChange, label, controls, className }: ResizeHandleProps) {
  const drag = useRef<{ readonly startX: number; readonly startValue: number } | undefined>(undefined);
  // Direction of growth along the x axis.
  const dir = edge === "left" ? -1 : 1;
  const set = (next: number) => onChange(clampWidth(next, min, max));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startValue: value };
    document.body.classList.add("is-col-resizing");
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    set(d.startValue + dir * (e.clientX - d.startX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    document.body.classList.remove("is-col-resizing");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    // ArrowLeft/Right move the handle itself, so on a left-edge handle ArrowLeft widens.
    if (e.key === "ArrowLeft") set(value + dir * -step);
    else if (e.key === "ArrowRight") set(value + dir * step);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max))}
      {...(controls ? { "aria-controls": controls } : {})}
      tabIndex={0}
      className={`resize-handle resize-handle-${edge}${className ? ` ${className}` : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(defaultValue)}
    />
  );
}
