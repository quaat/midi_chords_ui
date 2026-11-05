import type { ConceptDefinition } from "@/model/contracts";
import { foundationConcepts } from "@/content/concepts/foundations";
import { harmonyConcepts } from "@/content/concepts/harmony";
import { scalesModesConcepts } from "@/content/concepts/scalesModes";
import { techniqueConcepts } from "@/content/concepts/technique";

export { foundationConcepts, harmonyConcepts, scalesModesConcepts, techniqueConcepts };

export const concepts: ConceptDefinition[] = [...foundationConcepts, ...harmonyConcepts, ...scalesModesConcepts, ...techniqueConcepts];
