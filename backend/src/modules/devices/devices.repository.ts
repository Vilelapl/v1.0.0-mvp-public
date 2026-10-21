import type { DatabaseClient } from "../../lib/prisma.js";

const publicDeviceSelect = {
  id: true,
  name: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export class DevicesRepository {
  constructor(private readonly database: DatabaseClient) {}

  createPairingCode(input: {
    userId: string;
    codeHash: string;
    expiresAt: Date;
  }) {
    return this.database.pairingCode.create({
      data: { ...input, consumedAt: null },
      select: { expiresAt: true },
    });
  }

  consumeCodeAndCreateDevice(input: {
    codeHash: string;
    name: string;
    tokenHash: string;
  }) {
    return this.database.$transaction(async (transaction) => {
      const now = new Date();
      // UPDATE locks the matching row. PostgreSQL rechecks consumedAt after
      // waiting for a competing transaction, so only one request can claim it.
      const [code] = await transaction.pairingCode.updateManyAndReturn({
        where: {
          codeHash: input.codeHash,
          expiresAt: { gt: now },
          consumedAt: null,
        },
        data: { consumedAt: now },
        select: { userId: true },
      });

      if (!code) {
        return null;
      }

      // A failed insert also rolls back consumption of the code.
      return transaction.device.create({
        data: {
          userId: code.userId,
          name: input.name,
          tokenHash: input.tokenHash,
          lastSeenAt: null,
          revokedAt: null,
        },
        select: { id: true },
      });
    }, { isolationLevel: "ReadCommitted" });
  }

  listByUser(userId: string) {
    return this.database.device.findMany({
      where: { userId },
      select: publicDeviceSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async revokeByUser(userId: string, deviceId: string, now: Date) {
    const result = await this.database.device.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: now },
    });

    if (result.count === 1) {
      return true;
    }

    // Repeated revocation succeeds without changing the original timestamp.
    return (await this.database.device.findFirst({
      where: { id: deviceId, userId },
      select: { id: true },
    })) !== null;
  }

  findActiveByTokenHash(tokenHash: string) {
    return this.database.device.findFirst({
      where: { tokenHash, revokedAt: null },
      select: { id: true, userId: true, lastSeenAt: true },
    });
  }

  touchLastSeen(userId: string, deviceId: string, now: Date, cutoff: Date) {
    return this.database.device.updateMany({
      where: {
        id: deviceId,
        userId,
        revokedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: cutoff } }],
      },
      data: { lastSeenAt: now },
    });
  }
}
