import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";

// --- Encryption (AES-256-GCM) ---

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    // Auto-generate for dev; in production this MUST be set
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-char hex string in production");
    }
    return crypto.createHash("sha256").update("dev-key-not-for-production").digest();
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, tag]), iv };
}

function decrypt(ciphertext: Buffer, iv: Buffer): string {
  const key = getEncryptionKey();
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

// --- Database ---

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
}

export interface UserRecord {
  googleUserId: string;
  email: string;
  displayName?: string;
  tokens: StoredTokens;
}

let db: Database.Database | null = null;

export function initDb(dbPath?: string): Database.Database {
  const path = dbPath || process.env.DATABASE_PATH || "./data/tokens.db";

  // Ensure directory exists
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      google_user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      access_token_enc BLOB NOT NULL,
      access_token_iv BLOB NOT NULL,
      refresh_token_enc BLOB,
      refresh_token_iv BLOB,
      expiry_date INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function saveUserTokens(
  googleUserId: string,
  email: string,
  displayName: string | undefined,
  tokens: StoredTokens
): void {
  const d = getDb();

  const accessEnc = encrypt(tokens.accessToken);
  let refreshEnc: { ciphertext: Buffer; iv: Buffer } | null = null;
  if (tokens.refreshToken) {
    refreshEnc = encrypt(tokens.refreshToken);
  }

  d.prepare(`
    INSERT INTO user_tokens (google_user_id, email, display_name, access_token_enc, access_token_iv, refresh_token_enc, refresh_token_iv, expiry_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(google_user_id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      access_token_enc = excluded.access_token_enc,
      access_token_iv = excluded.access_token_iv,
      refresh_token_enc = COALESCE(excluded.refresh_token_enc, user_tokens.refresh_token_enc),
      refresh_token_iv = COALESCE(excluded.refresh_token_iv, user_tokens.refresh_token_iv),
      expiry_date = excluded.expiry_date,
      updated_at = unixepoch()
  `).run(
    googleUserId,
    email,
    displayName || null,
    accessEnc.ciphertext,
    accessEnc.iv,
    refreshEnc?.ciphertext || null,
    refreshEnc?.iv || null,
    tokens.expiryDate || null
  );
}

export function getUserTokens(googleUserId: string): UserRecord | null {
  const d = getDb();
  const row = d.prepare(
    "SELECT * FROM user_tokens WHERE google_user_id = ?"
  ).get(googleUserId) as {
    google_user_id: string;
    email: string;
    display_name: string | null;
    access_token_enc: Buffer;
    access_token_iv: Buffer;
    refresh_token_enc: Buffer | null;
    refresh_token_iv: Buffer | null;
    expiry_date: number | null;
  } | undefined;

  if (!row) return null;

  const accessToken = decrypt(row.access_token_enc, row.access_token_iv);
  let refreshToken: string | undefined;
  if (row.refresh_token_enc && row.refresh_token_iv) {
    refreshToken = decrypt(row.refresh_token_enc, row.refresh_token_iv);
  }

  return {
    googleUserId: row.google_user_id,
    email: row.email,
    displayName: row.display_name || undefined,
    tokens: {
      accessToken,
      refreshToken,
      expiryDate: row.expiry_date || undefined,
    },
  };
}

export function deleteUserTokens(googleUserId: string): void {
  getDb().prepare("DELETE FROM user_tokens WHERE google_user_id = ?").run(googleUserId);
}

export function getUserCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM user_tokens").get() as { count: number };
  return row.count;
}
