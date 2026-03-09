// ============================================================================
// PIN-encrypted WIF storage using Web Crypto API (PBKDF2 + AES-GCM)
// ============================================================================

import { STORAGE_KEYS } from '../constants';

const PBKDF2_ITERATIONS = 100_000;

function pinToKeyMaterial(pin: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await pinToKeyMaterial(pin);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check whether an encrypted wallet exists in localStorage. */
export function hasStoredWallet(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.WALLET_ENC);
}

/** Return the stored address hint (truncated address) or null. */
export function getAddressHint(): string | null {
  return localStorage.getItem(STORAGE_KEYS.WALLET_ADDR);
}

/** Encrypt WIF with PIN and persist to localStorage alongside an address hint. */
export async function encryptAndStoreWif(
  wif: string,
  pin: string,
  address: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);

  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(wif),
  );

  const payload = JSON.stringify({
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  });

  localStorage.setItem(STORAGE_KEYS.WALLET_ENC, payload);
  localStorage.setItem(STORAGE_KEYS.WALLET_ADDR, address);
}

/** Decrypt a stored WIF using the provided PIN. Throws 'Wrong PIN' on failure. */
export async function decryptStoredWif(pin: string): Promise<string> {
  const raw = localStorage.getItem(STORAGE_KEYS.WALLET_ENC);
  if (!raw) throw new Error('No stored wallet');

  const { salt, iv, ct } = JSON.parse(raw);
  const key = await deriveKey(pin, fromBase64(salt));

  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      key,
      fromBase64(ct),
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error('Wrong PIN');
  }
}

/** Remove encrypted wallet data from localStorage. */
export function deleteStoredWallet(): void {
  localStorage.removeItem(STORAGE_KEYS.WALLET_ENC);
  localStorage.removeItem(STORAGE_KEYS.WALLET_ADDR);
}
