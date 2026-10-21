import { describe, expect, it } from "vitest";

import { normalizeCategoryName, normalizeEmail } from "./normalization.js";
import { hashPassword, verifyPassword } from "./password.js";

describe("security helpers", () => {
  it("creates a verifiable Argon2id password hash", async () => {
    const password = "local-test-password";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toMatch(/^\$argon2id\$/u);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, "incorrect-password"),
    ).resolves.toBe(false);
  });

  it("uses the documented administrative normalization", () => {
    expect(normalizeEmail("  Owner@Example.COM  ")).toBe("owner@example.com");
    expect(normalizeCategoryName("  Educación   Financiera  ")).toBe(
      "educación financiera",
    );
  });
});
