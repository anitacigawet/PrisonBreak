/** Catalog of bounded, primary-source web-research domains. */
import type { Case } from "../../drizzle/schema";
import type { CaseFacts } from "../../shared/caseFacts";
import type { PetalSpec } from "./types";

function caseTerms(caseRow: Case, facts: CaseFacts | null): string {
  const jurisdiction = facts?.jurisdiction ?? caseRow.jurisdiction ?? "the relevant jurisdiction";
  const charges = facts?.charges?.join(", ") ?? caseRow.charges ?? "the charged offenses";
  const court = facts?.courtLevel ?? "the relevant criminal court";
  return `Jurisdiction: ${jurisdiction}. Charges or statutes: ${charges}. Court level: ${court}.`;
}

function evidenceTerms(facts: CaseFacts | null): string {
  return facts?.evidenceTypes?.join(", ") || "No evidence type was reliably extracted.";
}

const laws: PetalSpec = {
  key: "laws",
  label: "Laws",
  description: "Finding official statutes and regulations implicated by the charges.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find the current official text of each criminal statute, definitions statute, sentencing provision, and directly cross-referenced regulation.`,
};

const jurisprudence: PetalSpec = {
  key: "jurisprudence",
  label: "Jurisprudence",
  description: "Finding controlling opinions for the legal questions the record raises.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find controlling appellate opinions from official court or government sites that define the charged elements, suppression standards, admissibility rules, or burdens of proof.`,
};

const procedural: PetalSpec = {
  key: "procedural",
  label: "Procedural Posture",
  description: "Finding official court rules, motion standards, and timing requirements.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find official criminal-procedure and local-court rules governing motions, discovery, hearings, deadlines, and preservation of issues.`,
};

const patterns: PetalSpec = {
  key: "patterns",
  label: "Public Case Data",
  description: "Finding official sentencing and case-processing statistics without profiling individuals.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find official court, sentencing-commission, or government statistics about disposition and sentencing for the relevant offense class. Do not profile a judge, lawyer, witness, or defendant.`,
};

const demographics: PetalSpec = {
  key: "demographics",
  label: "Venue Data",
  description: "Finding official population and jury-source information for the venue.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find official census material and official court jury-selection rules describing the venue and its jury-source process.`,
};

const forensics: PetalSpec = {
  key: "forensics",
  label: "Forensic Reliability",
  description: "Finding official scientific reliability reports for forensic methods in the record.",
  applicability: async (_row, facts) => {
    const evidence = evidenceTerms(facts).toLowerCase();
    const applies = /dna|finger|ballistic|firearm|toxic|drug|lab|forensic|digital|phone|bite|hair|blood|print/.test(evidence);
    return applies
      ? { apply: true }
      : { apply: false, reason: "No forensic discipline was found in the cited case fact sheet." };
  },
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Evidence types: ${evidenceTerms(facts)}. Find official scientific reports, standards, or court opinions addressing validity, error rates, limitations, and admissibility of those forensic methods.`,
};

const idConfession: PetalSpec = {
  key: "id_confession",
  label: "ID / Statement Science",
  description: "Finding official reliability material on identification and custodial statements.",
  applicability: async (_row, facts) => {
    const evidence = evidenceTerms(facts).toLowerCase();
    const witnessKinds = facts?.witnesses?.map(item => item.kind ?? "").join(" ").toLowerCase() ?? "";
    const applies = /identif|eyewitness|lineup|showup|confess|interrog|statement|admission/.test(`${evidence} ${witnessKinds}`);
    return applies
      ? { apply: true }
      : { apply: false, reason: "No identification or custodial-statement issue was found in the cited case fact sheet." };
  },
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find official court opinions, government guidance, and official scientific reports addressing eyewitness identification, lineup procedures, interrogation, voluntariness, or false-confession risk relevant to the extracted evidence types.`,
};

const cost: PetalSpec = {
  key: "cost",
  label: "Representation Resources",
  description: "Finding official defense, expert, and court resource information.",
  applicability: async () => ({ apply: true }),
  researchQuery: (row, facts) =>
    `${caseTerms(row, facts)} Find official public-defense eligibility, appointed-counsel, court-fee, expert-assistance, and fee-waiver resources relevant to this court.`,
};

/** Ordered list; this is also the flower visualization order. */
export const PETAL_SPECS: PetalSpec[] = [
  laws,
  jurisprudence,
  procedural,
  patterns,
  demographics,
  forensics,
  idConfession,
  cost,
];

export function getPetalSpec(key: string): PetalSpec | undefined {
  return PETAL_SPECS.find(petal => petal.key === key);
}
