import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { LocalRagBridge } from "../server/rag/bridge";

class DelayedCloseChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills = 0;
  kill() { this.kills++; return true; }
}

for (const trigger of ["timeout", "stdout", "stdin", "spawn"] as const) {
  test(`RAG ${trigger} failure keeps queue occupied until delayed child close`, async () => {
    const children: DelayedCloseChild[] = [];
    const bridge = new LocalRagBridge({ timeoutMs: trigger === "timeout" ? 15 : 2000 }, (() => {
      const child = new DelayedCloseChild(); children.push(child); return child;
    }) as unknown as typeof spawn);
    let firstSettled = false;
    const first = bridge.health().then(() => { firstSettled = true; throw new Error("Expected failure"); }, error => { firstSettled = true; return error as Error; });
    const second = bridge.health();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(children.length, 1);
    const child = children[0];
    if (trigger === "stdout") child.stdout.write("x".repeat(16 * 1024 * 1024 + 1));
    if (trigger === "stdin") child.stdin.emit("error", new Error("synthetic EPIPE"));
    if (trigger === "spawn") child.emit("error", new Error("synthetic spawn error"));
    if (trigger === "timeout") await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(child.kills, 1);
    assert.equal(firstSettled, false);
    assert.equal(children.length, 1, "next worker must not start merely because kill was requested");
    child.emit("close", 1);
    assert.ok(await first instanceof Error);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(children.length, 2);
    children[1].stdout.write(JSON.stringify({ ok: true, result: { synthetic: true } }));
    children[1].emit("close", 0);
    assert.deepEqual(await second, { synthetic: true });
  });
}
