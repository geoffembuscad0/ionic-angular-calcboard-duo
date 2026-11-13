import { Component, ElementRef, ViewChild, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonApp,
  IonRouterOutlet,
  IonContent,
  IonButton,
  IonIcon,
  IonBadge,
  IonItem,
  IonLabel,
  IonList
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  backspaceOutline,
  trashOutline,
  arrowUndoOutline,
  brushOutline,
  calculatorOutline,
  timeOutline,
  closeOutline
} from 'ionicons/icons';

interface HistoryItem {
  expression: string;
  result: string;
  timestamp: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, IonApp, IonRouterOutlet, IonContent,
    IonButton, IonIcon, IonBadge, IonItem, IonLabel, IonList
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sketchCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private ctx!: CanvasRenderingContext2D;
  private resizeObserver?: ResizeObserver;
  private isDrawing = false;
  private undoStack: ImageData[] = [];

  // Calculator State
  displayValue = signal('0');
  equationString = signal('');
  history = signal<HistoryItem[]>([]);
  showHistory = signal(false);

  // Sketchpad State
  activeTool = signal<'pen' | 'eraser'>('pen');
  penColor = signal('#1c1c1e'); // Dark ink default
  penSize = signal(3);
  
  colors = ['#1c1c1e', '#007aff', '#34c759', '#ff9500', '#ff2d55']; // iOS

  constructor() {
    addIcons({
      backspaceOutline,
      trashOutline,
      arrowUndoOutline,
      brushOutline,
      calculatorOutline,
      timeOutline,
      closeOutline
    });
  }
  
  ngAfterViewInit() {
    this.initCanvas();

    this.resizeObserver = new ResizeObserver(() => {
      const canvas = this.canvasRef.nativeElement;
      const rect = canvas.getBoundingClientRect();

      // Initialize only when the canvas becomes usable.
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        !this.ctx
      ) {
        this.initCanvas();
      }
    });

    this.resizeObserver.observe(this.canvasRef.nativeElement);
  }

  private initCanvas() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // The canvas may be hidden or not yet laid out.
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }

    this.ctx = ctx;

    // Set the internal resolution to match the displayed size.
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);

    // Blackboard background.
    this.ctx.fillStyle = '#ffffff'; 
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Initialize the undo history only when the canvas is usable.
    this.undoStack = [];
    this.saveState();
  }

  // --- Calculator Methods ---
  appendNumber(val: string) {
    if (this.displayValue() === '0' || this.displayValue() === 'Error') {
      this.displayValue.set(val);
    } else {
      this.displayValue.set(this.displayValue() + val);
    }
  }

  appendOperator(op: string) {
    this.equationString.set(this.displayValue() + ' ' + op + ' ');
    this.displayValue.set('0');
  }

  clearAll() {
    this.displayValue.set('0');
    this.equationString.set('');
  }

  backspace() {
    const current = this.displayValue();
    if (current.length > 1) {
      this.displayValue.set(current.slice(0, -1));
    } else {
      this.displayValue.set('0');
    }
  }

  calculate() {
    try {
      const fullExpr = this.equationString() + this.displayValue();
      // Safe evaluation for basic arithmetic
      const sanitized = fullExpr.replace(/×/g, '*').replace(/÷/g, '/');
      const result = eval(sanitized);
      
      const resString = parseFloat(result.toFixed(8)).toString();

      // Add to history
      const newItem: HistoryItem = {
        expression: fullExpr,
        result: resString,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      this.history.update(h => [newItem, ...h.slice(0, 19)]);

      this.equationString.set('');
      this.displayValue.set(resString);
    } catch (e) {
      this.displayValue.set('Error');
    }
  }

  useHistoryItem(item: HistoryItem) {
    this.displayValue.set(item.result);
    this.showHistory.set(false);
  }

  clearHistory() {
    this.history.set([]);
  }

  // --- Sketchpad Methods ---
  startDrawing(event: MouseEvent | TouchEvent) {
    this.isDrawing = true;
    const pos = this.getEventPos(event);
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  draw(event: MouseEvent | TouchEvent) {
    if (!this.isDrawing) return;
    event.preventDefault();
    const pos = this.getEventPos(event);

    this.ctx.strokeStyle = this.activeTool() === 'eraser' ? '#ffffff' : this.penColor();
    this.ctx.lineWidth = this.activeTool() === 'eraser' ? 24 : this.penSize();
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
  }

  stopDrawing() {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.saveState();
    }
  }

  private getEventPos(event: MouseEvent | TouchEvent) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in event) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }
  
  private saveState() {
    const canvas = this.canvasRef.nativeElement;

    if (
      !this.ctx ||
      canvas.width <= 0 ||
      canvas.height <= 0
    ) {
      return;
    }

    if (this.undoStack.length >= 8) {
      this.undoStack.shift();
    }

    this.undoStack.push(
      this.ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      )
    );
  }

  undoCanvas() {
    if (this.undoStack.length > 1) {
      this.undoStack.pop();
      const previousState = this.undoStack[this.undoStack.length - 1];
      this.ctx.putImageData(previousState, 0, 0);
    }
  }

  clearCanvas() {
    const canvas = this.canvasRef.nativeElement;
    if (!this.ctx || canvas.width <= 0 || canvas.height <= 0) return;

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.saveState();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
}
