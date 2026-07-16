import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const standaloneAppRoot = path.join(
  appRoot,
  ".next",
  "standalone",
  "apps",
  "web",
);

function copyDirectory(source, destination) {
  if (!existsSync(source)) {
    return false;
  }

  rmSync(destination, { force: true, recursive: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });

  return true;
}

if (!existsSync(standaloneAppRoot)) {
  throw new Error(
    `Standalone output not found at ${path.relative(appRoot, standaloneAppRoot)}`,
  );
}

const copiedStatic = copyDirectory(
  path.join(appRoot, ".next", "static"),
  path.join(standaloneAppRoot, ".next", "static"),
);

copyDirectory(
  path.join(appRoot, "public"),
  path.join(standaloneAppRoot, "public"),
);

if (!copiedStatic) {
  throw new Error("Next static assets were not found at .next/static");
}

console.log("Copied Next static assets into the standalone bundle.");
