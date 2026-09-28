import nacl from 'tweetnacl';
import { canonicalJson } from '@rebbehub/model';

/**
 * Ed25519 signatures over the canonical JSON of a manifest without its
 * `signature` field - the scheme of Sichos-Kodesh's pack-format
 * (packages/pack-format/src/signing.ts): base64 keys, a key id of the
 * first 16 hex characters of SHA-512 of the public key, the signature
 * carried inside the manifest. A dump signed here verifies with its tools.
 * The secret half of the release key never lives in this repository.
 */

export interface KeyPair {
  keyId: string;
  publicKey: string;
  secretKey: string;
}

export interface Signature {
  alg: 'ed25519';
  keyId: string;
  sig: string;
}

export type TrustedKeys = Record<string, string>;

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const fromBase64 = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return new Uint8Array(Buffer.from(text, 'base64'));
};
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export function keyIdFor(publicKeyBase64: string): string {
  const publicKey = fromBase64(publicKeyBase64);
  if (!publicKey) throw new TypeError('public key must be base64');
  return hex(nacl.hash(publicKey)).slice(0, 16);
}

/** A new key pair; `seed` (32 bytes) makes it deterministic, for tests. */
export function generateKeyPair(seed?: Uint8Array): KeyPair {
  const pair = seed ? nacl.sign.keyPair.fromSeed(seed) : nacl.sign.keyPair();
  const publicKey = toBase64(pair.publicKey);
  return { keyId: keyIdFor(publicKey), publicKey, secretKey: toBase64(pair.secretKey) };
}

export function signManifest<T extends { signature?: Signature }>(manifest: T, key: KeyPair): T & { signature: Signature } {
  const secretKey = fromBase64(key.secretKey);
  if (!secretKey || secretKey.length !== nacl.sign.secretKeyLength) throw new TypeError('secret key must be a base64 64-byte Ed25519 signing key');
  const { signature: _signature, ...unsigned } = manifest;
  const sig = nacl.sign.detached(utf8(canonicalJson(unsigned)), secretKey);
  return { ...(unsigned as T), signature: { alg: 'ed25519', keyId: key.keyId, sig: toBase64(sig) } };
}

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: 'unsigned' | 'unknown-key' | 'bad-signature' | 'malformed' };

export function verifyManifest(manifest: { signature?: Signature }, trusted: TrustedKeys): VerifyResult {
  const signature = manifest.signature;
  if (!signature) return { ok: false, reason: 'unsigned' };
  const publicKeyBase64 = trusted[signature.keyId];
  if (!publicKeyBase64) return { ok: false, reason: 'unknown-key' };
  const publicKey = fromBase64(publicKeyBase64);
  const sig = fromBase64(signature.sig);
  if (!publicKey || publicKey.length !== nacl.sign.publicKeyLength || !sig || sig.length !== nacl.sign.signatureLength) return { ok: false, reason: 'malformed' };
  const { signature: _signature, ...unsigned } = manifest;
  try {
    return nacl.sign.detached.verify(utf8(canonicalJson(unsigned)), sig, publicKey) ? { ok: true, keyId: signature.keyId } : { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
