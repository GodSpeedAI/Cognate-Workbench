// Print the PE optional-header Subsystem of each executable: 2 = WINDOWS_GUI (no console), 3 = WINDOWS_CUI (console).
//   bun scripts/check-pe-subsystem.ts <exe>...
import { open } from "node:fs/promises";

export async function peSubsystem(file: string): Promise<number> {
  const handle = await open(file, "r");
  try {
    const dos = Buffer.alloc(64);
    await handle.read(dos, 0, 64, 0);
    if (dos.toString("latin1", 0, 2) !== "MZ") throw new Error(`${file}: not a PE file`);
    const peOffset = dos.readUInt32LE(0x3c);
    const head = Buffer.alloc(24 + 70);
    await handle.read(head, 0, head.length, peOffset);
    if (head.toString("latin1", 0, 4) !== "PE\0\0") throw new Error(`${file}: bad PE signature`);
    return head.readUInt16LE(24 + 68); // optional header starts at +24; Subsystem is at offset 68 in PE32 and PE32+
  } finally {
    await handle.close();
  }
}

if (import.meta.main) {
  const names: Record<number, string> = { 2: "WINDOWS_GUI", 3: "WINDOWS_CUI" };
  for (const file of process.argv.slice(2)) {
    const value = await peSubsystem(file);
    console.log(`${file}: Subsystem=${value} (${names[value] ?? "other"})`);
  }
}
