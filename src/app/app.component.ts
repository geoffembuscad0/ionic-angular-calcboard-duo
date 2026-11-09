import { Component, ElementRef, ViewChild, OnDestroy, AfterViewInit, signal, computed } from '@angular/core';
import { IonApp, IonRouterOutlet, IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  backspaceOutline,
  trashOutline,
  arrowUndoOutline,
  calculatorOutline,
  timeOutline,
  closeOutline
} from 'ionicons/icons';

interface HistoryItem {
  expression: string;
  result: string;
  timestamp: string;
}

type KeyKind = 'num' | 'fn' | 'op';

interface Key {
  label: string;
  kind: KeyKind;
  run: () => void;
  icon?: string;
  aria?: string;
  wide?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, IonContent, IonIcon],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sketchCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private ctx!: CanvasRenderingContext2D;
  private resizeObserver?: ResizeObserver;
  private isDrawing = false;
  private undoStack: ImageData[] = [];

  // Calculator state
  displayValue = signal('0');
  equationString = signal('');
  history = signal<HistoryItem[]>([]);
  showHistory = signal(false);
  private awaitingOperand = false; // an operator was just pressed
  private justCalculated = false;  // "=" was just pressed

  // Shrinks the main result as it gets longer
  resultSize = computed(() => {
    const n = this.displayValue().length;
    if (n > 12) return 'text-4xl';
    if (n > 9) return 'text-5xl';
    if (n > 6) return 'text-6xl';
    return 'text-7xl';
  });

  // Sketchpad state
  activeTool = signal<'pen' | 'eraser'>('pen');
  penColor = signal('#1c1c1e');
  penSize = signal(3);

  colors = ['#1c1c1e', '#007aff', '#34c759', '#ff9500', '#ff2d55']; // iOS system colors
  sizes = [2, 5, 10];

  // Keypad layout (renders the grid with @for)
  keys: Key[] = [
    { label: 'AC', kind: 'fn', aria: 'All clear', run: () => this.clearAll() },
    { label: '⌫', kind: 'fn', icon: 'backspace-outline', aria: 'Delete', run: () => this.backspace() },
    { label: '%', kind: 'fn', aria: 'Modulo', run: () => this.appendOperator('%') },
    { label: '÷', kind: 'op', aria: 'Divide', run: () => this.appendOperator('÷') },

    { label: '7', kind: 'num', run: () => this.appendNumber('7') },
    { label: '8', kind: 'num', run: () => this.appendNumber('8') },
    { label: '9', kind: 'num', run: () => this.appendNumber('9') },
    { label: '×', kind: 'op', aria: 'Multiply', run: () => this.appendOperator('×') },

    { label: '4', kind: 'num', run: () => this.appendNumber('4') },
    { label: '5', kind: 'num', run: () => this.appendNumber('5') },
    { label: '6', kind: 'num', run: () => this.appendNumber('6') },
    { label: '−', kind: 'op', aria: 'Subtract', run: () => this.appendOperator('-') },

    { label: '1', kind: 'num', run: () => this.appendNumber('1') },
    { label: '2', kind: 'num', run: () => this.appendNumber('2') },
    { label: '3', kind: 'num', run: () => this.appendNumber('3') },
    { label: '+', kind: 'op', aria: 'Add', run: () => this.appendOperator('+') },

    { label: '0', kind: 'num', wide: true, run: () => this.appendNumber('0') },
    { label: '.', kind: 'num', aria: 'Decimal point', run: () => this.appendNumber('.') },
    { label: '=', kind: 'op', aria: 'Equals', run: () => this.calculate() },
  ];

  constructor() {
    addIcons({
      backspaceOutline,
      trashOutline,
      arrowUndoOutline,
      calculatorOutline,
      timeOutline,
      closeOutline
    });
  }

  keyClasses(key: Key): string {
    const colors: Record<KeyKind, string> = {
      num: 'bg-white text-black dark:bg-ios-key dark:text-white',
      fn: 'bg-ios-fill text-black dark:bg-ios-fn',
      op: 'bg-ios-orange text-white',
    };
    // Normal keys stay square; the wide "0" key stretches to the row height
    const shape = key.wide ? 'col-span-2 justify-start pl-8' : 'aspect-square';
    return `${colors[key.kind]} ${shape}`;
  }

  ngAfterViewInit() {
    // Fires once on observe and again whenever the pane changes size
    // (rotation, dual-screen, hidden/visible in portrait).
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.canvasRef.nativeElement);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  // --- Canvas sizing (DPR-aware, keeps existing drawing) ---
  private resizeCanvas() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // Hidden (portrait) or not laid out yet
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width === w && canvas.height === h) return;

    // Copy what is already drawn
    let previous: HTMLCanvasElement | null = null;
    if (this.ctx && canvas.width > 0 && canvas.height > 0) {
      previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext('2d')!.drawImage(canvas, 0, 0);
    }

    // Setting width/height clears the canvas and resets the transform
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, w, h);
    if (previous) this.ctx.drawImage(previous, 0, 0);

    // From here on, draw in CSS pixels
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.undoStack = [];
    this.saveState();
  }

  // --- Calculator ---
  appendNumber(val: string) {
    const current = this.displayValue();

    if (this.justCalculated || current === 'Error') {
      this.displayValue.set(val === '.' ? '0.' : val);
    } else if (val === '.') {
      if (current.includes('.')) return;
      this.displayValue.set(current + '.');
    } else if (current === '0') {
      this.displayValue.set(val);
    } else {
      this.displayValue.set(current + val);
    }

    this.justCalculated = false;
    this.awaitingOperand = false;
  }

  appendOperator(op: string) {
    if (this.displayValue() === 'Error') return;

    // Pressing two operators in a row replaces the first one
    if (this.awaitingOperand && this.equationString()) {
      this.equationString.set(this.equationString().replace(/\s[+\-×÷%]\s$/, ` ${op} `));
      return;
    }

    // Chain onto whatever is already in the equation
    this.equationString.set(this.equationString() + this.displayValue() + ` ${op} `);
    this.displayValue.set('0');
    this.awaitingOperand = true;
    this.justCalculated = false;
  }

  clearAll() {
    this.displayValue.set('0');
    this.equationString.set('');
    this.awaitingOperand = false;
    this.justCalculated = false;
  }

  backspace() {
    if (this.justCalculated) return;
    const current = this.displayValue();
    if (current === 'Error' || current.length <= 1 || (current.length === 2 && current.startsWith('-'))) {
      this.displayValue.set('0');
    } else {
      this.displayValue.set(current.slice(0, -1));
    }
  }

  calculate() {
    // Nothing to compute until an operator has been entered
    if (!this.equationString() || this.awaitingOperand) return;

    const fullExpr = this.equationString() + this.displayValue();

    try {
      const result = this.evaluate(fullExpr);
      const resString = parseFloat(result.toFixed(8)).toString();

      const newItem: HistoryItem = {
        expression: fullExpr,
        result: resString,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      this.history.update(h => [newItem, ...h.slice(0, 19)]);

      this.equationString.set('');
      this.displayValue.set(resString);
    } catch {
      this.equationString.set('');
      this.displayValue.set('Error');
    }

    this.awaitingOperand = false;
    this.justCalculated = true;
  }

  useHistoryItem(item: HistoryItem) {
    this.displayValue.set(item.result);
    this.equationString.set('');
    this.awaitingOperand = false;
    this.justCalculated = true;
    this.showHistory.set(false);
  }

  clearHistory() {
    this.history.set([]);
  }

  /**
   * Small arithmetic evaluator (replaces eval): + - × ÷ % with correct
   * precedence and unary minus. Throws on bad input or division by zero.
   */
  private evaluate(expr: string): number {
    const tokens = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .match(/\d+\.?\d*|\.\d+|[+\-*/%]/g);

    if (!tokens) throw new Error('Empty expression');

    const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
    const values: number[] = [];
    const ops: string[] = [];

    const applyTop = () => {
      const op = ops.pop()!;
      const b = values.pop();
      const a = values.pop();
      if (a === undefined || b === undefined) throw new Error('Syntax error');

      switch (op) {
        case '+': values.push(a + b); break;
        case '-': values.push(a - b); break;
        case '*': values.push(a * b); break;
        case '/': values.push(a / b); break;
        case '%': values.push(a % b); break;
      }
    };

    let expectOperand = true;
    let negative = false;

    for (const token of tokens) {
      if (/^[\d.]/.test(token)) {
        const n = parseFloat(token);
        values.push(negative ? -n : n);
        negative = false;
        expectOperand = false;
      } else if (expectOperand && token === '-') {
        negative = !negative;
      } else if (expectOperand) {
        throw new Error('Syntax error');
      } else {
        while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) applyTop();
        ops.push(token);
        expectOperand = true;
      }
    }

    if (expectOperand) throw new Error('Syntax error');
    while (ops.length) applyTop();

    const result = values[0];
    if (!Number.isFinite(result)) throw new Error('Math error');
    return result;
  }

  // --- Sketchpad (Pointer Events: mouse, touch and pen) ---
  startDrawing(event: PointerEvent) {
    if (!this.ctx) return;
    this.canvasRef.nativeElement.setPointerCapture(event.pointerId);
    this.isDrawing = true;
    const p = this.getPos(event);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    // A single tap leaves a dot
    this.ctx.lineTo(p.x + 0.01, p.y + 0.01);
    this.applyStroke();
  }

  draw(event: PointerEvent) {
    if (!this.isDrawing) return;
    const p = this.getPos(event);
    this.ctx.lineTo(p.x, p.y);
    this.applyStroke();
  }

  stopDrawing(event: PointerEvent) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const canvas = this.canvasRef.nativeElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    this.saveState();
  }

  private applyStroke() {
    const eraser = this.activeTool() === 'eraser';
    this.ctx.strokeStyle = eraser ? '#ffffff' : this.penColor();
    this.ctx.lineWidth = eraser ? 24 : this.penSize();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  private getPos(event: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private saveState() {
    const canvas = this.canvasRef.nativeElement;
    if (!this.ctx || canvas.width <= 0 || canvas.height <= 0) return;

    if (this.undoStack.length >= 15) this.undoStack.shift();
    this.undoStack.push(this.ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  undoCanvas() {
    if (this.undoStack.length > 1) {
      this.undoStack.pop(); // drop the current state
      this.ctx.putImageData(this.undoStack[this.undoStack.length - 1], 0, 0);
    }
  }

  clearCanvas() {
    const canvas = this.canvasRef.nativeElement;
    if (!this.ctx || canvas.width <= 0 || canvas.height <= 0) return;

    // Fill in buffer pixels, independent of the DPR transform
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.ctx.restore();
    this.saveState();
  }
}