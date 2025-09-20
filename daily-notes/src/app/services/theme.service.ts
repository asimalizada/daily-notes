import { Injectable, effect, signal } from '@angular/core';

type Theme = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private KEY = 'diary_theme_pref_v1';
  theme = signal<Theme>(this.load());

  constructor() {
    effect(() => this.apply(this.theme()));
  }

  set(t: Theme) { this.theme.set(t); }

  private load(): Theme {
    const saved = localStorage.getItem(this.KEY) as Theme | null;
    return saved ?? 'system';
  }
  private apply(t: Theme) {
    localStorage.setItem(this.KEY, t);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = t === 'dark' || (t === 'system' && prefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
}
