import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } from '../shared/jwt.js';
import { log } from '../shared/logger.js';

/**
 * Loads the RSA signing key, creating it on first boot. The private key lives on a
 * volume only this container mounts, so it survives restarts and sessions stay valid.
 * The public half is republished to the volume the app mounts read-only.
 */
export function loadSigningKeys(): { privateKey: string; publicKey: string } {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    log('info', 'signing_key_generated');
  }

  const privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf8');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();

  // Written then renamed, so the app can never read a half-written key.
  const tempPath = `${PUBLIC_KEY_PATH}.tmp`;
  writeFileSync(tempPath, publicKey, { mode: 0o644 });
  renameSync(tempPath, PUBLIC_KEY_PATH);

  return { privateKey, publicKey };
}
