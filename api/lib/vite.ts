import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type App = Hono<{ Bindings: HttpBindings }>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../../dist/public");

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
  // Serve index.html at root
  app.get("/", (c) => {
    const result = serveFile(c, path.resolve(distPath, "index.html"));
    if (result) return result;
    return c.json({ error: "index.html not found" }, 500);
  });

  // Serve static files
  app.get("/*", (c) => {
    const url = new URL(c.req.url);
    let filePath = path.resolve(distPath, "." + url.pathname);

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
