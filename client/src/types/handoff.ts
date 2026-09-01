/**
 * Client-side mirror of the DefenderHandoff shape from
 * server/orchestrator/types.ts. Hand-mirrored (not auto-generated)
 * because the client tree intentionally stays scoped away from server
 * type imports.
 *
 * If you change the server shape, update this file too.
 */

export interface HandoffQuestion {
  question: string;
  whyAsking: string;
  citationId: string;
  sourceLabel: string;
  locator: string | null;
  sourceUrl: string | null;
  whatYesMeans: string;
  whatNoMeans: string;
  /** True if post-translator verification found the quoted passage
   *  verbatim in the named source file. Absent on handoffs persisted
   *  before the verifier shipped. */
  verified?: boolean;
  /** Short note explaining what verification flagged, when `verified === false`. */
  verificationNote?: string;
}

export interface DefenderHandoff {
  caseHeader: string;
  questions: HandoffQuestion[];
  openQuestion: string;
  disclaimer: string;
}
