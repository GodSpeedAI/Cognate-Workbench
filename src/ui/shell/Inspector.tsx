// The right inspector: a generic, tabbed column at the right of the shell.
//
// Extension contract (any surface, any tranche):
//   1. Anywhere under <InspectorProvider>, render
//        <InspectorTab id="files" label="Files" icon={<FileIcon />} order={30}>...content...</InspectorTab>
//      The tab registers itself by id; its children are portalled into the inspector body only
//      while that tab is selected, so they keep their own React ownership and state.
//   2. From anywhere, `const { openInspector } = useInspector(); openInspector("config")` opens
//      the inspector on that tab (a tab registered later still wins once it appears).
//   3. Give a tab a proper empty state with <InspectorEmpty title="..." hint="..." />.
//
// Presentation: a third grid column (resizable, persisted) on wide screens; narrower under 1100px;
// an overlay sheet from the right with a scrim and Esc under 920px; full-screen under 760px.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { XIcon } from "../icons.tsx";
import { clampWidth, ResizeHandle } from "./ResizeHandle.tsx";

export const INSPECTOR_DEFAULT_WIDTH = 340;
export const INSPECTOR_MIN_WIDTH = 280;
const STORAGE_KEY = "cognate.inspector.v1";
const OVERLAY_BELOW = 920;
const FULLSCREEN_BELOW = 760;
const NARROWED_BELOW = 1100;
const CENTER_RESERVE = 420;

interface TabMeta {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly order: number;
  readonly badge?: string;
}

interface Persisted {
  readonly width?: number;
  readonly open?: boolean;
  readonly tab?: string;
}

function readPersisted(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Persisted;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(value: Persisted): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable (private window, blocked) — the inspector still works, just unremembered */
  }
}

export interface InspectorApi {
  readonly open: boolean;
  /** The selected tab id (falls back to the first registered tab). */
  readonly tab: string | undefined;
  readonly tabs: readonly TabMeta[];
  /** Open the inspector, optionally selecting a tab by id. Safe before that tab has registered. */
  readonly openInspector: (tab?: string) => void;
  readonly closeInspector: () => void;
  readonly toggleInspector: () => void;
  readonly selectTab: (tab: string) => void;
  /** Overlay presentation (< 920px): the inspector is a sheet over the page, not a column. */
  readonly overlay: boolean;
}

interface Internal extends InspectorApi {
  readonly width: number;
  readonly setWidth: (w: number) => void;
  readonly registerTab: (meta: TabMeta) => () => void;
  readonly panelEl: HTMLElement | null;
  readonly setPanelEl: (el: HTMLElement | null) => void;
  readonly viewport: number;
  readonly lastOpener: React.MutableRefObject<HTMLElement | null>;
}

const InspectorContext = createContext<Internal | undefined>(undefined);

export function useInspector(): InspectorApi {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error("useInspector must be used inside <InspectorProvider>");
  return ctx;
}

export function InspectorProvider({ children }: { readonly children: ReactNode }) {
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const overlay = viewport < OVERLAY_BELOW;
  const [persisted] = useState(readPersisted);
  const [width, setWidthState] = useState(persisted.width ?? INSPECTOR_DEFAULT_WIDTH);
  const [open, setOpenState] = useState(() => (viewport < OVERLAY_BELOW ? false : (persisted.open ?? viewport >= NARROWED_BELOW)));
  const [tab, setTab] = useState<string | undefined>(persisted.tab);
  const [registry, setRegistry] = useState<ReadonlyMap<string, TabMeta>>(new Map());
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const lastOpener = useRef<HTMLElement | null>(null);
  const wasOverlay = useRef(overlay);
  const desktopOpen = useRef(open);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Crossing the overlay breakpoint: a sheet always starts closed; returning to a column restores
  // whatever the person last chose for the column.
  useEffect(() => {
    if (overlay === wasOverlay.current) return;
    wasOverlay.current = overlay;
    setOpenState(overlay ? false : desktopOpen.current);
  }, [overlay]);

  useEffect(() => {
    if (!overlay) desktopOpen.current = open;
  }, [open, overlay]);

  useEffect(() => {
    writePersisted({ width, open: overlay ? desktopOpen.current : open, ...(tab ? { tab } : {}) });
  }, [width, open, tab, overlay]);

  const sorted = useMemo(() => [...registry.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)), [registry]);
  const effectiveTab = tab !== undefined && registry.has(tab) ? tab : sorted[0]?.id;

  const setOpen = useCallback((next: boolean) => {
    if (next) {
      const el = document.activeElement;
      lastOpener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    }
    setOpenState(next);
  }, []);
  const openInspector = useCallback(
    (next?: string) => {
      if (next) setTab(next);
      setOpen(true);
    },
    [setOpen],
  );
  const closeInspector = useCallback(() => setOpenState(false), []);
  const toggleInspector = useCallback(() => setOpen(!open), [open, setOpen]);
  const registerTab = useCallback((meta: TabMeta) => {
    setRegistry((prev) => {
      const old = prev.get(meta.id);
      if (old && old.label === meta.label && old.order === meta.order && old.badge === meta.badge) return prev;
      const next = new Map(prev);
      next.set(meta.id, meta);
      return next;
    });
    return () =>
      setRegistry((prev) => {
        if (!prev.has(meta.id)) return prev;
        const next = new Map(prev);
        next.delete(meta.id);
        return next;
      });
  }, []);

  const value = useMemo<Internal>(
    () => ({
      open,
      tab: effectiveTab,
      tabs: sorted,
      openInspector,
      closeInspector,
      toggleInspector,
      selectTab: setTab,
      overlay,
      width,
      setWidth: setWidthState,
      registerTab,
      panelEl,
      setPanelEl,
      viewport,
      lastOpener,
    }),
    [open, effectiveTab, sorted, openInspector, closeInspector, toggleInspector, overlay, width, registerTab, panelEl, viewport],
  );
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

/** Registers a tab and, while it is the selected tab, portals its children into the inspector body. */
export function InspectorTab({
  id,
  label,
  icon,
  order = 100,
  badge,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly order?: number;
  readonly badge?: string;
  readonly children: ReactNode;
}) {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error("InspectorTab must be used inside <InspectorProvider>");
  const { registerTab, tab, open, panelEl } = ctx;
  const iconRef = useRef(icon);
  iconRef.current = icon;
  useLayoutEffect(
    () => registerTab({ id, label, order, ...(badge ? { badge } : {}), ...(iconRef.current ? { icon: iconRef.current } : {}) }),
    [registerTab, id, label, order, badge],
  );
  if (!open || tab !== id || !panelEl) return null;
  return createPortal(children, panelEl);
}

export function InspectorEmpty({ title, hint, children }: { readonly title: string; readonly hint?: string; readonly children?: ReactNode }) {
  return (
    <div className="inspector-empty">
      <p className="inspector-empty-title">{title}</p>
      {hint && <p className="inspector-empty-hint">{hint}</p>}
      {children}
    </div>
  );
}

/** The inspector column / sheet. Render it as a direct child of the shell grid. */
export function Inspector({ sidebarWidth }: { readonly sidebarWidth: number }) {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error("Inspector must be used inside <InspectorProvider>");
  const { open, tab, tabs, overlay, width, setWidth, selectTab, closeInspector, setPanelEl, viewport, lastOpener } = ctx;
  const asideRef = useRef<HTMLElement>(null);
  const fullscreen = viewport < FULLSCREEN_BELOW;
  const max = Math.max(INSPECTOR_MIN_WIDTH, viewport - sidebarWidth - CENTER_RESERVE);
  // Under 1100px the column is narrower than the persisted width, without forgetting it.
  const narrowCap = viewport < NARROWED_BELOW ? 300 : Number.POSITIVE_INFINITY;
  const shown = fullscreen ? viewport : Math.min(clampWidth(width, INSPECTOR_MIN_WIDTH, max), overlay ? Math.min(420, viewport - 40) : narrowCap);

  // Focus: opening the sheet moves focus into it; closing returns it to what opened it.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (overlay && open && !wasOpen.current) {
      asideRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], .inspector-close')?.focus();
    }
    if (!open && wasOpen.current && overlay) {
      const el = lastOpener.current;
      if (el && el.isConnected) el.focus();
    }
    wasOpen.current = open;
  }, [open, overlay, lastOpener]);

  useEffect(() => {
    if (!open || !overlay) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      closeInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overlay, closeInspector]);

  if (!open) return null;

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    selectTab(target.id);
    requestAnimationFrame(() => asideRef.current?.querySelector<HTMLElement>(`#inspector-tab-${CSS.escape(target.id)}`)?.focus());
  };

  return (
    <>
      {overlay && <div className="inspector-scrim" onClick={closeInspector} aria-hidden="true" />}
      <aside
        ref={asideRef}
        id="inspector"
        className={`inspector${overlay ? " inspector-overlay" : ""}`}
        aria-label="Inspector"
        style={{ width: overlay && !fullscreen ? `${shown}px` : fullscreen ? "100%" : `${shown}px` }}
      >
        {!overlay && (
          <ResizeHandle
            edge="left"
            label="Resize inspector"
            controls="inspector"
            value={shown}
            min={INSPECTOR_MIN_WIDTH}
            max={max}
            defaultValue={INSPECTOR_DEFAULT_WIDTH}
            onChange={setWidth}
          />
        )}
        <div className="inspector-head">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs" onKeyDown={onTabKeyDown}>
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`inspector-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                aria-controls="inspector-panel"
                tabIndex={t.id === tab ? 0 : -1}
                className="inspector-tab"
                onClick={() => selectTab(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.badge && <span className="inspector-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn inspector-close" aria-label="Hide inspector" title="Hide inspector" onClick={closeInspector}>
            <XIcon />
          </button>
        </div>
        <div
          id="inspector-panel"
          role="tabpanel"
          aria-labelledby={tab ? `inspector-tab-${tab}` : undefined}
          className="inspector-body"
          ref={setPanelEl}
        >
          {tabs.length === 0 && <InspectorEmpty title="Nothing to inspect" hint="Context, changes and details appear here as you work." />}
        </div>
      </aside>
    </>
  );
}
