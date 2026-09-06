import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { io as connect } from "socket.io-client";
import { createLocalSecurity, uploadedFileHeaders } from "../server/_core/localSecurity";
import { initializeWebSocket } from "../server/_core/websocket";
import { fetchAndSnapshotSource, isPublicAddress, requestPinnedSource } from "../server/sources/fetch";
import { validatePrimarySourceUrl } from "../server/research/schema";

function request(port: number, pathname: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path: pathname, headers, method }, response => {
      let body = "";
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    });
    req.on("error", reject); req.end();
  });
}

test("HTTP port 80 canonical origins and explicit default-port Hosts bootstrap correctly", async () => {
  for (const configuredPort of [80, 3000]) {
    const app = express();
    const security = createLocalSecurity(configuredPort);
    security.install(app);
    app.get("/api/example", (_req, res) => res.json({ synthetic: true }));
    const server = createServer(app);
    // Exercise HTTP headers on an ephemeral socket; no privileged port needed.
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socketPort = (server.address() as { port: number }).port;
    try {
      for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
        const url = new URL(`http://${hostname}:${configuredPort}`);
        assert.equal(security.isAllowedOrigin(url.origin), true);
        for (const host of new Set([url.host, `${hostname}:${configuredPort}`])) {
          const bootstrap = await request(socketPort, "/api/session", { Host: host, Origin: url.origin }, "POST");
          assert.equal(bootstrap.status, 204, `${host} ${url.origin}`);
          const cookie = bootstrap.headers["set-cookie"]![0].split(";", 1)[0];
          assert.equal((await request(socketPort, "/api/example", { Host: host, Origin: url.origin, Cookie: cookie })).status, 200);
          assert.equal((await request(socketPort, "/api/example", { Host: host, Origin: `http://${hostname}:${configuredPort + 1}`, Cookie: cookie })).status, 403);
        }
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test("HTTP and both Socket.IO transports require the exact local origin and process session", async () => {
  const app = express();
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const security = createLocalSecurity(port);
  security.install(app);
  app.get("/api/example", (_req, res) => res.json({ synthetic: true }));
  app.get("/api/document", (_req, res) => res.set(uploadedFileHeaders).attachment("example.html").send("<script>example</script>"));
  const io = initializeWebSocket(server, security, async caseId => caseId === 1);
  try {
    assert.equal((await request(port, "/api/example")).status, 403);
    assert.equal((await request(port, "/api/session", { Origin: "https://attacker.example" }, "POST")).status, 403);
    assert.equal((await request(port, "/api/session", { Host: `rebind.example:${port}`, Origin: `http://rebind.example:${port}` }, "POST")).status, 403);
    assert.equal((await request(port, "/api/session", {}, "POST")).status, 403);
    const bootstrap = await request(port, "/api/session", { Origin: origin }, "POST");
    assert.equal(bootstrap.status, 204);
    const setCookie = bootstrap.headers["set-cookie"]![0];
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";", 1)[0];
    assert.equal((await request(port, "/api/example", { Cookie: cookie })).status, 200);
    for (const headers of [
      { Cookie: cookie, Origin: "https://attacker.example" },
      { Cookie: cookie, Origin: "null" },
      { Cookie: cookie, Origin: `http://127.0.0.1:${port + 1}` },
      { Cookie: cookie, Origin: `http://localhost:${port}` },
      { Cookie: cookie, Host: `rebind.example:${port}` },
      { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
      { Cookie: cookie.replace(/=.+/, `=${"a".repeat(63)}`) },
      { Cookie: `${cookie}; ${cookie}` },
    ]) assert.equal((await request(port, "/api/example", headers)).status, 403);
    const document = await request(port, "/api/document", { Cookie: cookie });
    assert.match(String(document.headers["content-disposition"]), /^attachment/);
    assert.match(String(document.headers["content-security-policy"]), /sandbox/);
    assert.equal(document.headers["x-content-type-options"], "nosniff");

    for (const transport of ["websocket", "polling"] as const) {
      for (const headers of [{ Origin: "https://attacker.example", Cookie: cookie }, { Origin: origin }]) {
        const socket = connect(origin, { path: "/api/socket.io", transports: [transport], extraHeaders: headers, reconnection: false, timeout: 1000 });
        await new Promise<void>((resolve, reject) => { socket.once("connect_error", () => { socket.close(); resolve(); }); socket.once("connect", () => { socket.close(); reject(new Error("unauthorized socket connected")); }); });
      }
      const socket = connect(origin, { path: "/api/socket.io", transports: [transport], extraHeaders: { Origin: origin, Cookie: cookie }, reconnection: false, timeout: 1000 });
      try {
        await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
        for (const caseId of [0, -1, "1", "*", {}, 2, 1.5]) {
          const result = await socket.timeout(1000).emitWithAck("join-case", caseId);
          assert.deepEqual(result, { ok: false });
        }
        assert.deepEqual(await socket.timeout(1000).emitWithAck("join-case", 1), { ok: true });
        const event = new Promise(resolve => socket.once("synthetic-event", resolve));
        io.to("case-1").emit("synthetic-event", { synthetic: true });
        assert.deepEqual(await event, { synthetic: true });
      } finally { socket.close(); }
    }
    const upgrading = connect(origin, { path: "/api/socket.io", transports: ["polling", "websocket"], extraHeaders: { Origin: origin, Cookie: cookie }, reconnection: false, timeout: 1000 });
    try {
      await new Promise<void>((resolve, reject) => { upgrading.once("connect", resolve); upgrading.once("connect_error", reject); });
      if (upgrading.io.engine.transport.name !== "websocket") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("authorized upgrade failed")), 2000);
          upgrading.io.engine.once("upgrade", () => { clearTimeout(timer); resolve(); });
        });
      }
      assert.equal(upgrading.io.engine.transport.name, "websocket");
      assert.deepEqual(await upgrading.timeout(1000).emitWithAck("join-case", 1), { ok: true });
      upgrading.disconnect(); upgrading.connect();
      await new Promise<void>((resolve, reject) => { upgrading.once("connect", resolve); upgrading.once("connect_error", reject); });
      assert.deepEqual(await upgrading.timeout(1000).emitWithAck("join-case", 1), { ok: true });
    } finally { upgrading.close(); }
  } finally { await new Promise<void>(resolve => io.close(() => resolve())); }
});

test("public IP classification is byte-normalized and denies reserved ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.1.2", "169.254.169.254", "100.64.1.2", "192.0.2.4", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a00:1", "::ffff:ac10:102", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "2001::1", "3fff::1", "fe80::1%1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:808:808"]) assert.equal(isPublicAddress(ip), true, ip);
});

function connector(responses: Array<{ status?: number; headers?: Record<string, string>; body?: string }>, observed: unknown[]) {
  return ((url: URL, options: import("node:https").RequestOptions, callback: (response: unknown) => void) => {
    observed.push({ url: url.toString(), options });
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const fixture = responses.shift()!;
      const response = new PassThrough() as PassThrough & { headers: Record<string, string>; statusCode: number };
      response.headers = fixture.headers ?? { "content-type": "text/plain" };
      response.statusCode = fixture.status ?? 200;
      queueMicrotask(() => { callback(response); response.end(fixture.body ?? "Synthetic official source text only."); });
    };
    return req;
  }) as unknown as typeof import("node:https").request;
}

test("pinned connector uses exactly the validated address and retains TLS hostname", async () => {
  const observed: any[] = [];
  let resolutions = 0;
  const response = await requestPinnedSource(new URL("https://example.gov/evidence"), AbortSignal.timeout(1000), {
    resolveHost: async () => { resolutions++; return [{ address: "8.8.8.8", family: 4 }]; },
    requestImpl: connector([{}], observed),
  });
  assert.match(await response.text(), /Synthetic/);
  assert.equal(resolutions, 1); assert.equal(observed[0].options.agent, false); assert.equal(observed[0].options.servername, "example.gov");
  const lookup = observed[0].options.lookup;
  lookup("example.gov", {}, (error: unknown, address: string, family: number) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
  lookup("example.gov", { all: true }, (error: unknown, records: unknown) => { assert.equal(error, null); assert.deepEqual(records, [{ address: "8.8.8.8", family: 4 }]); });
  await assert.rejects(requestPinnedSource(new URL("https://example.gov"), AbortSignal.timeout(1000), { resolveHost: async () => [{ address: "::ffff:a9fe:a9fe", family: 6 }], requestImpl: connector([], []) }), /private or reserved/);
});

test("DNS admission deadline rejects without opening a connection", async () => {
  const controller = new AbortController();
  const observed: unknown[] = [];
  const pending = requestPinnedSource(new URL("https://example.gov/source"), controller.signal, { resolveHost: () => new Promise(() => {}), requestImpl: connector([], observed) });
  controller.abort(new Error("synthetic lookup deadline"));
  await assert.rejects(pending, /lookup deadline/);
  assert.equal(observed.length, 0);
});

test("malformed response metadata rejects instead of throwing outside the request promise", async () => {
  await assert.rejects(requestPinnedSource(new URL("https://example.gov/source"), AbortSignal.timeout(1000), { resolveHost: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: connector([{ headers: { "invalid\nname": "x" } }], []) }));
});

test("initial URL and every redirect retain official HTTPS port-443 policy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prisonbreak-source-test-"));
  try {
    for (const bad of ["http://example.gov/doc", "https://outside.example/doc", "https://example.gov:8443/doc", "https://user:pass@example.gov/doc"]) {
      assert.throws(() => validatePrimarySourceUrl(bad));
      const observed: unknown[] = [];
      await assert.rejects(fetchAndSnapshotSource({ caseId: 1, corpusKey: "test", url: "https://example.gov/redirect" }, { dataRoot: root, resolveHost: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: connector([{ status: 302, headers: { location: bad } }], observed) }));
      assert.equal(observed.length, 1);
    }
    const observed: unknown[] = [];
    const artifact = await fetchAndSnapshotSource({ caseId: 1, corpusKey: "test", url: "https://example.gov/start" }, { dataRoot: root, resolveHost: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: connector([{ status: 302, headers: { location: "https://court.gov/source" } }, {}], observed) });
    assert.equal(observed.length, 2); assert.equal(artifact.canonicalUrl, "https://court.gov/source");
    assert.match(await readFile(artifact.snapshotPath, "utf8"), /Synthetic official/);
    assert.equal(validatePrimarySourceUrl("https://court.example/source", ["court.example"]), "https://court.example/source");
  } finally { await rm(root, { recursive: true, force: true }); }
});
