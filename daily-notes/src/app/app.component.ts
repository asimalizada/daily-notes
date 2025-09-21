import {
  Component,
  computed,
  effect,
  HostListener,
  signal,
} from '@angular/core';
import { RichTextEditorComponent } from './components/rich-text-editor/rich-text-editor.component';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Note } from './models/models';
import { LocalStorageService } from './services/local-storage.service';
import { ThemeService } from './services/theme.service';
import { AuthService } from './services/auth.service';
import { LangService } from './services/lang.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

type Tab = 'daily' | 'important';
type Mode = 'view' | 'edit';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RichTextEditorComponent,
    TranslateModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  dows = computed(() => [
    this.t.instant('MON'),
    this.t.instant('TUE'),
    this.t.instant('WED'),
    this.t.instant('THU'),
    this.t.instant('FRI'),
    this.t.instant('SAT'),
    this.t.instant('SUN'),
  ]);

  // storage
  private readonly STORAGE_KEY = 'angular_diary_notes_v1';
  notes = signal<Note[]>([]);

  // view state
  mode = signal<Mode>('view');
  selectedDate = signal(this.todayISO());
  viewNote = signal<Note | null>(null); // for “Open” from lists
  editId = signal<string | null>(null);

  // editor form state
  title = '';
  dateISO = this.todayISO();
  contentHtml = '';
  imageDataUrls: string[] = [];
  isImportant = false;

  // calendar state
  viewYear = signal(new Date().getFullYear());
  viewMonth = signal(new Date().getMonth()); // 0..11

  viewerOpen = signal(false);

  imageViewerOpen = signal(false);
  viewerImages: string[] = [];
  viewerIndex = signal(0);
  zoom = signal(1);
  offset = signal({ x: 0, y: 0 });
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private offsetStart = { x: 0, y: 0 };

  newAccName = '';
  newAccPassword = '';
  loginPassword = '';
  loginMode: 'account' | 'master' = 'account';
  selectedLoginAccountId: string | null = null;

  adminOpen = signal(false);
  adminSelectedAccountId: string | null = null;
  adminNewPassword = '';

  // --- Title editing state ---
  private readonly TITLE_KEY = 'diary_custom_title';
  customTitle = signal<string>(localStorage.getItem(this.TITLE_KEY) ?? '');
  isEditingTitle = signal(false);
  titleInput = '';

  // === Theme editor panel state ===
  themeEditorOpen = signal(false);
  paletteDraft = {
    bg: '',
    panel: '',
    panel2: '',
    text: '',
    muted: '',
    border: '',
    primary: '',
    accent: '',
  };

  constructor(
    private store: LocalStorageService,
    public theme: ThemeService,
    public auth: AuthService,
    public lang: LangService,
    public t: TranslateService
  ) {
    // Load notes only after login
    effect(async () => {
      const id = this.auth.currentAccountId();
      if (!id) {
        this.notes.set([]);
        return;
      }
      const loaded = await this.auth.loadNotes();
      // Normalize image arrays (in case)
      this.notes.set(
        (loaded ?? []).map((n: any) => ({
          ...n,
          imageDataUrls: n.imageDataUrls ?? [],
        }))
      );
    });

    // Persist encrypted on every change while logged in
    effect(() => {
      if (!this.auth.currentAccountId()) return;
      this.auth.saveNotes(this.notes()).catch(console.error);
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(e: KeyboardEvent) {
    // Ctrl + Shift + A opens the admin panel
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      this.openAdminPanel();
    }
  }

  displayTitle = computed(
    () => this.customTitle() || this.t.instant('APP_TITLE')
  );

  startEditTitle() {
    const custom = this.customTitle();
    if (custom) {
      this.titleInput = custom;
      this.isEditingTitle.set(true);
      return;
    }
    // get() waits for the file to load; no “APP_TITLE” flash
    this.t.get('APP_TITLE').subscribe((v) => {
      this.titleInput = v;
      this.isEditingTitle.set(true);
    });
  }
  saveTitle() {
    const v = (this.titleInput ?? '').trim();
    this.customTitle.set(v);
    if (v) localStorage.setItem(this.TITLE_KEY, v);
    else localStorage.removeItem(this.TITLE_KEY);
    this.isEditingTitle.set(false);
  }
  cancelEditTitle() {
    this.isEditingTitle.set(false);
  }

  async registerAccount() {
    await this.auth.registerAccount(this.newAccName, this.newAccPassword);
    this.newAccName = '';
    this.newAccPassword = '';
  }

  async login() {
    const id = this.selectedLoginAccountId;
    if (!id) {
      alert('Choose an account');
      return;
    }

    await this.auth.loginWithAccount(id, this.loginPassword);

    this.loginPassword = '';
  }

  logout() {
    this.auth.logout();
  }

  /* ---------- Derived sets ---------- */
  important = computed(() =>
    this.notes()
      .filter((n) => n.isImportant)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  dayNotes = computed(() =>
    this.notes()
      .filter((n) => n.dateISO === this.selectedDate())
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  hasNotesOn(dateISO: string) {
    return this.notes().some((n) => n.dateISO === dateISO);
  }

  /* ---------- Calendar helpers ---------- */
  monthLabel = computed(() => {
    const d = new Date(this.viewYear(), this.viewMonth(), 1);
    return d.toLocaleString(this.lang.lang(), {
      month: 'long',
      year: 'numeric',
    });
  });

  calendarDays = computed(() => {
    const y = this.viewYear(),
      m = this.viewMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startDay = (first.getDay() + 6) % 7; // Mon-based
    const daysInMonth = last.getDate();

    const prevLast = new Date(y, m, 0).getDate();

    const cells: {
      day: number;
      iso: string;
      inMonth: boolean;
      isToday: boolean;
    }[] = [];

    // leading
    for (let i = startDay - 1; i >= 0; i--) {
      const d = prevLast - i;
      const iso = this.iso(y, m - 1, d);
      cells.push({ day: d, iso, inMonth: false, isToday: false });
    }
    // this month
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = this.iso(y, m, d);
      cells.push({
        day: d,
        iso,
        inMonth: true,
        isToday: iso === this.todayISO(),
      });
    }
    // trailing
    while (cells.length % 7 !== 0) {
      const d = cells.length - (startDay + daysInMonth) + 1;
      const iso = this.iso(y, m + 1, d);
      cells.push({ day: d, iso, inMonth: false, isToday: false });
    }
    return cells;
  });

  prevMonth() {
    const m = this.viewMonth() - 1;
    if (m < 0) {
      this.viewMonth.set(11);
      this.viewYear.update((y) => y - 1);
    } else this.viewMonth.set(m);
  }
  nextMonth() {
    const m = this.viewMonth() + 1;
    if (m > 11) {
      this.viewMonth.set(0);
      this.viewYear.update((y) => y + 1);
    } else this.viewMonth.set(m);
  }
  selectDate(iso: string) {
    this.selectedDate.set(iso);
  }

  /* ---------- Note viewer / editor ---------- */
  openViewer(n: Note) {
    this.viewNote.set(n);
    this.selectedDate.set(n.dateISO);
    this.mode.set('view'); // ensure editor is closed
    this.editId.set(null);
    this.viewerOpen.set(true);
  }

  closeViewer() {
    this.viewerOpen.set(false);
  }

  editFromViewer() {
    const n = this.viewNote();
    if (!n) return;
    this.viewerOpen.set(false);
    this.startEdit(n); // opens the drawer editor
  }

  startEdit(n: Note) {
    this.editId.set(n.id);
    this.title = n.title;
    this.dateISO = n.dateISO;
    this.contentHtml = n.contentHtml;
    this.imageDataUrls = [...(n.imageDataUrls ?? [])];
    this.isImportant = n.isImportant;
    this.mode.set('edit');
  }

  newNote() {
    this.resetForm();
    this.dateISO = this.selectedDate();
    this.mode.set('edit');
  }

  closeEditor() {
    this.mode.set('view');
    this.editId.set(null);
  }

  save() {
    const now = Date.now();
    if (!this.dateISO) this.dateISO = this.todayISO();

    const base: Note = {
      id: this.editId() ?? crypto.randomUUID(),
      title: this.title?.trim(),
      dateISO: this.dateISO,
      contentHtml: this.contentHtml || '',
      imageDataUrls: [...this.imageDataUrls],
      isImportant: this.isImportant,
      createdAt: this.editId()
        ? this.notes().find((n) => n.id === this.editId())?.createdAt ?? now
        : now,
      updatedAt: now,
    };

    if (this.editId()) {
      this.notes.update((arr) => arr.map((n) => (n.id === base.id ? base : n)));
    } else {
      this.notes.update((arr) => [base, ...arr]);
    }
    this.selectedDate.set(base.dateISO);
    this.closeEditor();
    this.resetForm();
  }

  remove(id: string) {
    if (confirm('Delete this note?')) {
      this.notes.update((arr) => arr.filter((n) => n.id !== id));
      if (this.editId() === id) this.closeEditor();
    }
  }

  onImages(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    const readers = files.map(
      (f) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(f);
        })
    );

    Promise.all(readers).then((urls) => {
      this.imageDataUrls = [...this.imageDataUrls, ...urls];
    });
  }

  removeImageAt(idx: number) {
    this.imageDataUrls = this.imageDataUrls.filter((_, i) => i !== idx);
  }

  resetForm() {
    this.editId.set(null);
    this.title = '';
    this.dateISO = this.todayISO();
    this.contentHtml = '';
    this.imageDataUrls = [];
    this.isImportant = false;
  }

  /* ---------- Utils ---------- */
  todayISO(): string {
    const d = new Date();
    return this.dateToISO(d);
  }
  dateToISO(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  iso(y: number, m: number, d: number): string {
    const dt = new Date(y, m, d);
    return this.dateToISO(dt);
  }

  // viewer part

  openImageViewer(imgs: string[], index = 0) {
    if (!imgs?.length) return;
    this.viewerImages = imgs;
    this.viewerIndex.set(Math.max(0, Math.min(index, imgs.length - 1)));
    this.resetZoom();
    this.imageViewerOpen.set(true);

    // focus to receive key events
    setTimeout(() => {
      const lb = document.querySelector('.lightbox') as HTMLElement | null;
      lb?.focus();
    });
  }
  closeImageViewer() {
    this.imageViewerOpen.set(false);
  }

  nextImage() {
    if (this.viewerImages.length > 0) {
      this.viewerIndex.update((i) => (i + 1) % this.viewerImages.length);
      this.resetZoom();
    }
  }
  prevImage() {
    if (this.viewerImages.length > 0) {
      this.viewerIndex.update(
        (i) => (i - 1 + this.viewerImages.length) % this.viewerImages.length
      );
      this.resetZoom();
    }
  }

  onLightboxKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.closeImageViewer();
    else if (e.key === 'ArrowRight') this.nextImage();
    else if (e.key === 'ArrowLeft') this.prevImage();
  }

  zoomIn() {
    this.zoom.set(Math.min(4, this.zoom() + 0.2));
  }
  zoomOut() {
    this.zoom.set(Math.max(0.2, this.zoom() - 0.2));
  }
  resetZoom() {
    this.zoom.set(1);
    this.offset.set({ x: 0, y: 0 });
  }
  toggleZoom() {
    this.zoom.set(this.zoom() === 1 ? 2 : 1);
    if (this.zoom() === 1) this.offset.set({ x: 0, y: 0 });
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    this.zoom.set(Math.max(0.2, Math.min(4, this.zoom() + delta)));
  }

  // Drag to pan
  startDrag(e: MouseEvent) {
    if (this.zoom() <= 1) return; // no need to pan
    this.dragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.offsetStart = { ...this.offset() };
  }
  drag(e: MouseEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.offset.set({ x: this.offsetStart.x + dx, y: this.offsetStart.y + dy });
  }
  endDrag() {
    this.dragging = false;
  }

  currentAccount = computed(
    () =>
      this.auth.accounts().find((a) => a.id === this.auth.currentAccountId()) ??
      null
  );

  async loginWithAccount() {
    if (!this.selectedLoginAccountId) {
      alert('Select an account');
      return;
    }
    await this.auth.loginWithAccount(
      this.selectedLoginAccountId,
      this.loginPassword
    );
    this.loginPassword = '';
  }

  // Open admin panel (called by shortcut)
  openAdminPanel() {
    // quick guard if no accounts
    if (this.auth.accounts().length === 0) {
      alert('No accounts to manage');
      return;
    }
    this.adminSelectedAccountId = this.auth.accounts()[0]?.id ?? null;
    this.adminNewPassword = '';
    this.adminOpen.set(true);
    // focus for keyboard events if you want
    setTimeout(() =>
      (document.querySelector('.admin-panel') as HTMLElement | null)?.focus()
    );
  }
  closeAdminPanel() {
    this.adminOpen.set(false);
  }

  // Trigger password reset
  async adminResetPassword() {
    if (!this.adminSelectedAccountId) {
      alert('Select an account');
      return;
    }
    if (!this.adminNewPassword || this.adminNewPassword.length < 6) {
      if (!confirm('Password looks short. Proceed anyway?')) return;
    }
    try {
      await this.auth.resetAccountPassword(
        this.adminSelectedAccountId,
        this.adminNewPassword
      );
      alert('Password reset successfully.');
      this.closeAdminPanel();
    } catch (err: any) {
      console.error(err);
      alert('Failed to reset password: ' + (err?.message ?? err));
    }
  }

  openThemeEditor() {
    const p = this.theme.palette();
    this.paletteDraft = { ...p };
    this.themeEditorOpen.set(true);
  }
  closeThemeEditor() {
    this.themeEditorOpen.set(false);
  }
  saveTheme() {
    this.theme.setCustom({ ...this.paletteDraft });
    this.themeEditorOpen.set(false);
  }
  resetTheme(kind: 'light' | 'dark' = 'dark') {
    this.theme.resetCustom(kind);
    const p = this.theme.palette();
    this.paletteDraft = { ...p };
  }
}
