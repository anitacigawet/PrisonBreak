/**
 * Zod schemas for the three pass JSON shapes. Used for:
 *
 *   1. **OpenAI Structured Outputs.** Each schema is converted to JSON
 *      Schema via `z.toJSONSchema` and passed in the response_format so
 *      OpenAI mechanically guarantees the model emits a JSON value that
 *      validates against the schema.
 *
 *   2. **Post-parse runtime validation.** Anthropic doesn't support a
 *      strict-schema response format the way OpenAI does; parsePassJson
 *      validates with Zod after JSON.parse so we still catch shape drift.
 *
 * Schemas mirror the TypeScript interfaces in types.ts. Both are the
 * source of truth at different layers (TS at compile time, Zod at run
 * time). If you change one, change the other.
 */
import { z } from "zod";

/** A single grounded claim. Every populated claim carries at least one
 *  citation. The `sourceLabel` should be one of the case's source
 *  filenames (passed to the pass in its initial message). */
export const GroundedClaimSchema = z
  .object({
    about: z.string(),
    text: z.string(),
    citations: z
      .array(
        z.object({
          citationId: z.string(),
          sourceLabel: z.string(),
          passage: z.string(),
          locator: z.string().nullable(),
          sourceUrl: z.string().url().nullable(),
        }),
      )
      .min(1),
  })
  .strict();

export const ProsecutorReadingSchema = z
  .object({
    pass: z.literal("prosecutor"),
    elementsByCharge: z.array(
      z
        .object({
          charge: z.string(),
          elements: z.array(
            z
              .object({
                element: z.string(),
                establishingClaims: z.array(GroundedClaimSchema),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    admissibilityClaims: z.array(GroundedClaimSchema),
    procedure: z.array(GroundedClaimSchema),
  })
  .strict();

export const DefenderReadingSchema = z
  .object({
    pass: z.literal("defender"),
    elementsByCharge: z.array(
      z
        .object({
          charge: z.string(),
          elements: z.array(
            z
              .object({
                element: z.string(),
                assessment: z.enum(["missing", "weak", "contestable", "suppressible"]),
                contestingClaims: z.array(GroundedClaimSchema),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    availableMotions: z.array(GroundedClaimSchema),
    proceduralFailures: z.array(GroundedClaimSchema),
  })
  .strict();

export const TrialVerdictSchema = z
  .object({
    uncontested: z.array(
      z
        .object({
          finding: z.string(),
          citations: z.array(
            z.object({
              citationId: z.string(),
              sourceLabel: z.string(),
              passage: z.string(),
              locator: z.string().nullable(),
              sourceUrl: z.string().url().nullable(),
            }),
          ),
        })
        .strict(),
    ),
    pivots: z.array(
      z
        .object({
          description: z.string(),
          prosecutorPosition: GroundedClaimSchema,
          defenderPosition: GroundedClaimSchema,
          kind: z.enum([
            "interpretation",
            "admissibility",
            "sufficiency",
            "precedent",
            "credibility",
          ]),
          /** Legal weight of the pivot (NOT actionability — those can diverge).
           *  "strong": both sides cite the record cleanly and the disagreement
           *  is structural. "moderate": one side's grounding is partial.
           *  "speculative": one or both sides extrapolate beyond the cited
           *  material. The translator pass uses this to rank handoff
           *  questions; the verdict reveal uses it for visual emphasis. */
          strength: z.enum(["strong", "moderate", "speculative"]),
        })
        .strict(),
    ),
    unsupported: z.array(
      z
        .object({
          finding: z.string(),
          note: z.string(),
        })
        .strict(),
    ),
    summary: z.string(),
  })
  .strict();

/** Translator pass output — the Defender Handoff one-pager. Audience is
 *  the public defender, not the defendant; structure is fixed at
 *  3-question maximum with verbatim-citation grounding. */
export const HandoffQuestionSchema = z
  .object({
    /** The question itself — must end with "?". */
    question: z.string(),
    /** Includes a verbatim quoted passage from the cited source. */
    whyAsking: z.string(),
    /** Stable server-generated Qdrant citation selected from the pivot. */
    citationId: z.string(),
    /** Exact uploaded filename from the case's documents. */
    sourceLabel: z.string(),
    locator: z.string().nullable(),
    sourceUrl: z.string().url().nullable(),
    /** One-sentence "if yes, this means X for me." */
    whatYesMeans: z.string(),
    /** One-sentence "if no, this means Y for me." */
    whatNoMeans: z.string(),
  })
  .strict();

export const DefenderHandoffSchema = z
  .object({
    /** 1-2 sentence formal case identification (templated from caseFacts). */
    caseHeader: z.string(),
    /** Up to 3 prioritized questions. May be fewer if not enough pivots
     *  are actionable. Never more than 3 — PDs read three, not seven. */
    questions: z.array(HandoffQuestionSchema).max(3),
    /** Modest catch-all sentence inviting the PD to flag what's missing. */
    openQuestion: z.string(),
    /** Boilerplate AI-assistance disclaimer. */
    disclaimer: z.string(),
  })
  .strict();

/** Convert a Zod schema to OpenAI Structured-Outputs-compatible JSON
 *  Schema. Strict mode requires every property to be in `required` and
 *  `additionalProperties: false` everywhere; Zod 4's `toJSONSchema` with
 *  `target: "openai"` outputs that shape directly. */
export function toOpenAISchema(
  schema: z.ZodTypeAny,
  name: string,
  description?: string,
): {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict: true;
} {
  // z.toJSONSchema is a top-level helper in zod v4.
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  return {
    name,
    description,
    schema: jsonSchema as Record<string, unknown>,
    strict: true,
  };
}
