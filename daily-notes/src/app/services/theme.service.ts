import { Injectable, effect, signal } from '@angular/core';

type ThemeMode = 'system' | 'light' | 'dark' | 'custom';
export interface Palette {
  bg: string; // page background
  panel: string; // cards/drawers
  panel2: string; // inner panels
  text: string;
  muted: string;
  border: string;
  primary: string; // main CTA
  accent: string; // calendar dot / focus rings
}

const THEME_KEY = 'diary_theme_mode';
const PALETTE_KEY = 'diary_theme_palette_v1';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _theme = signal<ThemeMode>(
    (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system'
  );
  theme = this._theme.asReadonly();

  private _palette = signal<Palette>(
    JSON.parse(localStorage.getItem(PALETTE_KEY) || 'null') ||
      this.defaultPalette('dark')
  );
  palette = this._palette.asReadonly();

  constructor() {
    this.apply(this._theme(), this._palette());
    // react to changes
    effect(() => {
      const m: ThemeMode = this._theme();
      const p: Palette = this._palette();
      this.apply(m, p);
    });
  }

  set(mode: ThemeMode) {
    this._theme.set(mode);
    localStorage.setItem(THEME_KEY, mode);
  }

  resetCustom(to: 'light' | 'dark' = 'dark') {
    const p = this.defaultPalette(to);
    this._palette.set(p);
    localStorage.setItem(PALETTE_KEY, JSON.stringify(p));
    this.set('custom');
  }

  setCustom(p: Palette) {
    this._palette.set(p);
    localStorage.setItem(PALETTE_KEY, JSON.stringify(p));
    this.set('custom');
  }

  defaultPalette(kind: 'light' | 'dark'): Palette {
    return kind === 'light'
      ? {
          bg: '#f6f7fb',
          panel: '#ffffff',
          panel2: '#f1f5f9',
          text: '#0f172a',
          muted: '#64748b',
          border: '#e2e8f0',
          primary: '#237a9f',
          accent: '#3b82f6',
        }
      : {
          bg: '#0b1120',
          panel: '#12172a',
          panel2: '#0f1426',
          text: '#e5e9f5',
          muted: '#94a3b8',
          border: '#1f2937',
          primary: '#237a9f',
          accent: '#58a6ff',
        };
  }

  private apply(mode: ThemeMode, p: Palette) {
    const root = document.documentElement;
    // system/light/dark base
    const prefersDark = window.matchMedia?.(
      '(prefers-color-scheme: dark)'
    ).matches;
    const base = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;

    // if not custom, use built-in palettes
    const active =
      base === 'custom' ? p : this.defaultPalette(base as 'light' | 'dark');

    root.style.setProperty('--bg', active.bg);
    root.style.setProperty('--panel', active.panel);
    root.style.setProperty('--panel-2', active.panel2);
    root.style.setProperty('--text', active.text);
    root.style.setProperty('--muted', active.muted);
    root.style.setProperty('--border', active.border);
    root.style.setProperty('--primary', active.primary);
    root.style.setProperty('--accent', active.accent);

    // optional shadow unify
    root.style.setProperty(
      '--shadow',
      base === 'light'
        ? '0 6px 24px rgba(16,24,40,.08)'
        : '0 8px 28px rgba(0,0,0,.45)'
    );
    document.body.style.background = `var(--bg)`;
    document.body.style.color = `var(--text)`;
  }
}
