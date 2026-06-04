/**
 * Dynamic font loading via the FontFace API.
 *
 * Allows the reader to load custom fonts (e.g., from Google Fonts or
 * local assets) and ensure they're ready before layout.
 */

/** Font definition for the font picker */
export interface FontOption {
  /** Display name in the UI */
  name: string;
  /** CSS font-family value */
  fontFamily: string;
  /** Optional URL to load via FontFace API */
  sourceUrl?: string;
  /** Font category */
  category: 'serif' | 'sans-serif' | 'monospace';
}

/** Default system font stack for CJK text */
export const DEFAULT_CJK_FONTS: FontOption[] = [
  {
    name: '宋体 (系统默认)',
    fontFamily: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
    category: 'serif',
  },
  {
    name: '黑体',
    fontFamily: '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    category: 'sans-serif',
  },
  {
    name: '楷体',
    fontFamily: '"KaiTi", "STKaiti", "AR PL UKai CN", serif',
    category: 'serif',
  },
  {
    name: '仿宋',
    fontFamily: '"FangSong", "STFangsong", "AR PL UMing CN", serif',
    category: 'serif',
  },
  {
    name: '等宽',
    fontFamily: '"Source Code Pro", "Consolas", "Courier New", monospace',
    category: 'monospace',
  },
];

/**
 * Load a font via the FontFace API.
 * Returns a promise that resolves when the font is ready.
 */
export async function loadFont(
  family: string,
  url: string,
): Promise<FontFace> {
  const font = new FontFace(family, `url(${url})`);
  const loaded = await font.load();
  document.fonts.add(loaded);
  return loaded;
}

/**
 * Check if a font family is available (loaded) in the browser.
 */
export function isFontAvailable(family: string): boolean {
  return document.fonts.check(`12px "${family}"`);
}

/**
 * Wait for a font to be loaded.
 */
export async function waitForFont(family: string): Promise<void> {
  if (isFontAvailable(family)) return;
  await document.fonts.ready;
}

/**
 * Get the available CJK fonts actually installed on the system.
 * Uses a heuristic: tries to measure text width with each font.
 */
export function detectAvailableFonts(): string[] {
  const testString = '测试中文Test 123';
  const testSize = '72px';
  const available: string[] = [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  // Measure with a known fallback font
  ctx.font = `${testSize} serif`;
  const fallbackWidth = ctx.measureText(testString).width;

  const fontsToTest = [
    'SimSun',
    'SimHei',
    'KaiTi',
    'FangSong',
    'Microsoft YaHei',
    'PingFang SC',
    'Noto Serif CJK SC',
    'Noto Sans CJK SC',
    'Source Han Serif SC',
    'Source Han Sans SC',
  ];

  for (const font of fontsToTest) {
    ctx.font = `${testSize} "${font}", serif`;
    const width = ctx.measureText(testString).width;
    // If the width differs from the fallback, the font is likely available
    if (width !== fallbackWidth && width > 0) {
      available.push(font);
    }
  }

  return available;
}
