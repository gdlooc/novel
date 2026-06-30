/**
 * TocPanel — Slide-up table of contents with volume/chapter hierarchy.
 *
 * Supports:
 * - Volume grouping
 * - Current chapter highlight
 * - Tap to navigate
 */

import React from 'react';
import { useReaderStore } from '@store/readerStore';
import { useUIStore } from '@store/uiStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useSettingsStore } from '@store/settingsStore';
import type { TocEntry } from '@book/types';

interface TocPanelProps {
  onChapterSelect: (chapterId: string) => void;
}

export const TocPanel: React.FC<TocPanelProps> = ({ onChapterSelect }) => {
  const chapterNav = useReaderStore((s) => s.chapterNav);
  const currentChapterId = useReaderStore((s) => s.chapterId);
  const { setShowToc } = useUIStore();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  const handleSelect = (chapterId: string) => {
    setShowToc(false);
    onChapterSelect(chapterId);
  };

  if (!chapterNav) return null;

  // Build display entries from the navigation
  const displayEntries = buildDisplayEntries(chapterNav);

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 200,
    maxHeight: '75vh',
    overflowY: 'auto',
    background: colors['ui-background'],
    borderTop: `1px solid ${colors['ui-border']}`,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: '20px 16px',
    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
    color: colors['ui-text'],
    boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
  };

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 199,
          background: 'rgba(0,0,0,0.3)',
        }}
        onClick={() => setShowToc(false)}
      />

      <div style={panelStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>目录</h2>
          <button
            onClick={() => setShowToc(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              color: colors['ui-text-secondary'],
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Chapter count */}
        <div
          style={{
            fontSize: 12,
            color: colors['ui-text-secondary'],
            marginBottom: 12,
          }}
        >
          共 {chapterNav.totalChapters} 章
        </div>

        {/* Entry list */}
        <div>
          {displayEntries.map((entry) => {
            const isCurrent = entry.chapterId === currentChapterId;
            const isVolume = entry.isVolume;

            return (
              <div
                key={entry.chapterId}
                onClick={() => {
                  if (!isVolume && entry.chapterId) {
                    handleSelect(entry.chapterId);
                  }
                }}
                style={{
                  padding: isVolume ? '10px 8px 6px' : '8px 8px 8px 24px',
                  fontSize: isVolume ? 13 : 14,
                  fontWeight: isVolume ? 600 : isCurrent ? 600 : 400,
                  color: isCurrent
                    ? colors['ui-accent']
                    : isVolume
                      ? colors['ui-text']
                      : colors['ui-text'],
                  background: isCurrent
                    ? colors['ui-accent'] + '15'
                    : 'transparent',
                  borderRadius: 6,
                  cursor: isVolume ? 'default' : 'pointer',
                  borderLeft: isCurrent ? `3px solid ${colors['ui-accent']}` : '3px solid transparent',
                  marginBottom: 2,
                }}
              >
                {entry.title}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

/** Display entry for TOC rendering */
interface DisplayEntry {
  chapterId: string;
  title: string;
  isVolume: boolean;
}

function buildDisplayEntries(
  nav: NonNullable<ReturnType<typeof useReaderStore.getState>['chapterNav']>,
): DisplayEntry[] {
  const entries: DisplayEntry[] = [];

  // The TOC might have a flat or nested structure
  for (const ch of nav.chapters) {
    // Check if there are children (volume structure)
    if (ch.children && ch.children.length > 0) {
      // Find the parent volume entry from the raw TOC data
      // We'll display the volume name, then its children
      entries.push({
        chapterId: ch.chapterId,
        title: ch.title,
        isVolume: true,
      });
      for (const child of ch.children) {
        entries.push({
          chapterId: child.chapterId,
          title: child.title,
          isVolume: false,
        });
      }
    } else {
      // Flat chapter
      entries.push({
        chapterId: ch.chapterId,
        title: ch.title,
        isVolume: false,
      });
    }
  }

  return entries;
}
