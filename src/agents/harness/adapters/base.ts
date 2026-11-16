// Shared driver plumbing: text boundary handling and a pending-request table.
import type { DriverIo, TurnConfig } from "../types.ts";

export abstract class BaseDriver {
  private hasText = false;
  protected get anyText(): boolean { return this.hasText; }
  private boundary = false;

  constructor(protected readonly config: TurnConfig, protected readonly io: DriverIo) {}

  /** Streams assistant text; a tool boundary since the last text becomes a paragraph break. */
  protected text(delta: string): void {
    if (!delta) return;
    const prefix = this.boundary && this.hasText ? "\n\n" : "";
    this.boundary = false;
    this.hasText = true;
    this.io.push({ kind: "text", text: prefix + delta });
  }

  protected markBoundary(): void {
    this.boundary = true;
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
