import { Injectable, signal } from '@angular/core';
import { CryptoService } from './crypto.service';
import { environment } from '../../environment';

export interface AccountMeta {
  id: string;
  name: string;
  createdAt: number;
  saltB64: string; // per-account salt for PBKDF2 (account password)
  dekWrappedByAccount: { iv: string; data: string };
  dekWrappedByMaster?: { iv: string; data: string }; // wrapped with master SECRET
}

const KEY_ACCOUNTS = 'diary_accounts_v1';
const KEY_MASTER_META = 'diary_master_meta_v1';
const NOTES_KEY = (id: string) => `diary_notes_enc_${id}`;

/**
 * WARNING: This service uses a single predefined MASTER_SECRET.
 * Keep MASTER_SECRET out of version control for security.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  accounts = signal<AccountMeta[]>(this.loadAccounts());
  currentAccountId = signal<string | null>(null);

  // decrypted DEK for logged-in account (kept in memory only)
  private dek: CryptoKey | null = null;

  // === YOUR MASTER SECRET: set this to your personal password/secret ===
  // IMPORTANT: do NOT commit a secret to a public repo. Prefer environment variable.
  private readonly MASTER_SECRET = environment.masterSecret || '';

  constructor(private crypto: CryptoService) {
    // ensure master meta exists (salt for KEK derivation)
    this.ensureMasterMeta();
  }

  // ---------- Master meta (holds a salt for the MASTER_SECRET) ----------
  private ensureMasterMeta() {
    const raw = localStorage.getItem(KEY_MASTER_META);
    if (!raw) {
      const saltB64 = this.crypto.b64enc(this.crypto.randBytes(16));
      localStorage.setItem(KEY_MASTER_META, JSON.stringify({ saltB64 }));
    }
  }

  private getMasterMeta(): { saltB64: string } {
    const raw = localStorage.getItem(KEY_MASTER_META);
    if (!raw) throw new Error('Master meta not initialized');
    return JSON.parse(raw);
  }

  // ---------- Registration / login ----------
  /**
   * Register new account. Account password still exists (so the account can be opened by its own password).
   * Additionally, we *always* wrap the account DEK with the MASTER_SECRET so you can open it with your secret.
   */
  async registerAccount(name: string, accountPassword: string) {
    const id = crypto.randomUUID();
    const saltB64 = this.crypto.b64enc(this.crypto.randBytes(16));
    const dek = await this.crypto.generateDEK();

    // wrap DEK with account password (so account owner can log in)
    const kekAcc = await this.crypto.deriveKEK(accountPassword, saltB64);
    const dekByAcc = await this.crypto.wrapDEK(dek, kekAcc);

    // also wrap DEK with the MASTER_SECRET (so *you* can unlock it)
    const mm = this.getMasterMeta();
    const kekMaster = await this.crypto.deriveKEK(
      this.MASTER_SECRET,
      mm.saltB64
    );
    const dekByMaster = await this.crypto.wrapDEK(dek, kekMaster);

    const meta: AccountMeta = {
      id,
      name,
      createdAt: Date.now(),
      saltB64,
      dekWrappedByAccount: dekByAcc,
      dekWrappedByMaster: dekByMaster,
    };

    // save meta
    const updated = [meta, ...this.accounts()];
    this.accounts.set(updated);
    localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(updated));

    // initialize empty encrypted notes for this account
    await this.saveNotesBlob(id, dek, []);
  }

  /** Login using the account's own password */
  async loginWithAccount(id: string, password: string) {
    const acc = this.accounts().find((a) => a.id === id);
    if (!acc) throw new Error('Account not found');

    const pw = (password ?? '').trim();

    // ---- 1) Owner path: typed password is the MASTER secret
    if (this.MASTER_SECRET && pw === this.MASTER_SECRET) {
      if (!acc.dekWrappedByMaster) {
        throw new Error('Master access not configured for this account.');
      }
      const mm = this.getMasterMeta(); // { saltB64 }
      const kekMaster = await this.crypto.deriveKEK(
        this.MASTER_SECRET,
        mm.saltB64
      );
      this.dek = await this.crypto.unwrapDEK(acc.dekWrappedByMaster, kekMaster);
      this.currentAccountId.set(id);
      return;
    }

    // ---- 2) Normal user path: only try the account password
    try {
      const kek = await this.crypto.deriveKEK(pw, acc.saltB64);
      this.dek = await this.crypto.unwrapDEK(acc.dekWrappedByAccount, kek);
      this.currentAccountId.set(id);

      // Optional: migrate to add master wrap if missing (now that we have the DEK)
      if (this.MASTER_SECRET && !acc.dekWrappedByMaster) {
        const mm = this.getMasterMeta();
        const kekMaster = await this.crypto.deriveKEK(
          this.MASTER_SECRET,
          mm.saltB64
        );
        const wrappedByMaster = await this.crypto.wrapDEK(this.dek!, kekMaster);
        const updated = { ...acc, dekWrappedByMaster: wrappedByMaster };
        this.accounts.update((list) =>
          list.map((a) => (a.id === acc.id ? updated : a))
        );
        localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(this.accounts()));
      }
      return;
    } catch {
      // wrong account password
      throw new Error('Invalid password.');
    }
  }

  logout() {
    this.currentAccountId.set(null);
    this.dek = null;
  }

  // ---------- Encrypted notes load/save ----------
  async loadNotes(): Promise<any[]> {
    if (!this.dek || !this.currentAccountId()) return [];
    const raw = localStorage.getItem(NOTES_KEY(this.currentAccountId()!));
    if (!raw) return [];
    const blob = JSON.parse(raw) as { iv: string; data: string };
    const json = await this.crypto.decryptString(blob, this.dek);
    return JSON.parse(json);
  }

  async saveNotes(notes: any[]) {
    if (!this.dek || !this.currentAccountId()) throw new Error('Not logged in');
    await this.saveNotesBlob(this.currentAccountId()!, this.dek, notes);
  }

  private async saveNotesBlob(id: string, dek: CryptoKey, notes: any[]) {
    const enc = await this.crypto.encryptString(JSON.stringify(notes), dek);
    localStorage.setItem(NOTES_KEY(id), JSON.stringify(enc));
  }

  // ---------- Helpers ----------
  private loadAccounts(): AccountMeta[] {
    const raw = localStorage.getItem(KEY_ACCOUNTS);
    return raw ? (JSON.parse(raw) as AccountMeta[]) : [];
  }

  // inside AuthService class

  /**
   * Reset an account password as master/admin.
   * This uses the service's MASTER_SECRET to unwrap the account DEK,
   * then re-wraps the DEK with the provided new account password and updates metadata.
   */
  async resetAccountPassword(
    accountId: string,
    newAccountPassword: string
  ): Promise<void> {
    const acc = this.accounts().find((a) => a.id === accountId);
    if (!acc) throw new Error('Account not found');

    if (!acc.dekWrappedByMaster) {
      throw new Error('Account not configured for master unwrap');
    }

    // 1) derive master KEK and unwrap DEK using MASTER_SECRET + stored master salt
    const mm = this.getMasterMeta(); // returns { saltB64 }
    const kekMaster = await this.crypto.deriveKEK(
      this.MASTER_SECRET,
      mm.saltB64
    );
    const dek = await this.crypto.unwrapDEK(acc.dekWrappedByMaster, kekMaster);

    // 2) derive KEK for new account password and re-wrap DEK
    const newSaltB64 = this.crypto.b64enc(this.crypto.randBytes(16)); // new per-account salt
    const kekNewAcc = await this.crypto.deriveKEK(
      newAccountPassword,
      newSaltB64
    );
    const dekByNewAcc = await this.crypto.wrapDEK(dek, kekNewAcc);

    // 3) ALSO keep dekWrappedByMaster (so master still works) — we don't touch it.
    // Update account metadata: replace saltB64 and dekWrappedByAccount
    const updatedMeta = {
      ...acc,
      saltB64: newSaltB64,
      dekWrappedByAccount: dekByNewAcc,
    };

    // save accounts list
    this.accounts.update((list) =>
      list.map((a) => (a.id === acc.id ? updatedMeta : a))
    );
    localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(this.accounts()));
  }
}
