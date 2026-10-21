import { randomBytes } from "node:crypto";

import { AppError } from "../../lib/api-error.js";
import {
  generateOpaqueToken,
  hashSecret,
  isOpaqueToken,
} from "../../lib/credentials.js";
import type { DevicesRepository } from "./devices.repository.js";
import type { PairInput } from "./devices.schemas.js";

// 32 symbols, without I/O/0/1: ten independent symbols provide 50 random bits.
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

export class DevicesService {
  constructor(
    private readonly repository: DevicesRepository,
    private readonly pairingCodeTtlMinutes: number,
  ) {}

  async createPairingCode(userId: string) {
    const code = Array.from(randomBytes(10), (byte) =>
      PAIRING_ALPHABET[byte & 31],
    ).join("");
    const expiresAt = new Date(Date.now() + this.pairingCodeTtlMinutes * 60 * 1000);
    await this.repository.createPairingCode({
      userId,
      codeHash: hashSecret(code),
      expiresAt,
    });
    return { code, expiresAt };
  }

  async pair(input: PairInput) {
    const deviceToken = generateOpaqueToken();
    const device = await this.repository.consumeCodeAndCreateDevice({
      codeHash: hashSecret(input.code),
      name: input.deviceName,
      tokenHash: hashSecret(deviceToken),
    });

    if (!device) {
      throw new AppError("VALIDATION_ERROR", 400, "Código de emparejamiento inválido");
    }

    return { deviceId: device.id, deviceToken };
  }

  list(userId: string) {
    return this.repository.listByUser(userId);
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    if (!await this.repository.revokeByUser(userId, deviceId, new Date())) {
      throw new AppError("NOT_FOUND", 404, "Dispositivo no encontrado");
    }
  }

  async authenticate(token: string): Promise<Express.AuthenticatedDeviceIdentity | null> {
    if (!isOpaqueToken(token)) {
      return null;
    }

    // Always consult PostgreSQL: revocation takes effect on the next request.
    const device = await this.repository.findActiveByTokenHash(hashSecret(token));
    if (!device) {
      return null;
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - LAST_SEEN_INTERVAL_MS);
    if (!device.lastSeenAt || device.lastSeenAt <= cutoff) {
      await this.repository.touchLastSeen(device.userId, device.id, now, cutoff);
    }

    return { userId: device.userId, deviceId: device.id };
  }
}
