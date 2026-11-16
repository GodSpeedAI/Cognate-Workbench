// The main header bar: the one place the current view is chosen and named. Sidebar toggle (only
// when the sidebar is hidden), breadcrumb, the view switch, the agent-mode chip and the inspector
// toggle. The view switch is the single source of truth for which surface fills the center column.
import type { ReactNode } from "react";
import { PanelRightIcon, CollapseIcon } from "../icons.tsx";

export type CenterView = "conversation" | "trajectory" | "workbench" | "experts" | "plugins";

export interface ViewOption {
  readonly id: Exclude<CenterView, "plugins">;
  readonly label: string;
  /** Accessible name; defaults to the label. */
  readonly ariaLabel?: string;
  /** Shorter label for phone widths. */
  readonly short?: string;
  readonly disabled?: boolean;
  readonly hidden?: boolean;
}

export function MainHeader({
  sidebarHidden,
  onShowSidebar,
  sidebarChord,
  crumbs,
  view,
  views,
  onViewChange,
  mode,
  trailing,
  inspectorOpen,
  onToggleInspector,
  inspectorChord,
}: {
  readonly sidebarHidden: boolean;
  readonly onShowSidebar: () => void;
  readonly sidebarChord: string | undefined;
  readonly crumbs: readonly string[];
  readonly view: CenterView;
  readonly views: readonly ViewOption[];
  readonly onViewChange: (view: Exclude<CenterView, "plugins">) => void;
  /** The agent-mode chip (preset menu). */
  readonly mode: ReactNode;
  /** Extra header actions, e.g. the subagent count. */
  readonly trailing?: ReactNode;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
  readonly inspectorChord: string | undefined;
}) {
  return (
    <header className="main-header">
      <div className="main-header-lead">
        {sidebarHidden && (
          <button
            type="button"
            className="icon-btn main-header-toggle"
            aria-label="Expand sidebar"
            aria-controls="app-sidebar"
            aria-expanded="false"
            title="Show sidebar"
            onClick={onShowSidebar}
          >
            <CollapseIcon className="flip-icon" />
          </button>
        )}
        <nav aria-label="Session hierarchy" className="breadcrumb">
          <ol>
            {crumbs.map((crumb, i) => (
              <li key={`${i}-${crumb}`} aria-current={i === crumbs.length - 1 ? "page" : undefined} title={crumb}>
                {crumb}
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div className="view-switch" role="group" aria-label="View">
        {views
          .filter((v) => !v.hidden)
          .map((v) => (
            <button
              key={v.id}
              type="button"
              className="view-switch-btn"
              aria-pressed={view === v.id}
              aria-label={v.ariaLabel ?? v.label}
              disabled={v.disabled}
              onClick={() => onViewChange(v.id)}
            >
              {v.short ? (
                <>
                  <span className="vs-full">{v.label}</span>
                  <span className="vs-short" aria-hidden="true">{v.short}</span>
                </>
              ) : (
                v.label
              )}
            </button>
          ))}
      </div>
      <div className="main-header-trail">
        {trailing}
        {mode}
        <button
          type="button"
          className={`icon-btn main-header-inspector${inspectorOpen ? " active" : ""}`}
          aria-label="Toggle inspector"
          aria-pressed={inspectorOpen}
          aria-controls="inspector"
          aria-keyshortcuts={inspectorChord?.replace("Ctrl", "Control")}
          title={`${inspectorOpen ? "Hide" : "Show"} inspector${inspectorChord ? ` (${inspectorChord})` : ""}`}
          onClick={onToggleInspector}
        >
          <PanelRightIcon />
        </button>
      </div>
    </header>
  );
}
