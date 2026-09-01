/**
 * Orchestrator types — Phase 2 of the architecture.
 *
 * Three personas (prosecutor / defender / synthesizer) run sequentially
 * over the uploaded-case + retained-research corpora to produce the Take-to-
 * Trial assessment. See docs/ARCHITECTURE.md for the public design overview.
 *
 * NOTE: The synthesizer persona references Max Wertheimer's *Productive
 * Thinking* (1945). Verbatim passages are TODO — see
 * server/orchestrator/personas/synthesizer.md for the marker. The
 * orchestrator runs without them (the rest of the synthesizer prompt is
 * principled enough to function); Wertheimer just makes the persona's
 * structural-comparison discipline enforceable rather than vibes.
 */

/** Provider abstraction — Claude or OpenAI behind a single interface. */
export type LLMProviderId = "anthropic" | "openai";

export interface OrchestratorSettings {
  provider: LLMProviderId;
  model: string;
  /** Per-provider API keys. Read at request time from settings.json. */
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

/** One of the three pass identities. */
export type PassId = "prosecutor" | "defender" | "synthesizer";

/** Tool surface exposed to the LLM during a pass. */
export type ToolId = "queryCase" | "queryPetal";

/** Stage events streamed via socket.io to the case room. The frontend
 *  visualization (construction tape + thinking stream) renders these
 *  in real time. Every entry corresponds to an actual backend
 *  transition — no cosmetic timer-driven phases.
 *
 *  Lifecycle:
 *    start →
 *      (pass-start, tool-call, tool-result, pass-end)*  →
 *    complete | error
 */
export type TrialStageEvent =
  | { kind: "start" }
  | { kind: "pass-start"; pass: PassId; label: string }
  | { kind: "tool-call"; pass: PassId; tool: ToolId; query: string; target?: string }
  | { kind: "tool-result"; pass: PassId; tool: ToolId; preview: string }
  | { kind: "pass-end"; pass: PassId }
  | { kind: "complete"; verdict: TrialVerdict }
  | { kind: "error"; message: string };

/** A single grounded claim inside a pass output. Every populated claim
 *  must carry at least one server-generated citation ID and passage. The
 *  synthesizer's job is to compare claims across passes; claims without
 *  citations are dropped from the comparison. */
export interface GroundedClaim {
  /** Short identifier for the element / element-part this claim concerns. */
  about: string;
  /** The reading's assertion about that element, in one to two sentences. */
  text: string;
  /** Provenance — every populated claim should have at least one. */
  citations: Array<{
    citationId: string;
    sourceLabel: string;
    passage: string;
    locator: string | null;
    sourceUrl: string | null;
  }>;
}

export interface ProsecutorReading {
  pass: "prosecutor";
  elementsByCharge: Array<{
    charge: string;
    elements: Array<{
      element: string;
      establishingClaims: GroundedClaim[];
    }>;
  }>;
  admissibilityClaims: GroundedClaim[];
  procedure: GroundedClaim[];
}

export interface DefenderReading {
  pass: "defender";
  elementsByCharge: Array<{
    charge: string;
    elements: Array<{
      element: string;
      /** "missing", "weak", "contestable", "suppressible" — defender's
       *  characterization of the prosecution's case for this element. */
      assessment: string;
      contestingClaims: GroundedClaim[];
    }>;
  }>;
  availableMotions: GroundedClaim[];
  proceduralFailures: GroundedClaim[];
}

/** The synthesizer's output — NOT a probability, NOT an average. A map of
 *  where the case structurally turns. Verifiable line by line. */
export interface TrialVerdict {
  /** Findings both readings agree on (uncontested = either both agree the
   *  prosecution has it, or both agree the prosecution doesn't). */
  uncontested: Array<{
    finding: string;
    citations: GroundedClaim["citations"];
  }>;
  /** Structural pivots — single inferences, single rulings, single
   *  interpretive choices the case turns on. Wertheimer-style "the
   *  re-organization point." */
  pivots: Array<{
    description: string;
    prosecutorPosition: GroundedClaim;
    defenderPosition: GroundedClaim;
    /** What kind of disagreement — affects how a judge / jury would
     *  resolve it. */
    kind: "interpretation" | "admissibility" | "sufficiency" | "precedent" | "credibility";
    /** Legal weight of the pivot (NOT actionability — those can diverge).
     *  Used by the translator pass to rank handoff questions, and by the
     *  verdict reveal for visual emphasis. */
    strength: "strong" | "moderate" | "speculative";
  }>;
  /** Claims the prosecution needs but cannot ground from the record,
   *  OR claims the defense has flagged as missing. */
  unsupported: Array<{
    finding: string;
    note: string;
  }>;
  /** One paragraph plain-English summary written for a defendant, not a
   *  judge. Cited claims appear as inline references to the pivots /
   *  uncontested arrays above. */
  summary: string;
}

/** The shape persisted to the database and returned by the
 *  `getTrialResult` query. */
export interface TrialResult {
  caseId: number;
  prosecutor: ProsecutorReading;
  defender: DefenderReading;
  verdict: TrialVerdict;
  /** ISO timestamp. */
  completedAt: string;
  /** Provider + model used, for audit. */
  provider: LLMProviderId;
  model: string;
}

/** Defender Handoff — single-page printable artifact for the public
 *  defender. Generated by the translator pass (4th persona) over a
 *  cached TrialVerdict + caseFacts. Persisted alongside the verdict.
 *  See docs/ARCHITECTURE.md for the design rationale. */
export interface HandoffQuestion {
  /** The question itself — ends with "?". */
  question: string;
  /** Includes a verbatim quoted passage from the cited source. */
  whyAsking: string;
  /** Stable Qdrant citation carried through from the selected pivot. */
  citationId: string;
  /** Exact uploaded filename from the case's documents. */
  sourceLabel: string;
  /** Page, line, paragraph, table cell, or HTML block. */
  locator: string | null;
  /** Present when the citation came from retained web research. */
  sourceUrl: string | null;
  /** One-sentence "if yes, this means X for me." */
  whatYesMeans: string;
  /** One-sentence "if no, this means Y for me." */
  whatNoMeans: string;
  /** Set by the post-translator verifier: true if the quoted passage in
   *  `whyAsking` was found verbatim in the named source file (after
   *  whitespace/punctuation normalization). Optional — absent on legacy
   *  handoffs persisted before the verifier shipped. */
  verified?: boolean;
  /** When `verified === false`, a short note explaining what failed
   *  (e.g. "no quoted passage found", "passage not in source"). */
  verificationNote?: string;
}

export interface DefenderHandoff {
  /** 1-2 sentence formal case identification (templated from caseFacts). */
  caseHeader: string;
  /** Up to 3 prioritized questions. */
  questions: HandoffQuestion[];
  /** Modest catch-all sentence inviting the PD to flag what's missing. */
  openQuestion: string;
  /** Boilerplate AI-assistance disclaimer. */
  disclaimer: string;
}
