import "dotenv/config";

import {
  AdministrativeConfigurationError,
  readBootstrapEmail,
  readBootstrapPassword,
} from "../lib/administrative-environment.js";
import { hashPassword } from "../lib/password.js";
import { createPrismaClient, readDatabaseUrl } from "../lib/prisma.js";

const prisma = createPrismaClient(readDatabaseUrl());

async function bootstrapOwner(): Promise<void> {
  const email = readBootstrapEmail();
  const password = readBootstrapPassword();
  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log("Owner bootstrap completed successfully.");
}

try {
  await bootstrapOwner();
} catch (error: unknown) {
  if (error instanceof AdministrativeConfigurationError) {
    console.error(error.message);
  } else {
    console.error(
      "Owner bootstrap failed. Verify the database connection and migration state.",
    );
  }

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
