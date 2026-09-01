import { settingsRouter } from "./_core/settingsRouter";
import { petalsRouter } from "./petals/router";
import { orchestratorRouter } from "./orchestrator/router";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
import { extractCaseFactsFromIndex } from "./caseAnalysis";
import { localRag } from "./rag/bridge";
import { nanoid } from "nanoid";

// Local-only build: no auth, every procedure is public. The aliases
// keep the original handler code reading as before.
const protectedProcedure = publicProcedure;

function calculateFileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  settings: settingsRouter,
  rag: router({
    status: publicProcedure.query(async () => ({
      ...(await localRag.health()),
      researchProvider: process.env.PRISONBREAK_RESEARCH_PROVIDER ?? null,
    })),
  }),
  petals: petalsRouter,

  // Case management
  cases: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getCasesByUserId(ctx.user.id);
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const caseData = await db.getCaseById(input.id);
        if (!caseData) {
          throw new Error("Case not found");
        }
        // Verify user owns this case
        if (caseData.userId !== ctx.user.id) {
          throw new Error("Unauthorized");
        }
        return caseData;
      }),

    get: protectedProcedure
      .input(z.object({ caseId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCaseById(input.caseId);
      }),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string(),
          caseNumber: z.string().optional(),
          jurisdiction: z.string().optional(),
          charges: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await db.createCase(
          ctx.user.id,
          input.title,
          input.caseNumber,
          input.jurisdiction,
          input.charges
        );
        return { caseId: Number(result[0].insertId) };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          caseNumber: z.string().optional(),
          jurisdiction: z.string().optional(),
          charges: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify user owns this case
        const caseData = await db.getCaseById(input.id);
        if (!caseData) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
        }
        if (caseData.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to edit this case' });
        }

        await db.updateCase(input.id, {
          title: input.title,
          caseNumber: input.caseNumber,
          jurisdiction: input.jurisdiction,
          charges: input.charges,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Verify user owns this case
        const caseData = await db.getCaseById(input.id);
        if (!caseData) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
        }
        if (caseData.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to delete this case' });
        }

        const localIndexCleanupErrors: string[] = [];
        const documents = await db.getDocumentsByCaseId(input.id);
        const researchSources = await db.listResearchSources(input.id);
        try {
          await localRag.health();
          for (const document of documents) {
            await localRag.deleteSource({
              caseId: input.id,
              corpus: "case",
              sourceId: `document:${document.id}`,
            });
          }
          for (const source of researchSources) {
            await localRag.deleteSource({
              caseId: input.id,
              corpus: source.corpusKey,
              sourceId: `research:${source.id}`,
            });
          }
        } catch (error) {
          localIndexCleanupErrors.push((error as Error).message);
        }

        await db.deleteCase(input.id);
        return {
          success: true,
          localIndexCleanupErrors,
        };
      }),

    // Index uploaded documents locally, retrieve an evidence pack, and
    // populate a citation-checked fact sheet for research + comparison.
    analyzeFacts: protectedProcedure
      .input(z.object({ caseId: z.number() }))
      .mutation(async ({ input }) => {
        const caseRow = await db.getCaseById(input.caseId);
        if (!caseRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
        }
        await db.updateCaseStatus(input.caseId, "analyzing");
        try {
          const result = await extractCaseFactsFromIndex(input.caseId);
          await db.setCaseFacts(input.caseId, JSON.stringify(result.facts));
          await db.updateCaseStatus(input.caseId, "completed");
          return { ok: true as const, ...result };
        } catch (error) {
          await db.updateCaseStatus(input.caseId, "error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: (error as Error).message,
          });
        }
      }),

    // ── Take-to-Trial orchestrator (Phase 2) ───────────────────────────
    // Three-persona dialectical synthesis (prosecutor / defender /
    // synthesizer). Mounted into the cases namespace so call sites read
    // as `trpc.cases.takeToTrial.useMutation()` and
    // `trpc.cases.getTrialResult.useQuery({ caseId })`.
    ...orchestratorRouter._def.procedures,

  }),

  // Document management
  documents: router({
    list: protectedProcedure
      .input(z.object({ caseId: z.number() }))
      .query(async ({ input }) => {
        return await db.getDocumentsByCaseId(input.caseId);
      }),

    upload: protectedProcedure
      .input(
        z.object({
          caseId: z.number(),
          fileName: z.string(),
          fileData: z.string(), // base64 encoded
          mimeType: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Decode base64 file data. The frontend sends a data URL
        // (`data:<mime>;base64,<payload>`) via FileReader.readAsDataURL —
        // strip the prefix before decoding, otherwise the prefix bytes
        // bleed into the saved file as garbage.
        const commaIdx = input.fileData.indexOf(",");
        const base64Payload =
          input.fileData.startsWith("data:") && commaIdx !== -1
            ? input.fileData.slice(commaIdx + 1)
            : input.fileData;
        const fileBuffer = Buffer.from(base64Payload, "base64");
        const fileSize = fileBuffer.length;

        // Calculate hash for duplicate detection
        const fileHash = calculateFileHash(fileBuffer);

        // Check for duplicates
        const isDuplicate = await db.checkDuplicateDocument(input.caseId, fileHash);
        if (isDuplicate) {
          return {
            success: false,
            error: "This document has already been uploaded to this case.",
            isDuplicate: true,
          };
        }

        // Build the storage key. The unique id goes in the *directory*
        // segment, not the filename, so the original basename remains the
        // human-facing citation label in the local index.
        const fileKey = `cases/${input.caseId}/documents/${nanoid()}/${input.fileName}`;
        const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);

        // Save to database
        const result = await db.addDocument(
          input.caseId,
          input.fileName,
          fileKey,
          url,
          fileHash,
          input.mimeType,
          fileSize
        );
        await db.invalidateCaseAnalysis(input.caseId);

        return {
          success: true,
          documentId: Number(result[0].insertId),
          fileUrl: url,
        };
      }),

    checkDuplicate: protectedProcedure
      .input(
        z.object({
          caseId: z.number(),
          fileHash: z.string(),
        })
      )
      .query(async ({ input }) => {
        const isDuplicate = await db.checkDuplicateDocument(input.caseId, input.fileHash);
        return { isDuplicate };
      }),
  }),

  // Case notes management
  notes: router({
    list: protectedProcedure
      .input(z.object({ caseId: z.number() }))
      .query(async ({ ctx, input }) => {
        // Verify user owns the case
        const caseData = await db.getCaseById(input.caseId);
        if (!caseData) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
        }
        if (caseData.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view notes for this case' });
        }

        return await db.getCaseNotesByCaseId(input.caseId);
      }),

    create: protectedProcedure
      .input(z.object({ caseId: z.number(), content: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Verify user owns the case
        const caseData = await db.getCaseById(input.caseId);
        if (!caseData) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
        }
        if (caseData.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to add notes to this case' });
        }

        const result = await db.createCaseNote(input.caseId, ctx.user.id, input.content);
        return { noteId: Number(result[0].insertId) };
      }),

    update: protectedProcedure
      .input(z.object({ noteId: z.number(), content: z.string() }))
      .mutation(async ({ input }) => {
        await db.updateCaseNote(input.noteId, input.content);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ noteId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCaseNote(input.noteId);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
