// react-dom probes `window` once, at import time; a copy loaded without a DOM has its input/change
// event plugin disabled for the whole process. Every test file shares one process, so a non-DOM test
// that imports react-dom first would break every later DOM test. Load it here, with a DOM present.
import { registerDom, releaseDom } from "./dom-env.ts";

registerDom();
await import("react-dom");
await import("react-dom/client");
await releaseDom();
