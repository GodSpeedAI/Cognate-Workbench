import { useEffect, useState } from "react";

export type RuntimeExecutionInspection =
  | { readonly configuredCapacity: 1; readonly admissionPolicy: "serial" }
  | { readonly configuredCapacity: 2 | 4 | 8; readonly admissionPolicy: "model-only-parallel" };

function isInspection(value: unknown): value is RuntimeExecutionInspection {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (record.configuredCapacity === 1 && record.admissionPolicy === "serial")
    || ([2, 4, 8].includes(record.configuredCapacity as number) && record.admissionPolicy === "model-only-parallel");
}

export function RuntimeExecutionStatus({ inspect }: { readonly inspect: () => Promise<unknown> }) {
  const [inspection, setInspection] = useState<RuntimeExecutionInspection>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    setInspection(undefined);
    setUnavailable(false);
    void inspect().then((result) => {
      if (!active) return;
      if (!isInspection(result)) throw new Error("Invalid runtime inspection response");
      setInspection(result);
    }).catch(() => {
      if (active) setUnavailable(true);
    });
    return () => { active = false; };
  }, [inspect]);

  return <section className="experts-section" aria-labelledby="runtime-execution-heading">
    <div className="experts-section-head">
      <div>
        <p className="experts-eyebrow">Host startup configuration</p>
        <h2 id="runtime-execution-heading">Native execution capacity</h2>
      </div>
      <span className="experts-status">Read-only · COGNATE_RUN_CAPACITY</span>
    </div>
    {inspection ? inspection.configuredCapacity === 1 ? <>
      <p>Configured capacity: 1 run at a time</p>
      <p className="experts-muted">Runs are serialized by the host runtime.</p>
    </> : <>
      <p>Configured capacity: {inspection.configuredCapacity} concurrent runs</p>
      <p className="experts-muted">Model-only solo Experts and Team Specialists may overlap up to this capacity.</p>
      <p className="experts-muted">Tool-bearing Experts, Team Orchestrators and coding sessions share a serialized admission group.</p>
    </> : unavailable ? <p role="status">Runtime capacity unavailable. This server did not provide a valid execution inspection.</p>
      : <p role="status">Reading host runtime capacity…</p>}
  </section>;
}
