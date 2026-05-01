import { context } from "esbuild";
import { copyFile, mkdir, watch } from "fs/promises";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

await mkdir("dist", { recursive: true });

const ctx = await context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  sourcemap: true,
  target: ["chrome100"],
  outfile: "dist/bundle.js",
  format: "iife",
  globalName: "VivViz",
});

await ctx.watch();

await copyFile("public/index.html", "dist/index.html");
await copyFile("public/style.css", "dist/style.css");
await copyFile("public/sample-chronicle.json", "dist/sample-chronicle.json");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
};

const server = createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = join("dist", urlPath);
  const ext = extname(filePath);
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(3000, () => {
  console.log("Dev server running at http://localhost:3000");
});
