// The one header every dialog, panel and page in the app uses: title on the left, optional
// subtitle under it, optional extra actions, and the close button pinned to the RIGHT edge.
// Keeping this a single component is what makes "the X is always on the right" true by
// construction rather than by per-dialog CSS.
import type { ReactNode } from "react";
import { XIcon } from "../icons.tsx";

/** Icon-only close control: 28px hit target, labelled "Close <name>". */
export function CloseButton({ label, onClick, className }: { readonly label: string; readonly onClick: () => void; readonly className?: string }) {
  return (
    <button type="button" className={className ? `icon-btn dialog-close ${className}` : "icon-btn dialog-close"} aria-label={`Close ${label}`} title={`Close ${label}`} onClick={onClick}>
      <XIcon />
    </button>
  );
}

export function DialogHeader({
  title,
  titleId,
  subtitle,
  onClose,
  closeLabel,
  actions,
  className,
}: {
  readonly title: ReactNode;
  /** id of the heading, for `aria-labelledby` on the dialog. */
  readonly titleId?: string;
  readonly subtitle?: ReactNode;
  readonly onClose: () => void;
  /** Accessible name of the thing being closed; defaults to the title when it is a string. */
  readonly closeLabel?: string;
  /** Extra controls placed just left of the close button. */
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  const name = closeLabel ?? (typeof title === "string" ? title.toLowerCase() : "dialog");
  return (
    <div className={className ? `dialog-banner modal-header ${className}` : "dialog-banner modal-header"}>
      <div className="modal-header-text">
        <h2 id={titleId}>{title}</h2>
        {subtitle !== undefined && <p className="modal-header-subtitle">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="modal-header-actions">{actions}</div>}
      <CloseButton label={name} onClick={onClose} />
    </div>
  );
}
