/** Fail-closed citation propagation across analysis passes. */
import type { DefenderHandoff } from "./types";
import { allQuotesMatch } from "./quotations";
export interface GroundedCitationValue {
  citationId: string;
  sourceLabel: string;
  passage: string;
  locator: string | null;
  sourceUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function collectGroundedCitations(value: unknown): GroundedCitationValue[] {
  // Retain every occurrence. Deduplicating before validation hides an altered
  // copy when a later, valid copy has the same ID.
  const found: GroundedCitationValue[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isRecord(current)) return;
    if (
      typeof current.citationId === "string" &&
      typeof current.sourceLabel === "string" &&
      typeof current.passage === "string"
    ) {
      found.push({
        citationId: current.citationId,
        sourceLabel: current.sourceLabel,
        passage: current.passage,
        locator: typeof current.locator === "string" ? current.locator : null,
        sourceUrl: typeof current.sourceUrl === "string" ? current.sourceUrl : null,
      });
    }
    Object.values(current).forEach(visit);
  };
  visit(value);
  return found;
}

export function citationMap(allowed: Iterable<GroundedCitationValue>): Map<string, GroundedCitationValue> {
  const result = new Map<string, GroundedCitationValue>();
  for (const item of allowed) {
    const previous = result.get(item.citationId);
    if (previous && !sameCitation(previous, item)) {
      throw new Error(`Conflicting retained evidence for citation ${item.citationId}.`);
    }
    result.set(item.citationId, item);
  }
  return result;
}

function sameCitation(left: GroundedCitationValue, right: GroundedCitationValue): boolean {
  return left.sourceLabel === right.sourceLabel && left.passage === right.passage &&
    left.locator === right.locator && left.sourceUrl === right.sourceUrl;
}

export function assertGroundedCitations(
  value: unknown,
  allowed: Iterable<GroundedCitationValue>,
  label: string,
): void {
  const allowedMap = citationMap(allowed);
  for (const citation of collectGroundedCitations(value)) {
    const canonical = allowedMap.get(citation.citationId);
    if (!canonical) {
      throw new Error(`${label} emitted citation ${citation.citationId} without retrieving it.`);
    }
    if (!sameCitation(citation, canonical)) {
      throw new Error(`${label} altered the server-owned fields for citation ${citation.citationId}.`);
    }
  }
}

/** Handoff questions have whyAsking rather than passage; validate explicitly. */
export function assertHandoffCitations(
  handoff: DefenderHandoff,
  allowed: Iterable<GroundedCitationValue>,
): void {
  const retained = citationMap(allowed);
  for (const question of handoff.questions) {
    const canonical = retained.get(question.citationId);
    if (!canonical) throw new Error("Handoff question cites evidence absent from the verdict.");
    if (question.sourceLabel !== canonical.sourceLabel ||
        question.locator !== canonical.locator || question.sourceUrl !== canonical.sourceUrl) {
      throw new Error("Handoff question altered server-owned citation metadata.");
    }
    if (!allQuotesMatch(question.whyAsking, canonical.passage)) {
      throw new Error("Every quoted handoff passage must match its retained citation.");
    }
  }
}
