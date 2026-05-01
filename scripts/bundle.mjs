import { build } from "esbuild";
import { copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["chrome100", "firefox100", "safari15"],
  outfile: "dist/bundle.js",
  format: "iife",
  globalName: "VivViz",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Copy static assets to dist
await copyFile("public/index.html", "dist/index.html");
await copyFile("public/style.css", "dist/style.css");
await copyFile("public/sample-chronicle.json", "dist/sample-chronicle.json");

console.log("Build complete → dist/");
