// A styled menu button standing in for a native <select> where the control sits inside a designed
// surface (the composer toolbar). Same contract as a select — a value, options, an onPick — but it
// draws with the shell's own menu and is fully keyboard operable (Enter/Space/ArrowDown opens,
// arrows move, Esc closes and returns focus).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
    else return;
    e.preventDefault();
  };
  return (
    <div className={variant === "field" ? "menu-select menu-select-field" : "menu-select"} ref={wrapRef}>
      <button ref={btnRef} type="button" className="menu-select-btn" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <span>{current?.label ?? value}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={ariaLabel} className={`menu-select-list menu-select-${placement}`} onKeyDown={onMenuKey}>
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
