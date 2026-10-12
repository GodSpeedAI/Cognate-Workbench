// Small inline-SVG icon set, drawn from scratch for this reconstruction (no copied assets).
// Kept tiny and monochrome (`currentColor`) so they follow the surrounding text/button color in
// both themes. Not meant to be pixel-identical to the reference's iconography — see
// APP/DEVIATIONS.md.
import type { JSX } from "react";

type IconProps = JSX.IntrinsicElements["svg"];

function base(children: JSX.Element, props: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const LogoIcon = (props: IconProps) =>
  base(
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="4" />
      <path d="M5 8h6M8 5v6" />
    </>,
    props,
  );

export const CollapseIcon = (props: IconProps) =>
  base(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 2.5v11" />
      <path d="M4 6.5l-1.2 1.5L4 9.5" />
    </>,
    props,
  );

export const PlusIcon = (props: IconProps) => base(<path d="M8 3v10M3 8h10" />, props);

export const SearchIcon = (props: IconProps) =>
  base(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13.5 13.5L10.5 10.5" />
    </>,
    props,
  );

export const SlidersIcon = (props: IconProps) =>
  base(
    <>
      <path d="M2 4.5h12M2 8h12M2 11.5h12" />
      <circle cx="5.5" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
    </>,
    props,
  );

export const GearIcon = (props: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.7v1.4M8 12.9v1.4M14.3 8h-1.4M3.1 8H1.7M12.3 3.7l-1 1M4.7 11.3l-1 1M12.3 12.3l-1-1M4.7 4.7l-1-1" />
    </>,
    props,
  );

export const PluginIcon = (props: IconProps) =>
  base(
    <>
      <path d="M6 2v2.5M10 2v2.5" />
      <rect x="3" y="4.5" width="10" height="6" rx="1.5" />
      <path d="M6 10.5V13M10 10.5V13" />
    </>,
    props,
  );

export const ChevronDownIcon = (props: IconProps) => base(<path d="M4 6l4 4 4-4" />, props);

export const ChevronRightIcon = (props: IconProps) => base(<path d="M6 4l4 4-4 4" />, props);

/** Sidebar workspace row (critic round-4 P1-4): a plain folder-outline glyph before the workspace
 *  name, matching the reference's `folder-icon "<workspace>"` row. */
export const FolderIcon = (props: IconProps) =>
  base(
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.25 1.5h6.25a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1z" />,
    props,
  );

export const SendIcon = (props: IconProps) => base(<path d="M8 12.5V3.5M8 3.5L4 7.5M8 3.5l4 4" />, props);

export const StopIcon = (props: IconProps) => base(<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />, props);

export const CopyIcon = (props: IconProps) =>
  base(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>,
    props,
  );

export const SunIcon = (props: IconProps) =>
  base(
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1" />
    </>,
    props,
  );

export const MoonIcon = (props: IconProps) => base(<path d="M13 9.3A5.5 5.5 0 1 1 6.7 3a4.3 4.3 0 0 0 6.3 6.3z" />, props);

export const ThumbUpIcon = (props: IconProps) =>
  base(
    <>
      <path d="M5.5 7v6.5H3.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2z" />
      <path d="M5.5 7l2.7-4.7a1.2 1.2 0 0 1 2.2.9l-.7 2.3h3a1.3 1.3 0 0 1 1.2 1.8l-1.8 4.4a1.3 1.3 0 0 1-1.2.8H5.5" />
    </>,
    props,
  );

export const ThumbDownIcon = (props: IconProps) =>
  base(
    <g transform="translate(0 16) scale(1 -1)">
      <path d="M5.5 7v6.5H3.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2z" />
      <path d="M5.5 7l2.7-4.7a1.2 1.2 0 0 1 2.2.9l-.7 2.3h3a1.3 1.3 0 0 1 1.2 1.8l-1.8 4.4a1.3 1.3 0 0 1-1.2.8H5.5" />
    </g>,
    props,
  );

export const BranchIcon = (props: IconProps) =>
  base(
    <>
      <circle cx="4" cy="3.5" r="1.8" />
      <circle cx="4" cy="12.5" r="1.8" />
      <circle cx="12" cy="8" r="1.8" />
      <path d="M4 5.3V10.7M5.6 4.3c2 .5 3.4 1.8 4.6 3" />
    </>,
    props,
  );

export const CheckIcon = (props: IconProps) => base(<path d="M3 8.5l3 3 7-7" />, props);

export const EditIcon = (props: IconProps) =>
  base(
    <>
      <path d="M10.5 2.5l3 3-8 8-3.5.5.5-3.5z" />
    </>,
    props,
  );

export const TrashIcon = (props: IconProps) =>
  base(
    <>
      <path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
    </>,
    props,
  );

export const FileIcon = (props: IconProps) =>
  base(
    <>
      <path d="M4.5 1.5h5l2 2v11h-7z" />
      <path d="M9.5 1.5v2h2" />
    </>,
    props,
  );

/** Session header "Open in Files" (critic round-4 P2): collapses to this icon-only glyph once the
 *  Review panel narrows the chat column, keeping the same accessible name. */
export const ExternalLinkIcon = (props: IconProps) =>
  base(
    <>
      <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
      <path d="M9.5 2.5H13.5V6.5" />
      <path d="M13 3L7 9" />
    </>,
    props,
  );

export const PanelRightIcon = (props: IconProps) =>
  base(
    <>
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      <path d="M10.5 3v10" />
    </>,
    props,
  );

/** Review panel toolbar (critic round-2 batch B P0, `10-file-change-expanded`). */
export const ListViewIcon = (props: IconProps) =>
  base(
    <>
      <path d="M4 4h9M4 8h9M4 12h9" />
      <circle cx="1.5" cy="4" r="0.6" fill="currentColor" />
      <circle cx="1.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="1.5" cy="12" r="0.6" fill="currentColor" />
    </>,
    props,
  );

export const SplitViewIcon = (props: IconProps) =>
  base(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M8 2.5v11" />
    </>,
    props,
  );

export const CodeViewIcon = (props: IconProps) =>
  base(
    <>
      <path d="M5.5 4 2 8l3.5 4" />
      <path d="M10.5 4 14 8l-3.5 4" />
    </>,
    props,
  );

/** Review panel tab-strip layout controls (critic round-3 P1 — `10-file-change-expanded`'s
 *  reference ARIA also lists "Split"/"Fullscreen"/"Collapse right sidebar" at the tab-strip level,
 *  distinct from the toolbar's list/split/code *view* toggles below it). */
export const FullscreenIcon = (props: IconProps) =>
  base(
    <>
      <path d="M5.5 2H2v3.5M10.5 2H14v3.5M5.5 14H2v-3.5M10.5 14H14v-3.5" />
    </>,
    props,
  );

/** Usage pass U3: the per-workspace "Workspace actions" disclosure (three-dot). */
export const MoreIcon = (props: IconProps) =>
  base(
    <>
      <circle cx="3.2" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>,
    props,
  );
