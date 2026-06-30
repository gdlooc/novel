/**
 * useKeyboardNav — Desktop keyboard shortcuts for the reader.
 *
 * Supports:
 * - Left/Right arrows: prev/next page
 * - Space/Shift+Space: next/prev page
 * - F: toggle fullscreen
 * - Escape: close panels
 * - T: toggle TOC
 */

import { useEffect } from 'react';
import type { PageTurnResult } from './usePageTurn';

interface UseKeyboardNavOptions {
  goNext: () => Promise<PageTurnResult>;
  goPrev: () => Promise<PageTurnResult>;
  toggleBars: () => void;
  toggleToc: () => void;
  toggleSettings: () => void;
  toggleFullscreen: () => void;
  enabled?: boolean;
}

export function useKeyboardNav({
  goNext,
  goPrev,
  toggleBars,
  toggleToc,
  toggleSettings,
  toggleFullscreen,
  enabled = true,
}: UseKeyboardNavOptions): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when an input is focused
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          goPrev();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          e.preventDefault();
          toggleBars(); // Close everything
          break;
        case 't':
        case 'T':
          e.preventDefault();
          toggleToc();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          toggleSettings();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, toggleBars, toggleToc, toggleSettings, toggleFullscreen, enabled]);
}
