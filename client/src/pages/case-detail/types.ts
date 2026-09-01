/* Shared types for the case-detail subcomponents. */

export type CasePhase =
  | "upload"      // no documents yet
  | "analyze"     // docs uploaded, awaiting analysis
  | "analyzing"   // analysis cycling
  | "grow"        // analyzed, awaiting "Begin growing"
  | "growing"     // tree mid-bloom
  | "bloomed";    // all petals filled, split-pane active

export type CaseStatus =
  | "pending"
  | "analyzing"
  | "growing"
  | "completed";

export type RightSection =
  | "timeline"
  | "notes"
  | "analysis";

export interface CaseData {
  title: string;
  caseNumber: string;
  jurisdiction: string;
  opened: string;
}

export interface CaseDoc {
  name: string;
  /** byte size if you have it — used by the upload list */
  size?: number;
}
