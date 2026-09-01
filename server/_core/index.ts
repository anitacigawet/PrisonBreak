import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import * as fs from "node:fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { initDb } from "../db";
import { resolveStoragePath } from "../storage";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initializeWebSocket } from "./websocket";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // DB must be initialized before any tRPC handler runs.
  await initDb();

  const app = express();
  const server = createServer(app);

  initializeWebSocket(server);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Serve uploaded case documents from the local storage directory.
  app.get("/api/files/*", (req, res) => {
    const key = decodeURIComponent(req.path.replace(/^\/api\/files\//, ""));
    try {
      const fullPath = resolveStoragePath(key);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.sendFile(fullPath);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "127.0.0.1";
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(err => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
