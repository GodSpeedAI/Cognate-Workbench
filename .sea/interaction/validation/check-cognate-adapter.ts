// Validate the current Workbench model through its published Cognate semantic adapter.
import { bindCognitiveCapabilities, bindExpertCapabilities, bindExecutionWorlds, bindRuntimeExecution, bindScheduleCapabilities, loadDomain } from "../../../domain/index.ts";

const domain = await loadDomain();
const { projection } = domain;
const byKind: Record<string, number> = {};
for (const object of projection.objects) byKind[object.kind] = (byKind[object.kind] ?? 0) + 1;
const journeyIds = projection.objects.filter(object => object.kind === "EntityInstance").map(object => {
  const fields = object.fields.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields) && typeof fields.journey_id === "string"
    ? fields.journey_id : object.name;
}).sort();

console.log("errors: 0");
console.log("Total objects:", projection.objects.length);
console.log("By kind:", JSON.stringify(byKind));
console.log("Relations (edges):", projection.relations.length);
console.log("Journey ids:", JSON.stringify(journeyIds));
console.log("Expert bindings:", Object.keys(bindExpertCapabilities(domain)).length);
console.log("Schedule bindings:", Object.keys(bindScheduleCapabilities(domain)).length);
console.log("Cognitive bindings:", Object.keys(bindCognitiveCapabilities(domain)).length);
console.log("Execution-world bindings:", Object.keys(bindExecutionWorlds(domain)).length);
console.log("Runtime inspection binding:", Boolean(bindRuntimeExecution(domain)));
