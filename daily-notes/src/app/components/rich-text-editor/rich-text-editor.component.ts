import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'rich-text-editor',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .rte { border: 1px solid #d0d7de; border-radius: 8px; }
    .rte-toolbar { display:flex; gap:8px; padding:8px; border-bottom:1px solid #eee; flex-wrap: wrap; }
    .rte-toolbar button { padding:6px 10px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:pointer; }
    .rte-toolbar button:hover { background:#f6f8fa; }

    /* LTR lock so text never mirrors */
    .rte-area, .rte-area * {
      direction: ltr !important;
      unicode-bidi: bidi-override !important;
      text-align: left !important;
    }
    .rte-area {
      min-height:160px; padding:12px; outline:none;
      white-space: pre-wrap;
      background: transparent; color: inherit;
    }
  `],
  template: `
    <div class="rte">
      <div class="rte-toolbar">
        <button type="button" (click)="cmd('bold')"><b>B</b></button>
        <button type="button" (click)="cmd('italic')"><i>I</i></button>
        <button type="button" (click)="cmd('underline')"><u>U</u></button>
        <button type="button" (click)="cmd('insertUnorderedList')">• List</button>
        <button type="button" (click)="cmd('insertOrderedList')">1. List</button>
        <button type="button" (click)="formatBlock('p')">P</button>
        <button type="button" (click)="formatBlock('h2')">H2</button>
        <button type="button" (click)="formatBlock('h3')">H3</button>
        <button type="button" (click)="addLink()">Link</button>
        <button type="button" (click)="clear()">Clear</button>
      </div>
      <div
        #area
        class="rte-area"
        dir="ltr"
        contenteditable="true"
        (input)="onInput()"
        (paste)="onPaste($event)"
      ></div>
    </div>
  `
})
export class RichTextEditorComponent implements AfterViewInit, OnChanges {
  /** External value (used to initialize/replace the editor content) */
  @Input() value = '';
  /** Emits current HTML when typing */
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('area') area!: ElementRef<HTMLDivElement>;

  /** Guard so external @Input updates don't fight user typing */
  private updatingFromInside = false;

  ngAfterViewInit() {
    this.setEditorHtml(this.value || '');
  }

  ngOnChanges(changes: SimpleChanges) {
    if ('value' in changes && !this.updatingFromInside && this.area) {
      this.setEditorHtml(this.value || '');
    }
  }

  /* ---------- Toolbar commands ---------- */
  cmd(name: string) { document.execCommand(name, false); this.onInput(); }
  formatBlock(tag: string) { document.execCommand('formatBlock', false, tag); this.onInput(); }
  addLink() { const url = prompt('Enter URL:'); if (url) { document.execCommand('createLink', false, url); this.onInput(); } }
  clear() { if (confirm('Clear text?')) { this.setEditorHtml(''); this.onInput(); } }

  /* ---------- Events ---------- */
  onPaste(ev: ClipboardEvent) {
    // Paste as plain text to avoid weird HTML. Remove if you want rich paste.
    ev.preventDefault();
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  onInput() {
    if (!this.area) return;
    this.updatingFromInside = true;
    const html = this.area.nativeElement.innerHTML;
    this.valueChange.emit(html);
    // Release the guard after this tick so @Input changes from parent won't reset caret
    setTimeout(() => (this.updatingFromInside = false));
  }

  /* ---------- Utils ---------- */
  private setEditorHtml(html: string) {
    this.area.nativeElement.innerHTML = html;
  }
}
