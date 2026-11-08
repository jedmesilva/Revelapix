import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = 1;

export type RedemptionProfileData = {
  keyType: "cpf" | "phone" | "email" | "evp";
  pixKey: string;
  holderCpf: string;
};

type EncryptedRedemptionProfile = {
  encryptedData: string;
  iv: string;
  authTag: string;
  encryptionVersion: number;
};

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured to protect saved redemption details.");
  }

  return Buffer.from(
    hkdfSync("sha256", secret, "revela-redemption-profile-v1", "aes-256-gcm", 32),
  );
}

export function encryptRedemptionProfile(profile: RedemptionProfileData): EncryptedRedemptionProfile {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(profile), "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedData: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function decryptRedemptionProfile(profile: EncryptedRedemptionProfile): unknown {
  if (profile.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error("Unsupported saved redemption details encryption version.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(profile.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(profile.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(profile.encryptedData, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8")) as unknown;
}
