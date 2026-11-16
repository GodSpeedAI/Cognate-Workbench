import { useEffect } from "react";
import type { RefObject } from "react";

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open-modal stack (usage pass U2): the Keyboard shortcuts dialog stacks over Settings, and the
 *  Full-access confirmation stacks over the General pane — "Close menu or top dialog Esc" (listed
 *  as a real binding in that dialog) must close only the TOP dialog, so each mounted modal
 *  registers itself here and ignores Escape/Tab while something sits above it. */
export const OPEN_MODAL_STACK: HTMLElement[] = [];

/** Shared modal contract (technical audit: only one of three modal surfaces had this before this
 *  redesign) — traps focus inside the dialog, returns focus to whatever opened it on unmount, and
 *  optionally calls `onEscape` when the dialog is open and Escape is pressed. Every modal in this
 *  app (Settings, both first-run dialogs, Keyboard shortcuts, the Full-access confirmation) uses
 *  this instead of inventing its own subset. */
export function useModalFocus(dialogRef: RefObject<HTMLElement | null>, onEscape?: () => void): void {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) OPEN_MODAL_STACK.push(dialog);
    // Initial focus: an explicit [data-autofocus] target, else the first control that is not the
    // header's close button (landing on the X first makes Enter dismiss the dialog by accident).
    const focusables = Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables.find((el) => !el.classList.contains("dialog-close")) ?? focusables[0];
    (preferred ?? dialog)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the top-most open modal reacts — a stacked dialog (shortcuts over Settings, the
      // Full-access confirmation over General) absorbs Escape/Tab first.
      if (dialog && OPEN_MODAL_STACK[OPEN_MODAL_STACK.length - 1] !== dialog) return;
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = dialog ? OPEN_MODAL_STACK.indexOf(dialog) : -1;
      if (index >= 0) OPEN_MODAL_STACK.splice(index, 1);
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
