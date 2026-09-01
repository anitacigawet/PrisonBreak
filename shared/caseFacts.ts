/**
 * Standardized case fact sheet — extracted from cited local-RAG passages by
 * the "Analyze" step. The orchestrator and research source-pickers
 * source-pickers (Phase 1) ground their work in these fields.
 *
 * Every field is nullable on purpose: real case files often omit
 * things, and "we couldn't find this" must be representable. The
 * `_provenance` map carries the exact source-passage citation for
 * every populated field so the server can verify it rather than trust a
 * model-written filename or quotation.
 */
import { z } from "zod";

/** Names of the fields in the fact sheet. */
export const CASE_FACT_FIELDS = [
  "jurisdiction",
  "charges",
  "parties",
  "caseNumber",
  "dates",
  "location",
  "evidenceTypes",
  "pleaStatus",
  "courtLevel",
  "witnesses",
  "priorRecord",
  "representationType",
] as const;

export type CaseFactField = (typeof CASE_FACT_FIELDS)[number];

/**
 * One date entry on the fact sheet. ISO 8601 string when known; the
 * `label` distinguishes e.g. "arrest", "arraignment", "next hearing".
 */
export const DateEntrySchema = z.object({
  label: z.string(),
  iso: z.string().nullable(),
  raw: z.string().nullable(),
});
export type DateEntry = z.infer<typeof DateEntrySchema>;

export const PartySchema = z.object({
  role: z.string(), // "defendant", "prosecutor", "judge", "victim", "witness"
  name: z.string().nullable(),
});
export type Party = z.infer<typeof PartySchema>;

export const WitnessSchema = z.object({
  name: z.string().nullable(),
  kind: z.string().nullable(), // "eye-witness", "expert", "officer", "character"
});
export type Witness = z.infer<typeof WitnessSchema>;

/** Provenance — for each populated field, the page/passage it came from. */
export const ProvenanceEntrySchema = z.object({
  documentLabel: z.string().nullable(),
  passage: z.string().nullable(),
  citationId: z.string().nullable().optional(),
  locator: z.string().nullable().optional(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

export const CaseFactsSchema = z.object({
  jurisdiction: z.string().nullable(),
  charges: z.array(z.string()).nullable(),
  parties: z.array(PartySchema).nullable(),
  caseNumber: z.string().nullable(),
  dates: z.array(DateEntrySchema).nullable(),
  location: z.string().nullable(),
  evidenceTypes: z.array(z.string()).nullable(),
  pleaStatus: z.string().nullable(), // "not-guilty", "guilty", "no-contest", "unentered", null
  courtLevel: z.string().nullable(), // "municipal", "superior", "state-appellate", "federal-district", ...
  witnesses: z.array(WitnessSchema).nullable(),
  priorRecord: z.enum(["none", "minor", "significant", "unknown"]).nullable(),
  representationType: z
    .enum(["public-defender", "private-counsel", "pro-se", "unknown"])
    .nullable(),
  _provenance: z.record(z.string(), ProvenanceEntrySchema).optional(),
  _extractedAt: z.string().optional(), // ISO timestamp
});

export type CaseFacts = z.infer<typeof CaseFactsSchema>;

/** Returns an empty fact sheet — every field null. Useful as a default. */
export function emptyCaseFacts(): CaseFacts {
  return {
    jurisdiction: null,
    charges: null,
    parties: null,
    caseNumber: null,
    dates: null,
    location: null,
    evidenceTypes: null,
    pleaStatus: null,
    courtLevel: null,
    witnesses: null,
    priorRecord: null,
    representationType: null,
  };
}

/** Parse a JSON-encoded CaseFacts blob (from cases.caseFacts column). */
export function parseCaseFacts(raw: string | null | undefined): CaseFacts | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return CaseFactsSchema.parse(obj);
  } catch {
    return null;
  }
}
