// Phone entry: a separate bundle from the desktop (see src/remote/assets.ts).
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(<MobileApp />);
