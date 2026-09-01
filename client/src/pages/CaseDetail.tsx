/**
 * CaseDetail — round-2 redesign integrated with real data flow.
 *
 * Layout matches the handoff in `client/src/pages/case-detail/`:
 *   - <Header>            — eyebrow + big Caveat title + status as
 *     ink-stroke type, with edit/delete and dashboard back-link.
 *   - <GrowthIndicator> — pinned top-right of the tree stage.
 *   - <PetalFlower>     — the existing component (real socket-driven props).
 *   - <PrebloomCard>    — upload → analyze → analyzing → grow CTA card.
 *   - <RightDrawer>     — Timeline / Notes / Analysis,
 *                         appears once bloomed via the existing 50% slide.
 *   - <TakeToTrial>     — fixed bottom-right ink button.
 *   - <hand-note>       — "the page sits here while the tree grows…" while
 *                         the growth animation is running.
 *
 * Data wiring uses the current fact extraction, petal research, and
 * Take-to-Trial paths. Retired workflow-result and report-sharing code is not
 * part of the local release.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PetalFlower from "@/components/PetalFlower";
import { usePetalsSocket } from "@/hooks/usePetalsSocket";
import { trpc } from "@/lib/trpc";
import { OnboardingTour, useOnboardingTour } from "@/components/OnboardingTour";
import { caseDetailTourSteps } from "@/lib/tourSteps";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";

import Header from "./case-detail/Header";
import GrowthIndicator from "./case-detail/GrowthIndicator";
import PrebloomCard from "./case-detail/PrebloomCard";
import RightDrawer from "./case-detail/RightDrawer";
import TakeToTrial from "./case-detail/TakeToTrial";
import TakeToTrialPanel from "./case-detail/TakeToTrialPanel";
import type { CasePhase, RightSection, CaseStatus } from "./case-detail/types";
import { useTrialSocket } from "@/hooks/useTrialSocket";

export default function CaseDetail({ params }: { params: { id: string } }) {
  const { user, loading: authLoading } = useAuth();
  const { runTour, markTourComplete } = useOnboardingTour("case-detail");
  const [, navigate] = useLocation();
  const caseId = parseInt(params.id);

  // ───────────────────────────── State ─────────────────────────────────────
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    title: "",
    caseNumber: "",
    jurisdiction: "",
    charges: "",
  });
  const [section, setSection] = useState<RightSection | null>("timeline");
  /** Take-to-Trial mode — when "running" or "complete", the right
   *  drawer is replaced by the TakeToTrialPanel (construction tape +
   *  thinking stream + verdict). "idle" shows the normal tab strip. */
  const [trialMode, setTrialMode] = useState<"idle" | "active">("idle");
  const { state: trialState, reset: resetTrial } = useTrialSocket(caseId);

  // ─────────────────────────── Queries / hooks ─────────────────────────────
  const { data: caseData, isLoading: caseLoading, refetch: refetchCase } = trpc.cases.getById.useQuery({ id: caseId });
  const { data: documents, refetch: refetchDocuments } = trpc.documents.list.useQuery({ caseId });

  const petalCatalogQuery = trpc.petals.catalog.useQuery();
  const petalListQuery = trpc.petals.list.useQuery({ caseId });
  const {
    progressByKey: petalProgressByKey,
    isGrowing: petalsIsGrowing,
    seedFromList: seedPetalsFromList,
  } = usePetalsSocket(caseId);

  // ─────────────────────────── Mutations ───────────────────────────────────
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      refetchDocuments();
      toast.success("Document uploaded");
    },
    onError: (err) => toast.error(`Upload failed: ${err.message}`),
  });

  const analyzeFactsMutation = trpc.cases.analyzeFacts.useMutation({
    onSuccess: () => {
      toast.success("Case facts extracted.");
      refetchCase();
      refetchDocuments();
    },
    onError: (err) => toast.error(`Fact extraction failed: ${err.message}`),
  });

  const takeToTrialMutation = trpc.cases.takeToTrial.useMutation({
    onError: (err) => {
      toast.error(`Take to trial failed: ${err.message}`);
      setTrialMode("idle");
    },
  });

  const startPetalGrowthMutation = trpc.petals.start.useMutation({
    onSuccess: () => {
      toast.success("Growing started");
      petalListQuery.refetch();
    },
    onError: (err) => toast.error(`Failed to start: ${err.message}`),
  });

  const updateCaseMutation = trpc.cases.update.useMutation({
    onSuccess: () => {
      toast.success("Case updated");
      setIsEditDialogOpen(false);
      refetchCase();
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const deleteCaseMutation = trpc.cases.delete.useMutation({
    onSuccess: () => {
      toast.success("Case deleted from the local workspace");
      navigate("/dashboard");
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  // ─────────────────────────── Effects ─────────────────────────────────────
  useEffect(() => {
    if (petalListQuery.data && petalListQuery.data.length > 0) {
      seedPetalsFromList(petalListQuery.data as any[]);
    }
  }, [petalListQuery.data, seedPetalsFromList]);

  // ─────────────────────────── Derived state ───────────────────────────────
  const petalCatalog = petalCatalogQuery.data ?? [];
  const petalEntries = Object.values(petalProgressByKey);
  const hasAnyPetalProgress = petalEntries.length > 0;
  const buildingPetal = petalEntries.find((p) => p.status === "building") ?? null;
  const isPetalsRunning = petalsIsGrowing || buildingPetal !== null;
  const allPetalsBloomed =
    hasAnyPetalProgress &&
    petalEntries.every((p) => p.status === "completed" || p.status === "skipped");

  const hasDocuments = (documents?.length ?? 0) > 0;
  const isAnalyzingFacts = analyzeFactsMutation.isPending;
  const isCaseAnalyzed = !!caseData?.caseFacts;

  /** Phase derived from the case + petals state — drives PrebloomCard rendering. */
  const phase: CasePhase = useMemo(() => {
    if (allPetalsBloomed) return "bloomed";
    if (isPetalsRunning) return "growing";
    if (isCaseAnalyzed && !hasAnyPetalProgress) return "grow";
    if (isAnalyzingFacts) return "analyzing";
    if (hasDocuments) return "analyze";
    return "upload";
  }, [allPetalsBloomed, isPetalsRunning, isCaseAnalyzed, hasAnyPetalProgress, isAnalyzingFacts, hasDocuments]);

  /** Header status pill — mirrors `phase` but uses CaseStatus vocabulary. */
  const status: CaseStatus =
    phase === "bloomed" ? "completed" :
    phase === "growing" ? "growing" :
    phase === "analyzing" ? "analyzing" :
                            "pending";

  /** 0-based index of the building petal in the canonical registry order. */
  const activeIdx = useMemo(() => {
    if (!buildingPetal) return -1;
    return petalCatalog.findIndex((c) => c.key === buildingPetal.key);
  }, [buildingPetal, petalCatalog]);

  const activeBuildingKey = buildingPetal?.key ?? null;
  const [focusedPetalKey, setFocusedPetalKey] = useState<string | null>(null);

  // ─────────────────────────── Handlers ────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const reader = new FileReader();
        const fileData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await uploadMutation.mutateAsync({
          caseId,
          fileName: file.name,
          fileData,
          mimeType: file.type,
        });
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
      }
    }
  }, [caseId, uploadMutation]);

  // PrebloomCard's "Upload" button just triggers the hidden file input.
  const handleUploadClick = () => fileInputRef.current?.click();
  const handleAnalyze = () => analyzeFactsMutation.mutate({ caseId });
  const handleBeginGrow = () => startPetalGrowthMutation.mutate({ caseId });
  /** Take-to-Trial button — fires the orchestrator mutation and flips
   *  the right drawer into TakeToTrialPanel mode. The socket stream
   *  populates the panel; on completion the verdict reveals. */
  const handleTakeToTrial = () => {
    if (!allPetalsBloomed) return;
    resetTrial();
    setTrialMode("active");
    takeToTrialMutation.mutate({ caseId });
  };

  const handleCloseTrial = () => {
    setTrialMode("idle");
    resetTrial();
  };

  const handleEditCase = () => {
    if (!caseData) return;
    setEditFormData({
      title: caseData.title,
      caseNumber: caseData.caseNumber || "",
      jurisdiction: caseData.jurisdiction || "",
      charges: caseData.charges || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateCase = () => {
    if (!editFormData.title.trim()) {
      toast.error("Case title is required");
      return;
    }
    updateCaseMutation.mutate({
      id: caseId,
      title: editFormData.title,
      caseNumber: editFormData.caseNumber || undefined,
      jurisdiction: editFormData.jurisdiction || undefined,
      charges: editFormData.charges || undefined,
    });
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const handleDeleteCase = () => setShowDeleteConfirm(true);
  const confirmDeleteCase = () => {
    setShowDeleteConfirm(false);
    deleteCaseMutation.mutate({ id: caseId });
  };

  // ─────────────────────────── Loading / not-found ─────────────────────────
  if (authLoading || caseLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    navigate("/");
    return null;
  }
  if (!caseData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Case Not Found</CardTitle>
            <CardDescription>The requested case could not be found.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─────────────────────────── Header data ─────────────────────────────────
  const headerCase = {
    title: caseData.title,
    caseNumber: caseData.caseNumber || `PB-${String(caseData.id).padStart(4, "0")}`,
    jurisdiction: caseData.jurisdiction || "",
    opened: new Date(caseData.createdAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };

  // For PrebloomCard's docs list (just name + size).
  const docList = (documents ?? []).map((d) => ({ name: d.fileName, size: d.fileSize ?? undefined }));

  const showCTA = phase === "upload" || phase === "analyze" || phase === "analyzing" || phase === "grow";
  const isBloomed = phase === "bloomed";
  const isGrowing = phase === "growing";

  return (
    <div className="paper-stage min-h-screen relative" style={{ paddingBottom: 56 }}>
      <Header
        caseData={headerCase}
        status={status}
        onEdit={handleEditCase}
        onDelete={handleDeleteCase}
        onBack={() => navigate("/dashboard")}
      />

      {/* Hidden file input — the PrebloomCard's upload zone clicks this. */}
      <input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        multiple
        accept=".pdf,.docx,.txt"
        className="hidden"
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Split stage */}
      <div className="relative flex items-stretch" style={{ padding: "0 24px" }}>
        {/* Left pane (tree + CTA + hand-note) */}
        <div
          className="relative flex flex-col items-center min-w-0"
          style={{
            width: isBloomed ? "50%" : "100%",
            transition: "width 700ms ease-in-out",
          }}
        >
          <GrowthIndicator
            status={status}
            activeIdx={Math.max(0, activeIdx)}
            total={petalCatalog.length || 8}
            building={isGrowing}
            done={isBloomed}
          />

          <div
            className="relative mx-auto"
            style={{
              marginTop: 8,
              aspectRatio: "760 / 980",
              width: isBloomed ? "min(72vh, 600px)" : "min(85vh, 760px)",
              transition: "width 700ms ease-in-out",
              maxWidth: "100%",
            }}
          >
            <PetalFlower
              catalog={petalCatalog}
              progressByKey={petalProgressByKey}
              activeKey={activeBuildingKey ?? focusedPetalKey}
              onPetalClick={(key) => {
                // Only completed petals backed by a retained research corpus are interactive.
                const p = petalProgressByKey[key];
                if (p?.status === "completed" && p.corpusKey) {
                  setFocusedPetalKey((prev) => (prev === key ? null : key));
                }
              }}
            />
          </div>

          {showCTA && (
            <PrebloomCard
              phase={phase}
              docs={docList}
              onUpload={handleUploadClick}
              onAnalyze={handleAnalyze}
              onBeginGrow={handleBeginGrow}
            />
          )}

          {isGrowing && (
            <div
              className="hand text-center"
              style={{
                color: "var(--ink-soft)",
                fontSize: 18,
                marginTop: 4,
                marginBottom: 12,
              }}
            >
              the page sits here while the tree grows — each petal is a source-grounded research corpus.
            </div>
          )}
        </div>

        {/* Right drawer */}
        <div
          className="flex flex-shrink-0 overflow-hidden"
          aria-hidden={!isBloomed}
          style={{
            width: isBloomed ? "50%" : "0%",
            opacity: isBloomed ? 1 : 0,
            minHeight: isBloomed ? "min(88vh, 880px)" : 0,
            transition: "width 700ms ease-in-out, opacity 500ms ease-in-out 200ms",
          }}
        >
          {trialMode === "active" ? (
            <TakeToTrialPanel state={trialState} onClose={handleCloseTrial} />
          ) : (
            <RightDrawer caseId={caseId} section={section} onSelect={setSection} />
          )}
        </div>
      </div>

      {trialMode === "idle" && (
        <TakeToTrial ready={isBloomed} onClick={handleTakeToTrial} />
      )}

      <OnboardingTour steps={caseDetailTourSteps} run={runTour} onFinish={markTourComplete} />
      {/* Edit Case Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-card-foreground">Edit Case</DialogTitle>
            <DialogDescription>
              Update the case details. All fields except title are optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title" className="text-card-foreground">Case Title *</Label>
              <Input
                id="edit-title"
                placeholder="e.g., State v. John Doe"
                value={editFormData.title}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-caseNumber" className="text-card-foreground">Case Number</Label>
              <Input
                id="edit-caseNumber"
                placeholder="e.g., CR-2024-12345"
                value={editFormData.caseNumber}
                onChange={(e) => setEditFormData({ ...editFormData, caseNumber: e.target.value })}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-jurisdiction" className="text-card-foreground">Jurisdiction</Label>
              <Input
                id="edit-jurisdiction"
                placeholder="e.g., Superior Court of Arizona"
                value={editFormData.jurisdiction}
                onChange={(e) => setEditFormData({ ...editFormData, jurisdiction: e.target.value })}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-charges" className="text-card-foreground">Charges</Label>
              <Textarea
                id="edit-charges"
                placeholder="e.g., First-degree murder, Armed robbery"
                value={editFormData.charges}
                onChange={(e) => setEditFormData({ ...editFormData, charges: e.target.value })}
                className="bg-input border-border text-foreground"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={updateCaseMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateCase} disabled={updateCaseMutation.isPending}>
              {updateCaseMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm — Header's trash icon calls handleDeleteCase. The
          workspace may contain real criminal case documents, so the local
          deletion boundary is stated explicitly before the destructive step. */}
      <AlertDialog
        open={showDeleteConfirm || deleteCaseMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteCaseMutation.isPending) setShowDeleteConfirm(false);
        }}
      >
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-card-foreground">
              {deleteCaseMutation.isPending ? "Deleting…" : "Delete this case?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {deleteCaseMutation.isPending ? (
                  <p>Wiping local data and disk files. Please wait.</p>
                ) : (
                  <div className="space-y-3">
                    <p>
                      This permanently removes the case from your computer. The
                      following will be deleted:
                    </p>
                    <ul className="text-xs list-disc list-inside space-y-1 text-muted-foreground">
                      <li>All uploaded documents (on disk + database)</li>
                      <li>Locally extracted text and Qdrant index entries</li>
                      <li>The extracted fact sheet and research-corpus records</li>
                      <li>The Take-to-Trial verdict and Defender Handoff</li>
                      <li>All case notes</li>
                    </ul>
                    <p className="text-xs">
                      <strong>This local deletion cannot be undone.</strong> If
                      optional CLI research or a cloud analysis provider was used,
                      provider-side logs or account history are governed by that
                      provider and are not deleted by this action.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteCaseMutation.isPending}
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteCaseMutation.isPending}
              onClick={confirmDeleteCase}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCaseMutation.isPending ? "Deleting…" : "Yes, delete this case"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
