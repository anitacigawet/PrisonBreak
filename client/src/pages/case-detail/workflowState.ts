import type { CasePhase } from "./types";

/** Current record/fact validity outranks any cached research result. */
export function deriveCasePhase(input: {
  hasDocuments: boolean; hasFacts: boolean; analyzing: boolean; growing: boolean;
  petals: Array<{ status: string }>; expectedPetals: number;
}): CasePhase {
  if (input.analyzing) return "analyzing";
  if (!input.hasFacts) return input.hasDocuments ? "analyze" : "upload";
  if (input.growing) return "growing";
  if (input.petals.length === input.expectedPetals && input.expectedPetals > 0 &&
    input.petals.every(p => p.status === "completed" || p.status === "skipped")) return "bloomed";
  return "grow";
}

export function replacePetalSnapshot<T extends { key: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map(row => [row.key, row]));
}

/** Query caches are independent: refreshing the flower alone cannot invalidate
 * the mounted trial result or printable handoff. Clear both before refetching. */
export async function refreshResearchOutputCaches(actions: {
  clearTrial: () => void; clearHandoff: () => void;
  refreshPetals: () => Promise<unknown>; refreshTrial: () => Promise<unknown>; refreshHandoff: () => Promise<unknown>;
}): Promise<void> {
  actions.clearTrial();
  actions.clearHandoff();
  await Promise.all([actions.refreshPetals(), actions.refreshTrial(), actions.refreshHandoff()]);
}
