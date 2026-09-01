/**
 * Petals — source-grounded web-research domains.
 * See docs/ARCHITECTURE.md for the public design overview.
 */
import type { Case } from "../../drizzle/schema";
import type { CaseFacts } from "../../shared/caseFacts";

/** Stable identifier for each petal. */
export type PetalKey =
  | "core"           // Center: the uploaded case corpus
  | "laws"           // Jurisdictional statutes
  | "jurisprudence"  // Controlling case law
  | "procedural"     // Court rules / posture
  | "patterns"       // Conviction rates, sentencing patterns, judge tendencies
  | "demographics"   // Jury pool / census data
  | "forensics"      // NAS/PCAST reliability literature (conditional)
  | "id_confession"  // EM/FC science (conditional)
  | "cost";          // Trial cost profile

/** Status mirrors the casePetals.status enum in the schema. */
export type PetalStatus = "pending" | "building" | "completed" | "failed" | "skipped";

export interface PetalSpec {
  key: PetalKey;
  /** Human-facing label shown in the UI. */
  label: string;
  /** Short description shown in the side panel when this petal is active. */
  description: string;
  /**
   * Decide whether this petal applies to the given case. Conditional
   * petals (forensics, id_confession) inspect the case + its analysis
   * results and may return `{ apply: false, reason: ... }` to skip.
   */
  applicability: (
    caseRow: Case,
    facts: CaseFacts | null,
  ) => Promise<{ apply: true } | { apply: false; reason: string }>;
  /**
   * Build the narrow, non-identifying question sent to the selected local
   * Codex/Claude CLI. The CLI discovers primary sources; PrisonBreak then
   * fetches, snapshots, and indexes those sources itself.
   */
  researchQuery: (caseRow: Case, facts: CaseFacts | null) => string;
}

export interface PetalProgress {
  key: PetalKey;
  label: string;
  description: string;
  status: PetalStatus;
  /** 0..100 fill bar percent. */
  progress: number;
  summary: string | null;
  reasonSkipped: string | null;
  errorMessage: string | null;
  corpusKey: string | null;
  sourceCount: number;
}
