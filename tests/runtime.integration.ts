/** Production smoke against disposable data; never loads the checkout's .env. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/routers";
import { researchCommandEnvironment } from "../server/research";

test("built app starts with fresh isolated state, protects API, uploads inert evidence and deletes it", { timeout: 60000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const entry = path.join(root, "dist", "index.js");
  assert.ok(fs.existsSync(entry), "Run pnpm build before this integration test.");
  const python = process.env.PRISONBREAK_TEST_PYTHON ?? path.join(root, ".venv-rag", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  assert.ok(fs.existsSync(python), "Install the documented RAG environment before this integration test.");
  const fixture = fs.mkdtempSync(path.join(tmpdir(), "prisonbreak-runtime-"));
  fs.cpSync(path.join(root, "drizzle", "migrations"), path.join(fixture, "drizzle", "migrations"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "server", "rag"), { recursive: true });
  for (const file of ["worker.py", "__init__.py"]) {
    const source = path.join(root, "server", "rag", file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fixture, "server", "rag", file));
  }
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  // Retain only OS paths, not provider credentials or environment overrides.
  const core = researchCommandEnvironment(process.env);
  for (const key of Object.keys(core)) if (/KEY|TOKEN|CLAUDE/i.test(key)) delete core[key];
  const child = spawn(process.execPath, [entry], {
    cwd: fixture, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...core, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
      PRISONBREAK_DATA_DIR: path.join(fixture, "data"), PRISONBREAK_PYTHON: python,
      PRISONBREAK_RESEARCH_PROVIDER: "claude" },
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-16000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-16000); });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Isolated server did not start: " + output)), 20000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      child.stdout.on("data", () => {
        const match = output.match(/Server running on (http:\/\/127\.0\.0\.1:\d+)\//);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="root"/);
    assert.equal((await fetch(origin + "/api/trpc/cases.list")).status, 403);
    assert.equal((await fetch(origin + "/api/session", { method: "POST", headers: { Origin: "https://unrelated.example" } })).status, 403);
    const session = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
    assert.equal(session.status, 204);
    const cookie = session.headers.getSetCookie()[0].split(";", 1)[0];
    const headers = { Cookie: cookie, Origin: origin };
    const client = createTRPCProxyClient<AppRouter>({ links: [httpBatchLink({ url: origin + "/api/trpc", transformer: superjson, headers })] });
    assert.deepEqual(await client.cases.list.query(), []);
    const health = await client.rag.status.query();
    assert.equal(health.qdrantAvailable, true);
    assert.equal(health.fastembedAvailable, true);
    await client.settings.updateOrchestrator.mutate({ provider: "openai", model: "synthetic-model", openaiApiKey: "SYNTHETIC-NOT-A-CREDENTIAL" });
    await client.settings.updateOrchestrator.mutate({ model: "synthetic-new-model" });
    const settings = await client.settings.get.query();
    assert.ok(!JSON.stringify(settings).includes("SYNTHETIC-NOT-A-CREDENTIAL"));
    assert.equal(settings.orchestrator.model, "synthetic-new-model");
    const created = await client.cases.create.mutate({ title: "Synthetic runtime case" });
    const html = '<script>throw new Error("synthetic active document")</script><p>synthetic evidence</p>';
    const upload = await client.documents.upload.mutate({ caseId: created.caseId, fileName: "evidence.html", mimeType: "text/html", fileData: Buffer.from(html).toString("base64") });
    assert.equal(upload.success, true);
    assert.ok("fileUrl" in upload);
    const download = await fetch(origin + upload.fileUrl, { headers });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment/);
    assert.match(download.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await download.text(), html);
    assert.equal((await fetch(origin + upload.fileUrl)).status, 403);
    await client.cases.delete.mutate({ id: created.caseId });
    assert.deepEqual(await client.cases.list.query(), []);
    assert.equal((await fetch(origin + upload.fileUrl, { headers })).status, 404);
    assert.equal(fs.existsSync(path.join(fixture, "data", "uploads", "cases", String(created.caseId))), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
