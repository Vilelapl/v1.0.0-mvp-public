import { authenticationRequired } from "../../lib/api-error.js";
import { normalizeEmail } from "../../lib/normalization.js";
import { verifyPassword } from "../../lib/password.js";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "../../lib/session-token.js";
import type { LoginInput } from "./auth.schema.js";
import { AuthRepository } from "./auth.repository.js";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$l4v5B8h+46Obksz7UkezIw$x5mKjaYk59KNMmthVXxEdv8iv6OCgahEeWZThBP9BzU";

export type PublicUser = {
  id: string;
  email: string;
};

export type AuthenticatedWebIdentity = {
  userId: string;
  email: string;
  sessionId: string;
};

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMinutes: number,
  ) {}

  async login(input: LoginInput): Promise<{
    token: string;
    expiresAt: Date;
    user: PublicUser;
  }> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.findUserByEmail(email);
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      input.password,
    );

    if (!user || !passwordMatches) {
      throw authenticationRequired("Credenciales inválidas");
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + this.sessionTtlMinutes * 60 * 1000,
    );

    await this.repository.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email },
    };
  }

  async authenticate(token: string): Promise<AuthenticatedWebIdentity | null> {
    if (!isSessionToken(token)) {
      return null;
    }

    const session = await this.repository.findActiveSessionByTokenHash(
      hashSessionToken(token),
      new Date(),
    );

    if (!session) {
      return null;
    }

    return {
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.id,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repository.revokeSession(sessionId, new Date());
  }
}
