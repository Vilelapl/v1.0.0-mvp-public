import type { DatabaseClient } from "../../lib/prisma.js";

export class AuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  findUserByEmail(email: string) {
    return this.database.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    });
  }

  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.database.webSession.create({
      data: input,
      select: {
        id: true,
        expiresAt: true,
      },
    });
  }

  findActiveSessionByTokenHash(tokenHash: string, now: Date) {
    return this.database.webSession.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: now },
        revokedAt: null,
      },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  revokeSession(sessionId: string, now: Date) {
    return this.database.webSession.updateMany({
      where: {
        id: sessionId,
        expiresAt: { gt: now },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  }
}
