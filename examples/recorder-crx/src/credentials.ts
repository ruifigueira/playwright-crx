/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Per-server GraphX credentials cached in chrome.storage.local.
//
// SECURITY NOTE — read before relying on this.
// The password is encrypted with AES-GCM, but the key is derived from
// chrome.runtime.id + a per-install random salt that is itself stored in
// chrome.storage.local. This means:
//   • A passive attacker with only a copy of the storage file CANNOT read
//     the password — they'd need the extension's runtime id too, and to
//     reproduce the PBKDF2 derivation.
//   • Any code running inside this extension's context CAN decrypt
//     (chrome.runtime.id + salt are both reachable from JS).
// In other words, this is obfuscation hardened against casual disk
// inspection — not protection against an attacker who can execute code
// inside the extension. Treat it accordingly.

export type Credentials = {
  username: string;
  password: string;
};

const STORE_KEY = 'graphxCredentialsV1';
const SALT_KEY = 'graphxCredentialsSaltV1';
const PBKDF2_ITERATIONS = 100_000;

type EncryptedRecord = {
  username: string;
  passwordEnc: string;
};

let cachedKey: CryptoKey | undefined;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSalt(): Promise<Uint8Array> {
  const data = await chrome.storage.local.get(SALT_KEY);
  const existing: string | undefined = data[SALT_KEY];
  if (existing)
    return base64ToBytes(existing);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [SALT_KEY]: bytesToBase64(salt) });
  return salt;
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey)
    return cachedKey;
  const salt = await getSalt();
  const seed = new TextEncoder().encode(chrome.runtime.id);
  const baseKey = await crypto.subtle.importKey('raw', seed, { name: 'PBKDF2' }, false, ['deriveKey']);
  cachedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
  );
  return cachedKey;
}

async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext)
    return '';
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.byteLength);
  return bytesToBase64(packed);
}

async function decrypt(packedB64: string): Promise<string> {
  if (!packedB64)
    return '';
  const key = await getEncryptionKey();
  const packed = base64ToBytes(packedB64);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export async function loadCredentials(serverId: string): Promise<Credentials> {
  const data = await chrome.storage.local.get(STORE_KEY);
  const all: Record<string, EncryptedRecord> = data[STORE_KEY] ?? {};
  const record = all[serverId];
  if (!record)
    return { username: '', password: '' };
  try {
    const password = await decrypt(record.passwordEnc);
    return { username: record.username ?? '', password };
  } catch {
    // Salt or extension id changed (e.g. extension reinstalled). Treat as no
    // saved password — the username is still readable in the clear.
    return { username: record.username ?? '', password: '' };
  }
}

export async function storeCredentials(serverId: string, creds: Credentials): Promise<void> {
  const data = await chrome.storage.local.get(STORE_KEY);
  const all: Record<string, EncryptedRecord> = data[STORE_KEY] ?? {};
  all[serverId] = {
    username: creds.username,
    passwordEnc: await encrypt(creds.password),
  };
  await chrome.storage.local.set({ [STORE_KEY]: all });
}

export async function clearCredentials(serverId?: string): Promise<void> {
  if (!serverId) {
    await chrome.storage.local.remove(STORE_KEY);
    return;
  }
  const data = await chrome.storage.local.get(STORE_KEY);
  const all: Record<string, EncryptedRecord> = data[STORE_KEY] ?? {};
  delete all[serverId];
  await chrome.storage.local.set({ [STORE_KEY]: all });
}
