import { createHash, randomBytes } from "node:crypto";

import { Algorithm, hash, verify } from "@node-rs/argon2";

const PASSWORD_OPTIONS = {
  algorithm: Algorithm.Argon2id,

  memoryCost: 19_456,

  timeCost: 2,

  parallelism: 1,

  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
