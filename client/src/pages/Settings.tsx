import { Link } from "wouter";
import { Scale, Database, Search, Brain } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

/* Provider + model options curated to those known-good with tool use. */
const MODEL_PRESETS: Record<"anthropic" | "openai", { value: string; label: string; note?: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "balanced; default" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", note: "highest quality / cost" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "fast / cheap" },
  ],
  openai: [
    { value: "gpt-4.1", label: "GPT-4.1", note: "balanced reasoning; default" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "fast / cheap" },
    { value: "o3", label: "o3", note: "stronger reasoning; slower" },
  ],
};

function OrchestratorCard() {
  const settingsQuery = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const updateMutation = trpc.settings.updateOrchestrator.useMutation({
    onSuccess: () => {
      toast.success("Orchestrator settings saved.");
      utils.settings.get.invalidate();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const current = settingsQuery.data?.orchestrator;
  const [provider, setProvider] = useState<"anthropic" | "openai">("openai");
  const [model, setModel] = useState<string>("gpt-4.1-mini");
  const [anthropicKey, setAnthropicKey] = useState<string>("");
  const [openaiKey, setOpenaiKey] = useState<string>("");

  useEffect(() => {
    if (!current) return;
    setProvider(current.provider);
    setModel(current.model);
  }, [current]);

  const presets = MODEL_PRESETS[provider];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Take-to-Trial orchestrator
        </CardTitle>
        <CardDescription>
          Runs three reasoning passes (prosecutor → defender → synthesizer) over
          evidence retrieved from the local case index. Pick a provider and supply
          an API key. Keys are stored in <code className="font-mono">data/settings.json</code>
          on this machine. The selected provider receives the bounded evidence
          excerpts and prompts needed for each pass.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider">Provider</Label>
          <div className="flex gap-2">
            {(["openai", "anthropic"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProvider(p);
                  setModel(MODEL_PRESETS[p][0].value);
                }}
                className={
                  "flex-1 rounded-[4px] border px-3 py-2 font-display text-base transition-colors " +
                  (provider === p
                    ? "bg-[color:var(--ink)] text-[color:var(--paper)] border-[color:var(--ink)]"
                    : "bg-[color:var(--paper)] text-[color:var(--ink)] border-[color:var(--rule)] hover:bg-[color:var(--paper-deep)]")
                }
              >
                {p === "anthropic" ? "Claude (Anthropic)" : "OpenAI"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider">Model</Label>
          <div className="space-y-1.5">
            {presets.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setModel(m.value)}
                className={
                  "w-full text-left rounded-[4px] border px-3 py-2 flex justify-between items-center transition-colors " +
                  (model === m.value
                    ? "border-[color:var(--ink)] bg-[color:var(--paper-deep)]"
                    : "border-[color:var(--rule)] hover:bg-[color:var(--paper-deep)]")
                }
              >
                <span className="font-mono text-sm">{m.label}</span>
                {m.note && (
                  <span className="text-[10px] tracking-wider uppercase text-muted-foreground">
                    {m.note}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="anthropic-key" className="text-xs uppercase tracking-wider">
            Anthropic API key {current?.anthropicKeyConfigured && (
              <span className="ml-2 text-[10px] text-[color:var(--bloom)]">· configured</span>
            )}
          </Label>
          <Input
            id="anthropic-key"
            type="password"
            placeholder={current?.anthropicKeyConfigured ? "•••••••••• (leave blank to keep)" : "sk-ant-..."}
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="openai-key" className="text-xs uppercase tracking-wider">
            OpenAI API key {current?.openaiKeyConfigured && (
              <span className="ml-2 text-[10px] text-[color:var(--bloom)]">· configured</span>
            )}
          </Label>
          <Input
            id="openai-key"
            type="password"
            placeholder={current?.openaiKeyConfigured ? "•••••••••• (leave blank to keep)" : "sk-..."}
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            onClick={() => {
              updateMutation.mutate({
                provider,
                model,
                // Only send keys that the user actually typed; an empty
                // string CLEARS that provider's key, undefined keeps it.
                anthropicApiKey: anthropicKey ? anthropicKey : undefined,
                openaiApiKey: openaiKey ? openaiKey : undefined,
              });
              setAnthropicKey("");
              setOpenaiKey("");
            }}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            <Link href="/" className="text-xl font-bold text-foreground">
              PrisonBreak
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-12">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Case documents are extracted, embedded, and indexed locally with
              Qdrant. Analysis providers and optional CLI web research remain
              separate, explicitly network-backed steps.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Local Qdrant retrieval
              </CardTitle>
              <CardDescription>
                Uploaded text and its embeddings stay in the local workspace.
                Qdrant supplies the evidence chunks used by fact extraction,
                comparison, and citation checks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
                <p className="font-medium">On-device index</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The persistent vector index lives under{" "}
                  <code className="font-mono">data/qdrant</code>. FastEmbed runs
                  locally; its model may need a one-time download before the first
                  real indexing run.
                </p>
              </div>

              <div className="rounded-md border border-border bg-card p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Search className="h-4 w-4" />
                  Optional CLI web research
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  When enabled through server configuration, a locally installed
                  Codex or Claude CLI can run bounded searches for primary legal
                  sources. The CLI model, search requests, and source websites use
                  the network. CLI output is not grounded evidence by itself; a
                  source must be fetched, stored, and admitted to the local index
                  before downstream analysis may cite it.
                </p>
              </div>
            </CardContent>
          </Card>

          <OrchestratorCard />

          <Card>
            <CardHeader>
              <CardTitle>About this build</CardTitle>
              <CardDescription>
                PrisonBreak is a self-hosted case-reading workspace and working
                beta: local Qdrant retrieval, citation-linked comparison, and a
                printable attorney handoff.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Local retrieval does not make the entire workflow offline. The
                optional CLI research path uses live web services, and
                Take-to-Trial sends selected evidence excerpts to the Anthropic
                or OpenAI provider configured above. PrisonBreak is not a legal
                service and does not replace qualified counsel. Review provider
                policies and your confidentiality obligations before processing
                sensitive material.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
