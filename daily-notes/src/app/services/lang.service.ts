import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const LS_KEY = 'diary_lang';
const SUPPORTED = ['en', 'tr', 'az'] as const;
export type Lang = (typeof SUPPORTED)[number];

@Injectable({ providedIn: 'root' })
export class LangService {
  lang = signal<Lang>('en');

  constructor(private t: TranslateService) {
    t.addLangs(SUPPORTED as any);
    const saved = (localStorage.getItem(LS_KEY) as Lang) || 'en';
    this.set(saved);
  }

  set(l: Lang) {
    this.lang.set(l);
    this.t.use(l);
    localStorage.setItem(LS_KEY, l);
    document.documentElement.lang = l;
  }
}
