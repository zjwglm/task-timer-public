import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type App = Hono<{ Bindings: HttpBindings }>;

// Try multiple possible paths for dist/public
function findDistPath(): string | null {
  const candidates = [
    // Railway Docker: /app/dist/public
    path.resolve(process.cwd(), "dist/public"),
    // Relative to this file: ../../dist/public
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/public"),
    // Absolute /app
    "/app/dist/public",
    // Current working directory
    path.resolve("dist/public"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      console.log(`[vite] Found dist/public at: ${p}`);
      return p;
    }
  }

  console.error("[vite] Could not find dist/public. Checked paths:");
  for (const p of candidates) {
    console.error(`  - ${p} (exists: ${fs.existsSync(p)})`);
  }
  return null;
}

const distPath = findDistPath();

// MIME type map
const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || "application/octet-stream";
}

function serveFile(c: any, filePath: string) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath);
  const mime = getMimeType(filePath);
  return c.body(content, 200, { "Content-Type": mime });
}

export function serveStaticFiles(app: App) {
  if (!distPath) {
    app.get("/", (c) => c.json({ error: "Static files not found" }, 500));
    return;
  }

  // Serve index.html at root
  app.get("/", (c) => {
    const result = serveFile(c, path.resolve(distPath, "index.html"));
    if (result) return result;
    return c.json({ error: "index.html not found" }, 500);
  });

  // Serve static files
  app.get("/*", (c) => {
    const url = new URL(c.req.url);
    const filePath = path.resolve(distPath, "." + url.pathname);

    // Security: ensure file is within distPath
    if (!filePath.startsWith(distPath)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // If path is a directory or doesn't exist, fallback to index.html for SPA routing
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // Only fallback for non-asset requests (no file extension)
      if (!path.extname(url.pathname)) {
        const result = serveFile(c, path.resolve(distPath, "index.html"));
        if (result) return result;
      }
      return c.json({ error: "Not Found" }, 404);
    }

    const result = serveFile(c, filePath);
    if (result) return result;
    return c.json({ error: "Not Found" }, 404);
  });
}
