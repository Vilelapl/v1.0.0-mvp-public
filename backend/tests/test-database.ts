export function readTestDatabaseUrl(
  source: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = source.TEST_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    (parsedUrl.protocol !== "postgresql:" &&
      parsedUrl.protocol !== "postgres:") ||
    !databaseName.toLowerCase().includes("test")
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target a database whose name contains `test`.",
    );
  }

  return databaseUrl;
}
