# Security and privacy

PrisonBreak handles material that may be unusually sensitive. Treat every real case record, retained source, provider credential, and generated output as confidential.

## Intended deployment boundary

The application is designed for one person on a trusted computer. It binds to `127.0.0.1` by default and does not provide production-grade user authentication, authorization, tenancy, encryption at rest, audit logging, or public-hosting controls. Do not place it on an internet-accessible host or shared network without adding and independently reviewing those protections.

## Local data

Uploaded files, the SQLite database, retained web-source snapshots, FastEmbed model cache, and Qdrant local-mode index are stored under `data/`. The Qdrant index contains passages extracted from case documents. PrisonBreak does not encrypt this directory, and the analysis API key saved through Settings is stored in `data/settings.json`.

Protect the operating-system account and disk, exclude `data/` from backups or sync services that are not appropriate for the material, and do not commit it to Git.

## External processing

Local retrieval is not the same as local-only processing.

- Analyze sends retrieved passages from the uploaded case documents to the Anthropic or OpenAI provider selected in Settings so it can produce the fact sheet.
- Grow sends bounded research briefs through the selected Codex CLI or Claude CLI. Current briefs use structured details such as jurisdiction, charges or statutes, court level, and relevant evidence types rather than the complete uploaded record, but those details may still be sensitive. The CLI and its web-search provider are external services.
- Take to Trial and the Defender Handoff send prompts, retrieved case passages, retained-source passages, and earlier pass output to the selected Anthropic or OpenAI provider.
- PrisonBreak fetches candidate official-source URLs over the network and stores admitted snapshots locally. Source hosts can observe the request.

CLI authentication remains under the CLI's own account and configuration. PrisonBreak does not copy those credentials into its database. Review every provider's policies and any confidentiality, privilege, records-retention, or professional obligations that apply before use.

## Document limitations

The built-in parser does not perform OCR. Scan-only PDFs must be OCRed before upload. Treat converted documents as sensitive copies and verify their text before relying on citations.

## Reporting a vulnerability

Open a GitHub security advisory or a narrowly written issue that does not disclose exploit details or sensitive data. Do not include real case material, access tokens, API keys, CLI authentication data, credentials, or personal information. Maintainers do not promise a response time, but responsible reports are welcome.
