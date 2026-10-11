import { loadSemanticProjection } from "/home/sprime01/projects/cognate/packages/domainforge/src/index.ts";
import { readFileSync } from "node:fs";

const path = "/home/sprime01/projects/cognate/validation/reconstructions/deepseek-harness/cognate/.sea/interaction/interaction-model.sea";
const source = readFileSync(path, "utf8");
const { projection, errors } = loadSemanticProjection(source, { uri: `file://${path}` });

console.log("errors:", errors?.length ?? 0);
if (errors && errors.length > 0) {
  console.log(JSON.stringify(errors, null, 2));
  process.exit(1);
}

const byKind: Record<string, number> = {};
for (const obj of projection.objects) byKind[obj.kind] = (byKind[obj.kind] ?? 0) + 1;

console.log("Total objects:", projection.objects.length);
console.log("By kind:", JSON.stringify(byKind, null, 2));
console.log("Relations (edges):", projection.relations?.length ?? 0);

const journeyIds = projection.objects
  .filter((o: any) => o.kind === "EntityInstance")
  .map((o: any) => o.fields?.fields?.journey_id ?? o.name)
  .sort();
console.log("Journey ids (20 expected: 10 product + 10 Remote Workspaces):", JSON.stringify(journeyIds, null, 2));
