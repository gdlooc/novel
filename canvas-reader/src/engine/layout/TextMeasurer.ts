/**
 * TextMeasurer — Wraps Canvas 2D measureText API for accurate text measurement.
 *
 * Uses an offscreen canvas to measure text without affecting the visible canvas.
 * All measurements are in CSS pixels. Handles font configuration.
 */

import type { LayoutConfig } from './types';

/**
 * Creates a text measurer backed by a persistent offscreen 2D context.
 * The context is cheap to keep alive and avoids repeated canvas creation.
 */
export class TextMeasurer {
  private ctx: CanvasRenderingContext2D;
  private _fontSize: number = 16;
  private _fontFamily: string = 'serif';
  private _lineHeight: number = 1.8;
  private _fontString: string = '16px serif';

  constructor() {
    // Create a minimal offscreen canvas purely for measurement
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for TextMeasurer');
    }
    this.ctx = ctx;
    this.updateFontString();
  }

  /**
   * Update the measurer's configuration from a LayoutConfig.
   */
  configure(config: LayoutConfig): void {
    this._fontSize = config.fontSize;
    this._fontFamily = config.fontFamily;
    this._lineHeight = config.lineHeight;
    this.updateFontString();
  }

  /**
   * Set font size directly.
   */
  set fontSize(size: number) {
    this._fontSize = size;
    this.updateFontString();
  }

  get fontSize(): number {
    return this._fontSize;
  }

  /**
   * Set font family directly.
   */
  set fontFamily(family: string) {
    this._fontFamily = family;
    this.updateFontString();
  }

  get fontFamily(): string {
    return this._fontFamily;
  }

  /**
   * Set line height multiplier.
   */
  set lineHeight(lh: number) {
    this._lineHeight = lh;
  }

  get lineHeight(): number {
    return this._lineHeight;
  }

  private updateFontString(): void {
    this._fontString = `${this._fontSize}px ${this._fontFamily}`;
  }

  /**
   * Get the current CSS font string for canvas.
   */
  get fontString(): string {
    return this._fontString;
  }

  /**
   * Measure the width of a text string in CSS pixels.
   */
  measureWidth(text: string): number {
    if (!text) return 0;
    this.ctx.font = this._fontString;
    return this.ctx.measureText(text).width;
  }

  /**
   * Measure the width of a single character.
   */
  measureChar(c: string): number {
    return this.measureWidth(c);
  }

  /**
   * Get the line height in CSS pixels (fontSize * lineHeight).
   */
  get lineHeightPx(): number {
    return this._fontSize * this._lineHeight;
  }

  /**
   * Get the EM unit size (same as fontSize).
   */
  get emSize(): number {
    return this._fontSize;
  }

  /**
   * Measure multiple strings and return their widths.
   */
  measureWidths(texts: string[]): number[] {
    this.ctx.font = this._fontString;
    return texts.map((t) => (t ? this.ctx.measureText(t).width : 0));
  }
}
