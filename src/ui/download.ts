// Browser-side file download helper (T11): the Settings dialog's "Open configuration file" action
// cannot hand the operator a filesystem handle across the browser/server boundary, so it hands them
// the real bytes instead. Kept separate from the presentational components so the anchor plumbing
// can be exercised without rendering a whole dialog.

/** Writes `text` to the browser's downloads folder as `filename` (UTF-8, with a BOM-free body). */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next task so the click has definitely consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Copies `text` to the clipboard, reporting whether the browser allowed it. Never throws — the
 *  caller shows the path as a fallback when permission is denied. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
