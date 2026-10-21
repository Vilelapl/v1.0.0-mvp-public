import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readTestDatabaseUrl } from "./test-database.js";

export default function setup(): void {
  const databaseUrl = readTestDatabaseUrl();
  const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
  const prismaCli = fileURLToPath(
    new URL("../node_modules/prisma/build/index.js", import.meta.url),
  );

  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
}
