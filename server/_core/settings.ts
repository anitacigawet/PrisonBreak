/**
 * Settings store backed by ./data/settings.json.
 *
 * Holds runtime preferences that aren't case-scoped — currently the
 * orchestrator's provider config (Claude vs OpenAI + model + API
 * keys). Settings are user-supplied via the Settings page and read
 * server-side at request time.
 *
 * API keys live here (NOT in env) so the user can swap them at runtime
 * via the UI without restarting the server. data/settings.json is
 * gitignored alongside the SQLite DB and the uploads directory.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface OrchestratorSettings {
  provider: "anthropic" | "openai";
  /** Provider-specific model identifier. Persisted as a string so
   *  future models work without a schema bump. */
  model: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export interface AppSettings {
  orchestrator?: OrchestratorSettings;
}

const SETTINGS_DIR = path.join(process.cwd(), "data");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

const DEFAULTS: AppSettings = {
  orchestrator: {
    provider: "openai",
    model: "gpt-4.1-mini",
  },
};

function ensureDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function readSettings(): AppSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return structuredClone(DEFAULTS);
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    if (!raw.trim()) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as AppSettings;
    return {
      ...DEFAULTS,
      ...parsed,
      orchestrator: {
        ...DEFAULTS.orchestrator!,
        ...(parsed.orchestrator ?? {}),
      },
    };
  } catch (err) {
    console.warn("[Settings] Failed to read settings.json:", err);
    return structuredClone(DEFAULTS);
  }
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  ensureDir();
  const current = readSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    orchestrator: patch.orchestrator
      ? { ...current.orchestrator!, ...patch.orchestrator }
      : current.orchestrator,
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Returns a redacted snapshot for the client. API keys are exposed as
 * boolean flags ("configured" or not) so the page can show "you've
 * configured Anthropic" without leaking the key back to the browser.
 */
export function readSafeSettings(): {
  orchestrator: {
    provider: OrchestratorSettings["provider"];
    model: string;
    anthropicKeyConfigured: boolean;
    openaiKeyConfigured: boolean;
  };
} {
  const s = readSettings();
  return {
    orchestrator: {
      provider: s.orchestrator?.provider ?? "openai",
      model: s.orchestrator?.model ?? "gpt-4.1-mini",
      anthropicKeyConfigured: !!s.orchestrator?.anthropicApiKey,
      openaiKeyConfigured: !!s.orchestrator?.openaiApiKey,
    },
  };
}
