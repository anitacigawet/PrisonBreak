# Synthetic Case File — Mohave County v. Jamie Reyes

**THIS IS A FICTIONAL CASE.** Every name, address, badge number, case number, and document is invented to exercise PrisonBreak's case-reading workflow with realistic-looking inputs. **No real person, officer, or store is being described.**

## What this is for

Upload the eight documents in this folder to a new PrisonBreak case. They provide a synthetic but realistic misdemeanor shoplifting record for testing local document parsing, Qdrant indexing, citation-checked fact extraction, official-source research, prosecutor and defense passes, the Take-to-Trial view, and the Defender Handoff without exposing a real person's records.

Live research and analysis are still network-backed. The selected Codex or Claude CLI receives the research brief, and the selected Anthropic or OpenAI API receives retrieved passages during fact extraction and comparison.

## Case shape

- **Charge:** Shoplifting, A.R.S. § 13-1805 (Class 1 misdemeanor)
- **Court:** Bullhead City Justice Court, Mohave County, Arizona
- **Defendant:** Jamie Reyes (fictional)
- **Alleged victim:** Mohave Market, a fictional retailer at 1234 AZ-95, Bullhead City
- **Incident date:** March 15, 2026
- **Items alleged taken:** wireless earbuds ($89.99) and a USB-C charger ($24.99), total $114.98

## Documents in this folder

| # | File | Role |
|---|---|---|
| 01 | `01_complaint.md` | Formal charging document filed by the County Attorney |
| 02 | `02_police_report.md` | Arresting officer's narrative |
| 03 | `03_probable_cause.md` | Officer's sworn affidavit supporting the citation |
| 04 | `04_witness_statement.md` | Loss-prevention officer's written statement |
| 05 | `05_defendant_interview.md` | Officer's notes from in-store interview |
| 06 | `06_discovery_letter.md` | State's notice of discovery production |
| 07 | `07_court_register.md` | Court docket entries to date |
| 08 | `08_plea_offer.md` | State's plea offer |

## Seeded issues

The documents contain deliberate but plausible issues across five error categories. These are intentionally subtle: the analysis should find them from cited passages, not receive them as pre-labeled inputs.

- **EM (Eyewitness):** the loss-prevention officer's identification was made through a small security monitor and the witness statement uses “I am 100% certain” language without acknowledging the limited viewing conditions
- **MF (Forensic):** likely no findings; this tests a realistic “no findings of this type” result
- **FC (False Confession):** the in-store interview was unrecorded, the officer used minimization (“just admit it and we keep this simple”), and the defendant's “yeah, okay” responses are presented in the report as admissions
- **OM (Official Misconduct):** the probable-cause affidavit asserts a fact (“observed the defendant conceal the items”) more definitively than the witness statement supports, and the discovery letter does not list the store's full surveillance timeline or the loss-prevention officer's internal complaint history
- **ID (Inadequate Defense):** the court register shows no motion to suppress, no motion to compel surveillance, no challenge to the identification procedure, and only a continuance request from the defense

## How to use

1. Install the Python RAG dependencies and configure a research CLI as described in [Self-hosting](../../docs/SELF_HOSTING.md).
2. Start PrisonBreak and configure Anthropic or OpenAI under Settings.
3. Create a new case with fictional identifying information.
4. Upload the eight `.md` files in this folder.
5. Run Analyze, then Grow, then Take to Trial. Review every citation against its source before treating the output as useful.

## Reminder

These documents are constructed. They should not be used as a template or quoted as if they reflected real case law, real officer conduct, or real local procedures. They are sufficient for testing the workflow's shape and nothing more.
