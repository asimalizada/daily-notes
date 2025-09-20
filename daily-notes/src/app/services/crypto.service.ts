import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  // ---- helpers ----
  b64enc(buf: ArrayBufferLike): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  b64dec(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer; // ArrayBuffer
  }

  randBytes(n = 16): ArrayBuffer {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a.buffer;
  }

  async deriveKEK(password: string, saltB64: string): Promise<CryptoKey> {
    const salt = new Uint8Array(this.b64dec(saltB64));
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async importDEK(rawB64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      this.b64dec(rawB64),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }
  async exportDEK(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return this.b64enc(raw);
  }

  // Wrap/unwrap a DEK by encrypting its raw bytes with the KEK (AES-GCM)
  async wrapDEK(dek: CryptoKey, kek: CryptoKey) {
    const iv = this.randBytes(12);
    const raw = await this.exportDEK(dek);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek,
      this.b64dec(raw)
    );
    return { iv: this.b64enc(iv), data: this.b64enc(ct) };
  }
  async unwrapDEK(wrapped: { iv: string; data: string }, kek: CryptoKey) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.b64dec(wrapped.iv) }, // ArrayBuffer
      kek,
      this.b64dec(wrapped.data)
    );
    return this.importDEK(this.b64enc(pt));
  }

  async encryptString(plain: string, dek: CryptoKey) {
    const iv = this.randBytes(12);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dek,
      new TextEncoder().encode(plain)
    );
    return { iv: this.b64enc(iv), data: this.b64enc(ct) };
  }

  async decryptString(enc: { iv: string; data: string }, dek: CryptoKey) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.b64dec(enc.iv) },
      dek,
      this.b64dec(enc.data)
    );
    return new TextDecoder().decode(pt);
  }

  async generateDEK(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
  }
}
