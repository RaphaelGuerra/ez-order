#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_PATH = "apps/web/public/catalog/order-config.json";
const DEFAULT_TARGET_PATH = "apps/web/src/config/order-config.json";

const sourceArg = process.argv[2] ?? DEFAULT_SOURCE_PATH;
const targetArg = process.argv[3] ?? DEFAULT_TARGET_PATH;

const sourcePath = path.resolve(process.cwd(), sourceArg);
const targetPath = path.resolve(process.cwd(), targetArg);

function fail(message) {
  console.error(`[catalog] ${message}`);
  process.exit(1);
}

let sourceRaw = "";
try {
  sourceRaw = fs.readFileSync(sourcePath, "utf8");
} catch (error) {
  fail(`Could not read source file: ${sourcePath}\n${String(error)}`);
}

let parsed;
try {
  parsed = JSON.parse(sourceRaw);
} catch (error) {
  fail(`Source file is not valid JSON: ${sourcePath}\n${String(error)}`);
}

const formatted = `${JSON.stringify(parsed, null, 2)}\n`;

try {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, formatted, "utf8");
} catch (error) {
  fail(`Could not write target file: ${targetPath}\n${String(error)}`);
}

console.log(
  `[catalog] Synced fallback config (${path.relative(process.cwd(), targetPath)} <= ${path.relative(process.cwd(), sourcePath)})`,
);
