// Builds the phone bundle from its own entry (never the desktop bundle) plus the stylesheet: the shared
// design tokens from app.css, then mobile.css.
import { fileURLToPath } from "node:url";

export async function buildPhoneAssets(appCss: string): Promise<{ js: string; css: string }> {
  const entry = fileURLToPath(new URL("../ui/mobile/entry.tsx", import.meta.url));
  const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true });
  if (!build.success) throw new Error(`remote: failed to bundle the phone UI: ${build.logs.map((log) => String(log)).join("; ")}`);
  const mobileCss = await Bun.file(fileURLToPath(new URL("../ui/mobile/mobile.css", import.meta.url))).text();
  return { js: await build.outputs[0]!.text(), css: `${appCss}\n${mobileCss}` };
}
