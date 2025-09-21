import { Injectable, signal, computed } from '@angular/core';

type PresetId = 'logo1' | 'logo2' | 'logo3' | 'logo4';
type Mode = 'preset' | 'custom';

const LS_MODE = 'diary_logo_mode';
const LS_PRESET = 'diary_logo_preset';
const LS_CUSTOM = 'diary_logo_custom_dataurl';

@Injectable({ providedIn: 'root' })
export class LogoService {
  private _mode = signal<Mode>(
    (localStorage.getItem(LS_MODE) as Mode) || 'preset'
  );
  private _preset = signal<PresetId>(
    (localStorage.getItem(LS_PRESET) as PresetId) || 'logo1'
  );
  private _custom = signal<string>(localStorage.getItem(LS_CUSTOM) || '');

  /** Path for presets living in /assets */
  private presetPath(id: PresetId) {
    return `assets/${id}.png`;
  }

  /** What the UI should render as the current logo */
  logoSrc = computed(() => {
    return this._mode() === 'preset'
      ? this.presetPath(this._preset())
      : this._custom() || this.presetPath('logo1');
  });

  /** Which mode is active */
  mode = this._mode.asReadonly();
  preset = this._preset.asReadonly();

  constructor() {
    // ensure favicon matches preset if we're in preset mode (on app load)
    this.applyFavicon();
  }

  setPreset(id: PresetId) {
    this._mode.set('preset');
    this._preset.set(id);
    localStorage.setItem(LS_MODE, 'preset');
    localStorage.setItem(LS_PRESET, id);
    this.applyFavicon(); // preset also changes favicon
  }

  /** Set a custom uploaded image (DataURL). Does NOT change favicon. */
  setCustomDataUrl(dataUrl: string) {
    this._mode.set('custom');
    this._custom.set(dataUrl);
    localStorage.setItem(LS_MODE, 'custom');
    localStorage.setItem(LS_CUSTOM, dataUrl);
    // favicon remains unchanged by design
  }

  /** Helper to read a File and set custom */
  async loadCustomFromFile(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    this.setCustomDataUrl(dataUrl);
  }

  /** Update (or create) the <link rel="icon"> to the current preset image */
  private applyFavicon() {
    if (this._mode() !== 'preset') return; // do not alter favicon in custom mode
    const href = this.presetPath(this._preset());
    this.updateFavicon(href);
  }

  private updateFavicon(href: string) {
    let link: HTMLLinkElement | null =
      document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = href;
  }
}
