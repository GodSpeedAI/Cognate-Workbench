// Builds the phone bundle from its own entry (never the desktop bundle) plus the stylesheet: the shared
// design tokens from app.css, then mobile.css. A packaged build ships the prebuilt bundle instead.
import { fileURLToPath } from "node:url";
import { packaged, resourcePath } from "../resources.ts";

export async function buildPhoneAssets(appCss: string): Promise<{ js: string; css: string }> {
  const mobileCss = await Bun.file(packaged ? resourcePath("src", "ui", "mobile", "mobile.css") : fileURLToPath(new URL("../ui/mobile/mobile.css", import.meta.url))).text();
  if (packaged) return { js: await Bun.file(resourcePath("dist", "web", "phone.js")).text(), css: `${appCss}\n${mobileCss}` };
  const entry = fileURLToPath(new URL("../ui/mobile/entry.tsx", import.meta.url));
  const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true });
  if (!build.success) throw new Error(`remote: failed to bundle the phone UI: ${build.logs.map((log) => String(log)).join("; ")}`);
  return { js: await build.outputs[0]!.text(), css: `${appCss}\n${mobileCss}` };
}
