/**
 * Simple client-side E2EE helpers using tweetnacl (libsodium-like)
 * Uses TweetNaCl.js (install in your project: npm install tweetnacl tweetnacl-util)
 *
 * This example uses ephemeral keypairs for demonstration. For production you need
 * persistent key storage per user (generated on first login) and secure backup.
 */

import nacl from 'tweetnacl';
import { encodeUTF8, decodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';

nacl.util = { encodeUTF8, decodeUTF8, encodeBase64, decodeBase64 };

/** generate keypair (Uint8Array) */
export function generateKeypair() {
  return nacl.box.keyPair();
}

/** convert to base64 strings for storing in DB */
export function keypairToStorage(kp) {
  return { publicKey: encodeBase64(kp.publicKey), secretKey: encodeBase64(kp.secretKey) };
}
export function storageToKeypair(obj) {
  return { publicKey: decodeBase64(obj.publicKey), secretKey: decodeBase64(obj.secretKey) };
}

/** encrypt message text for recipientPublicKey using senderSecretKey */
export function encryptMessage(messageText, recipientPublicKeyBase64, senderSecretKeyBase64) {
  const msgUint8 = decodeUTF8(messageText);
  const recipientPub = decodeBase64(recipientPublicKeyBase64);
  const senderSecret = decodeBase64(senderSecretKeyBase64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(msgUint8, nonce, recipientPub, senderSecret);
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/** decrypt ciphertext using senderPublicKey and receiverSecretKey */
export function decryptMessage(ciphertextBase64, nonceBase64, senderPublicKeyBase64, receiverSecretKeyBase64) {
  const cipher = decodeBase64(ciphertextBase64);
  const nonce = decodeBase64(nonceBase64);
  const senderPub = decodeBase64(senderPublicKeyBase64);
  const receiverSecret = decodeBase64(receiverSecretKeyBase64);
  const decrypted = nacl.box.open(cipher, nonce, senderPub, receiverSecret);
  if(!decrypted) throw new Error('Decryption failed');
  return encodeUTF8(decrypted);
}
