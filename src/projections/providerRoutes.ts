import type { Projection } from "@godspeedai/cognate-projections";
import type { ModelConfig } from "../components/providerRegistry.ts";

/** Safe route catalog; secrets remain in the existing SecretStore. Keeps legacy current route. */
export const providerRoutesProjection: Projection = {
  name:"provider-routes",version:"1.0.0",
  apply(event){
    const payload=event.payload as unknown as ModelConfig;
    if(event.eventType==="provider.deleted")return [{key:`${event.tenant}/provider:${payload.providerId}`,value:null}];
    if(event.eventType!=="model.configured")return [];
    return [{key:`${event.tenant}/provider:${payload.providerId}`,value:{providerId:payload.providerId,baseURL:payload.baseURL,protocol:payload.protocol,model:payload.model}}];
  },
};
