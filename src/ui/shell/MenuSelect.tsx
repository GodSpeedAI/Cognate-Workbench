// A styled menu button standing in for a native <select> where the control sits inside a designed
// surface (the composer toolbar, form fields). Same contract as a select — a value, options, an
// onPick — but it draws with the shell's own menu and is fully keyboard operable: Enter/Space/
// ArrowDown/ArrowUp open, arrows and Home/End move, Enter/Space pick, Esc and Tab close and
// return focus, click-outside closes. The trigger's accessible name carries the current value
// ("Label: Value"), so a screen reader announces the selection like a select.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "../icons.tsx";

export function MenuSelect<T extends string>({
  value,
  options,
  onPick,
  disabled,
  ariaLabel,
  placement = "up",
  variant = "toolbar",
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly hint?: string }[];
  readonly onPick: (value: T) => void;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
  readonly placement?: "up" | "down";
  /** "field" draws like a form input (bordered, full width) instead of a quiet toolbar button. */
  readonly variant?: "toolbar" | "field";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else if (e.key === "Enter" || e.key === " ") {
      // Activate the focused item explicitly (and prevent the native click synthesis, so
      // engines that would also synthesize a click don't fire the pick twice).
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
      return;
    } else if (e.key === "Tab") {
      // Close without picking; the trigger regains focus first so the next Tab continues
      // after the control, exactly as if the menu had never been open.
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else return;
    e.preventDefault();
  };
  return (
    <div className={variant === "field" ? "menu-select menu-select-field" : "menu-select"} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="menu-select-btn"
        aria-label={`${ariaLabel}: ${current?.label ?? value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (open) return; // keys inside the open menu are the menu's own handling
          // A closed select opens on Enter, Space and both arrow keys (native select
          // behavior), activated explicitly — not via the button's native activation —
          // so the contract holds identically on every engine. Space is prevented so it
          // neither scrolls nor double-activates.
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" id={menuId} aria-label={ariaLabel} className={`menu-select-list menu-select-${placement}`} onKeyDown={onMenuKey}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                setOpen(false);
                btnRef.current?.focus();
                if (o.value !== value) onPick(o.value);
              }}
            >
              <span className="menu-select-check">{o.value === value && <CheckIcon />}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
