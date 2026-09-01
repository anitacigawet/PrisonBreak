import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BookOpenCheck,
  FileCheck2,
  Github,
  GitCompareArrows,
  LockKeyhole,
  Scale,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import { ParticleBackground } from "@/components/ParticleBackground";
import { OnboardingTour, useOnboardingTour, TourTriggerButton } from "@/components/OnboardingTour";
import { homeTourSteps } from "@/lib/tourSteps";
import ThemeToggle from "@/components/ThemeToggle";

const REPO_URL = "https://github.com/anitacigawet/PrisonBreak";

const features = [
  {
    icon: FileCheck2,
    title: "A record you can trace",
    description:
      "Extracted facts retain source provenance, so a reviewer can return to the case document behind each populated field.",
  },
  {
    icon: BookOpenCheck,
    title: "Research organized by domain",
    description:
      "Local Qdrant corpora separate the uploaded record from statutes, cases, procedure, forensics, identification research, and other admitted sources.",
  },
  {
    icon: GitCompareArrows,
    title: "Two readings, compared",
    description:
      "Prosecutor and defense passes read the same grounded material. A third pass maps agreement, disagreement, and the narrow points the case may turn on.",
  },
  {
    icon: ScrollText,
    title: "A handoff built for counsel",
    description:
      "The longer analysis becomes a printable page with no more than three source-linked questions for a licensed attorney.",
  },
];

export default function Home() {
  const { runTour, markTourComplete, restartTour } = useOnboardingTour("home");

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">PrisonBreak</span>
          </Link>
          <div className="flex items-center gap-3">
            <TourTriggerButton onClick={restartTour} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Open workspace</Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container py-12">
        <div className="mx-auto max-w-5xl space-y-10">
          <section className="relative overflow-hidden rounded-xl px-8 py-16 text-center">
            <ParticleBackground />
            <div className="relative z-10 mx-auto max-w-3xl space-y-5">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <LockKeyhole className="h-3 w-3" />
                  Self-hosted
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
                  <ShieldCheck className="h-3 w-3" />
                  Source-grounded
                </span>
                <span className="inline-flex items-center rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                  Working beta
                </span>
              </div>
              <h1 className="gradient-text text-4xl font-bold md:text-6xl">
                Read the record. See where the case turns.
              </h1>
              <p className="text-lg leading-relaxed text-muted-foreground md:text-xl">
                PrisonBreak organizes criminal case documents, compares the strongest
                source-linked readings of the record, and prepares better questions for
                attorney review.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Button size="lg" asChild className="btn-glow">
                  <Link href="/dashboard">Open the case workspace</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                    <Github className="h-4 w-4" />
                    Read the source
                  </a>
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="glass-card-enhanced card-lift gradient-border-visible">
                <CardHeader>
                  <Icon className="mb-2 h-9 w-9 text-primary" />
                  <CardTitle className="text-card-foreground">{title}</CardTitle>
                  <CardDescription className="leading-relaxed">{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 rounded-xl border border-border bg-card/70 p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Know where the data goes</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Uploads, extracted text, embeddings, and the Qdrant index stay in the local
                workspace. Take-to-Trial sends selected evidence excerpts to the configured
                Anthropic or OpenAI provider. Optional Codex or Claude CLI web research is also
                network-backed. Review provider policies and your confidentiality obligations
                before processing sensitive records.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/settings">Review settings</Link>
            </Button>
          </section>

          <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm leading-relaxed text-muted-foreground">
            <div className="flex gap-3">
              <Scale className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <p>
                PrisonBreak is an AI-assisted research tool, not a lawyer or legal service.
                It does not determine guilt, predict a result, or replace licensed counsel.
                Review every source and finding with an attorney before taking action.
              </p>
            </div>
          </section>

        </div>
      </main>
      <OnboardingTour steps={homeTourSteps} run={runTour} onFinish={markTourComplete} />
    </div>
  );
}
