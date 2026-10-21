import type { DatabaseClient } from "./prisma.js";

const READINESS_TIMEOUT_MS = 3_000;

export function createReadinessCheck(database: DatabaseClient) {
  let pending: Promise<boolean> | undefined;

  return async (): Promise<boolean> => {
    // Reuse an outstanding probe so a database outage cannot accumulate queries.
    pending ??= database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      await transaction.$queryRaw`SELECT 1`;
    }, { maxWait: 1_000, timeout: 2_500 })
      .then(() => true, () => false)
      .finally(() => { pending = undefined; });

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
