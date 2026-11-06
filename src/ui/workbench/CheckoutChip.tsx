// The composer's Task-checkout control (J-CHECKOUT): where this conversation's Task actually
// works. The association is read from the public `task-checkout-bindings` projection (the event
// log is the truth); live facts (dirty? ahead? merged? folder gone?) come from
// `git.checkout.status`, and every mutation goes through the operator-only `git.checkout.*`
// capabilities so their refusals — RUNNING task, uncommitted work, unmerged branch — reach the
// person verbatim. No action here bypasses the capability layer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import type { Json } from "@godspeedai/cognate-events";
import { canMerge, checkoutStatusText, mergeOutcomeText, suggestBranchName, type BranchListLike } from "../../workbench/checkoutUi.ts";
import type { WorktreeStatus } from "../../workbench/gitOps.ts";
import { errorText } from "./data.ts";

type Notice = { readonly kind: "error" | "warn" | "ok"; readonly text: string } | undefined;

interface BindingRow {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly root: string;
  readonly branch: string;
  readonly kind: "worktree";
}

export interface CheckoutChipProps {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  /** True while a run is active: the capabilities refuse mid-run mutation; say so up front too. */
  readonly locked?: boolean;
}

export function CheckoutChip({ workspaceId, taskId, taskTitle, locked }: CheckoutChipProps) {
  const client = useCognate();
  const rows = useProjection("task-checkout-bindings");
  const binding = useMemo(
    () => (rows ?? []).map((row) => row.value as unknown as BindingRow).find((row) => row.taskId === taskId),
    [rows, taskId],
  );

  const [status, setStatus] = useState<WorktreeStatus | undefined>();
  const [branches, setBranches] = useState<BranchListLike | undefined>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(undefined);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const invoke = useCallback(
    async <T,>(capability: string, input: unknown): Promise<T> =>
      (await client.invoke(capability, JSON.parse(JSON.stringify(input ?? null)) as Json)) as unknown as T,
    [client],
  );

  const refresh = useCallback(async () => {
    if (!binding) {
      setStatus(undefined);
      return;
    }
    try {
      setStatus(await invoke<WorktreeStatus>("git.checkout.status", { taskId }));
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
  }, [binding, invoke, taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openForm = async (existing?: BindingRow) => {
    setName(existing ? existing.branch.replace(/^workbench\//, "") : suggestBranchName(taskTitle, taskId));
    setBase("");
    setNotice(undefined);
    setOpen(true);
    try {
      const list = await invoke<BranchListLike>("git.branch.list", { workspaceId });
      setBranches(list);
      setBase(list.default);
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
  };

  const finalName = name.trim().startsWith("workbench/") ? name.trim() : `workbench/${name.trim()}`;
  const alreadyExists = branches?.branches.includes(finalName) ?? false;

  const attach = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const target = finalName;
      if (binding && binding.branch === target) {
        // Same branch: repair the checkout in place rather than stacking a second worktree.
        if (!status?.exists) await invoke("git.checkout.recreate", { taskId });
      } else {
        if (binding) {
          // Moving the task: retire the old checkout first. The capability refuses (and keeps
          // everything) while it holds uncommitted work, which is exactly the safety we want.
          await invoke("git.checkout.remove", { taskId, deleteBranch: true });
        }
        await invoke("git.checkout.attach", {
          taskId,
          branch: name.trim(),
          ...(base && !alreadyExists ? { base } : {}),
          ...(alreadyExists ? { existing: true } : {}),
        });
      }
      setOpen(false);
      setNotice({ kind: "ok", text: `This task now works in ${target}.` });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const merge = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await invoke<{ conflicted?: boolean; conflicts?: readonly string[]; target?: string; commits?: number }>(
        "git.checkout.merge",
        { taskId },
      );
      setNotice(mergeOutcomeText(result));
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const remove = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await invoke<{ branchDeleted?: boolean }>("git.checkout.remove", { taskId, deleteBranch: true });
      setConfirmRemove(false);
      if (result.branchDeleted) setNotice({ kind: "ok", text: "Checkout removed and its merged branch deleted." });
      else setNotice({ kind: "ok", text: "Checkout removed; the branch was kept because it has unmerged commits." });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const recreate = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      await invoke("git.checkout.recreate", { taskId });
      setNotice({ kind: "ok", text: "Checkout recreated from its branch." });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const blocked = locked || busy;

  return (
    <span className="wb-checkout">
      {binding ? (
        <>
          <span className="wb-chip wb-checkout-chip" title={binding.root}>
            <span className="wb-chip-label">Checkout</span>
            <span className="wb-chip-value">{binding.branch}</span>
          </span>
          <span className="wb-muted">{status ? checkoutStatusText(status) : "…"}</span>
          {status && !status.exists && (
            <button type="button" className="wb-btn" onClick={() => void recreate()} disabled={blocked}>
              Recreate
            </button>
          )}
          <button type="button" className="wb-btn" onClick={() => void openForm(binding)} disabled={blocked}>
            Change
          </button>
          <button type="button" className="wb-btn" onClick={() => void merge()} disabled={blocked || !canMerge(status)}>
            Merge into {branches?.default ?? "main"}
          </button>
          {confirmRemove ? (
            <>
              <span className="wb-muted">Remove this checkout? Uncommitted work would block it.</span>
              <button type="button" className="wb-btn" onClick={() => void remove()} disabled={blocked}>
                Confirm
              </button>
              <button type="button" className="wb-btn" onClick={() => setConfirmRemove(false)} disabled={busy}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="wb-btn" onClick={() => setConfirmRemove(true)} disabled={blocked}>
              Remove
            </button>
          )}
        </>
      ) : (
        <button type="button" className="wb-btn" onClick={() => void openForm()} disabled={blocked}>
          Isolate in a worktree…
        </button>
      )}
      {open && (
        <span className="wb-checkout-form" role="dialog" aria-label="Task checkout">
          <label>
            Branch
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={suggestBranchName(taskTitle, taskId)}
              aria-label="Branch name"
            />
          </label>
          {alreadyExists ? (
            <span className="wb-muted">This branch already exists; it will be adopted as the task&apos;s checkout.</span>
          ) : (
            <label>
              Start from
              <select value={base} onChange={(event) => setBase(event.currentTarget.value)} aria-label="Start from branch">
                {(branches?.branches ?? []).map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                    {branch === branches?.default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="wb-muted">Created as {finalName} beside the repository; this conversation&apos;s turns then run there.</span>
          <button type="button" className="wb-btn primary" onClick={() => void attach()} disabled={busy || name.trim().length === 0}>
            {binding ? "Move the task" : "Create checkout"}
          </button>
          <button type="button" className="wb-btn" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        </span>
      )}
      {notice && (
        <span className={notice.kind === "error" ? "wb-error" : notice.kind === "warn" ? "wb-warn" : "wb-muted"} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </span>
      )}
    </span>
  );
}
