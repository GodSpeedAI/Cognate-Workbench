// Mount once under <InspectorProvider>:
//   <InspectorExtraTabs workspaceId={workspaceId} workspaceName={workspaceName} />
// Registers the Files (order 40) and Config (order 50) tabs. State lives here, so it survives the
// tab content being portalled only while selected. The Settings page opens the config editor with
//   const { openInspector } = useInspector(); openInspector("config");
import { useCallback } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import { ConfigTab } from "./ConfigTab.tsx";
import { FilesTab, type Invoke } from "./FilesTab.tsx";

export function InspectorExtraTabs({ workspaceId, workspaceName, invoke }: { readonly workspaceId: string | undefined; readonly workspaceName?: string | undefined; readonly invoke?: Invoke }) {
  const client = useCognate();
  const real = useCallback<Invoke>((cap, input) => client.invoke(cap as never, input as never) as unknown as Promise<unknown>, [client]);
  const fn = invoke ?? real;
  return (
    <>
      <FilesTab invoke={fn} workspaceId={workspaceId} workspaceName={workspaceName} />
      <ConfigTab invoke={fn} />
    </>
  );
}
