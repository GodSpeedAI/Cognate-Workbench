import type { Projection } from "@godspeedai/cognate-projections";
import type { ModelConfig } from "../components/providerRegistry.ts";

/**
 * Public projection `provider-routes`: one row per stored provider, key `provider:<providerId>`
 * (tenant-relative as `readProjection` returns it). Row shape, no secret and no key state:
 *
 *   { providerId, baseURL, protocol, model, displayName?, auth?, apiVersion?, prices? }
 *
 * Whether a key is stored and which route is active are not event facts, so the `provider.list`
 * capability adds `hasKey` / `isCurrent` for the settings list. Secrets remain in the SecretStore.
 */
export const providerRoutesProjection: Projection = {
  name:"provider-routes",version:"1.1.0",
  apply(event){
    const payload=event.payload as unknown as ModelConfig;
    if(event.eventType==="provider.deleted")return [{key:`${event.tenant}/provider:${payload.providerId}`,value:null}];
    if(event.eventType!=="model.configured")return [];
    return [{key:`${event.tenant}/provider:${payload.providerId}`,value:{
      providerId:payload.providerId,baseURL:payload.baseURL,protocol:payload.protocol,model:payload.model,
      ...(payload.displayName?{displayName:payload.displayName}:{}),
      ...(payload.auth?{auth:payload.auth}:{}),
      ...(payload.apiVersion?{apiVersion:payload.apiVersion}:{}),
      ...(payload.prices?{prices:payload.prices}:{}),
    }}];
  },
};
