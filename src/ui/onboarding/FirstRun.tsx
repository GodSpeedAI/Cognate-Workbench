// First-run flow: 1 Welcome -> 2 Model (full ProviderWizard) -> 3 Folder. Durable state is only the
// two existing `onboarding.dismiss` steps ("notice", "apikey"); the step shown is derived from
// them plus the model-config and workspace projections, with a local override for Back.
// Configure later / X / Esc dismiss what is left and land on the app's own empty state.
import { useCallback, useRef, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import { DirectoryField } from "../DirectoryField.tsx";
import { DialogHeader } from "../shell/DialogHeader.tsx";
import { useModalFocus } from "../shell/useModalFocus.ts";
import { useToast } from "../shell/Toast.tsx";
import { ProviderWizard } from "../models/ProviderWizard.tsx";
import { capabilityErrorMessage } from "../models/providerCatalog.ts";

type Step = "welcome" | "model" | "folder";
const STEPS: readonly { readonly id: Step; readonly label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "model", label: "Model" },
  { id: "folder", label: "Folder" },
];

function StepIndicator({ current }: { readonly current: Step }) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="fr-steps" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className={i === at ? "current" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="fr-step-num">{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function FirstRunFlow({
  noticeDismissed,
  apikeyDismissed,
  hasModel,
  hasWorkspace,
  recent,
  onFinished,
}: {
  /** `undefined` while the onboarding projection has not loaded (render nothing: no flash). */
  readonly noticeDismissed: boolean | undefined;
  readonly apikeyDismissed: boolean;
  readonly hasModel: boolean;
  readonly hasWorkspace: boolean;
  readonly recent?: readonly string[];
  /** The flow ended with a working setup; the app should focus the composer. */
  readonly onFinished: () => void;
}) {
  const client = useCognate();
  const [override, setOverride] = useState<Step | undefined>(undefined);
  const [folderWanted, setFolderWanted] = useState(false);
  const [folderDone, setFolderDone] = useState(false);

  const dismiss = useCallback((step: "notice" | "apikey") => client.invoke("onboarding.dismiss", { step }).catch(() => undefined), [client]);

  let step: Step | undefined;
  if (noticeDismissed === undefined) step = undefined;
  else if (override) step = override;
  else if (!noticeDismissed) step = "welcome";
  else if (!apikeyDismissed && !hasModel) step = "model";
  else if ((folderWanted || (!apikeyDismissed && hasModel)) && !hasWorkspace && !folderDone) step = "folder";
  if (!step) return null;

  const closeAll = () => {
    if (!noticeDismissed) void dismiss("notice");
    if (!apikeyDismissed) void dismiss("apikey");
    setOverride(undefined);
    setFolderWanted(false);
    setFolderDone(true);
  };

  const afterModel = () => {
    void dismiss("apikey");
    if (hasWorkspace) {
      setOverride(undefined);
      onFinished();
    } else {
      setOverride("folder");
      setFolderWanted(true);
    }
  };

  const welcomeContinue = () => {
    if (!noticeDismissed) void dismiss("notice");
    if (!hasModel && !apikeyDismissed) setOverride("model");
    else if (!hasWorkspace) {
      setOverride("folder");
      setFolderWanted(true);
    } else setOverride(undefined);
  };

  return (
    <FirstRunFrame
      step={step}
      onClose={closeAll}
      onBack={step === "model" ? () => setOverride("welcome") : step === "folder" ? () => setOverride("model") : undefined}
    >
      {step === "welcome" && <WelcomeStep onContinue={welcomeContinue} />}
      {step === "model" && (
        <>
          <p className="fr-lead">
            Cognate needs a model to think with. Pick a provider, add its key, and choose a model. The key stays on this computer.
          </p>
          <ProviderWizard
            autoFocus
            submitLabel="Save and continue"
            cancelLabel={hasModel ? "Keep current model" : "Configure later"}
            onCancel={hasModel ? () => (hasWorkspace ? closeAll() : (setOverride("folder"), setFolderWanted(true))) : closeAll}
            onSaved={afterModel}
          />
        </>
      )}
      {step === "folder" && (
        <FolderStep
          recent={recent}
          onChosen={() => {
            setFolderDone(true);
            setOverride(undefined);
            setFolderWanted(false);
            onFinished();
          }}
          onSkip={closeAll}
        />
      )}
    </FirstRunFrame>
  );
}

function FirstRunFrame({
  step,
  onClose,
  onBack,
  children,
}: {
  readonly step: Step;
  readonly onClose: () => void;
  readonly onBack: (() => void) | undefined;
  readonly children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  const title = step === "welcome" ? "Welcome to Cognate Console" : step === "model" ? "Connect a model provider" : "Choose a folder to work in";
  return (
    <div className="modal-backdrop">
      <div
        key={step}
        className={step === "model" ? "modal first-run-dialog first-run-wide" : "modal first-run-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-heading"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="fr-head">
          <StepIndicator current={step} />
          <DialogHeader title={title} titleId="first-run-heading" closeLabel="setup" onClose={onClose} />
          {onBack && (
            <button type="button" className="fr-back" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function WelcomeStep({ onContinue }: { readonly onContinue: () => void }) {
  return (
    <>
      <p>
        Cognate Console runs a coding agent on your own workspace. It can read and edit files, run commands and execute code for you,
        and every action shows in the transcript as it happens.
      </p>
      <p>Anything irreversible pauses for your approval first. This build is under active development, so expect rough edges.</p>
      <div className="modal-actions">
        <button type="button" className="pw-primary" data-autofocus onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  );
}

function FolderStep({ recent, onChosen, onSkip }: { readonly recent: readonly string[] | undefined; readonly onChosen: () => void; readonly onSkip: () => void }) {
  const client = useCognate();
  const toast = useToast();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      await client.invoke("workspace.select", { path });
      toast.show("Workspace added");
      onChosen();
    } catch (err) {
      setError(capabilityErrorMessage(err));
      setBusy(false);
    }
  }, [client, path, toast, onChosen]);
  return (
    <>
      <p className="fr-lead">Cognate runs sessions inside a folder on this computer. Pick the project you want to work on; you can add more later.</p>
      <DirectoryField
        worldId="local"
        label="Workspace directory path"
        placeholder="/path/to/project"
        value={path}
        onChange={setPath}
        invoke={(capability, input) => client.invoke(capability as never, input as never) as unknown as Promise<unknown>}
        onSubmit={() => {
          if (path.trim() && !busy) void submit();
        }}
        autoFocus
        {...(recent ? { recent } : {})}
        hint="Type a folder path. Matching folders appear as you type."
      />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onSkip}>
          Choose later
        </button>
        <button type="button" className="pw-primary" disabled={busy || path.trim().length === 0} onClick={() => void submit()}>
          {busy ? "Opening…" : "Open folder"}
        </button>
      </div>
    </>
  );
}
