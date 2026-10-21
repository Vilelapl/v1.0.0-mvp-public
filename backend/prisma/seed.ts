import "dotenv/config";

import {
  AdministrativeConfigurationError,
  readBootstrapEmail,
} from "../src/lib/administrative-environment.js";
import { normalizeCategoryName } from "../src/lib/normalization.js";
import {
  createPrismaClient,
  readDatabaseUrl,
} from "../src/lib/prisma.js";

const prisma = createPrismaClient(readDatabaseUrl());

const INITIAL_CATEGORIES = [
  "Comida",
  "Transporte",
  "Entretenimiento",
  "Compras",
  "Servicios",
  "Salud",
  "Educación",
  "Otros",
] as const;

class OwnerNotFoundError extends Error {
  constructor() {
    super("Owner not found. Run `npm run bootstrap` before `npm run db:seed`.");
    this.name = "OwnerNotFoundError";
  }
}

async function seedCategories(): Promise<void> {
  const email = readBootstrapEmail();
  const owner = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!owner) {
    throw new OwnerNotFoundError();
  }

  await prisma.$transaction(
    INITIAL_CATEGORIES.map((name) => {
      const normalizedName = normalizeCategoryName(name);

      return prisma.category.upsert({
        where: {
          userId_normalizedName: {
            userId: owner.id,
            normalizedName,
          },
        },
        update: {},
        create: {
          userId: owner.id,
          name,
          normalizedName,
        },
      });
    }),
  );

  console.log("Initial category seed completed successfully.");
}

try {
  await seedCategories();
} catch (error: unknown) {
  if (
    error instanceof AdministrativeConfigurationError ||
    error instanceof OwnerNotFoundError
  ) {
    console.error(error.message);
  } else {
    console.error(
      "Initial category seed failed. Verify the database connection and migration state.",
    );
  }

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
