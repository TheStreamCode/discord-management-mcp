import { cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const vitestBin = path.join(projectRoot, "node_modules", "vitest", "vitest.mjs");

if (!projectRoot.includes("#")) {
  const result = spawnSync(process.execPath, [vitestBin, "run"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const tempRoot = path.join(tmpdir(), `discord-management-vitest-${process.pid}`);

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  for (const entry of ["package.json", "tsconfig.json", "vitest.config.ts", "src"]) {
    cpSync(path.join(projectRoot, entry), path.join(tempRoot, entry), {
      recursive: true,
      force: true,
    });
  }

  symlinkSync(path.join(projectRoot, "node_modules"), path.join(tempRoot, "node_modules"), "junction");

  const result = spawnSync(process.execPath, [vitestBin, "run"], {
    cwd: tempRoot,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

