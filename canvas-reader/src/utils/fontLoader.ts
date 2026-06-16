/**
 * 动态字体加载 — 通过 FontFace API 管理 Web 字体。
 *
 * ## 为什么需要字体加载管理
 *
 * Canvas measureText 的准确度依赖于字体是否已加载。
 * 若排版在字体加载前执行，测量宽度可能与实际渲染宽度不同，
 * 导致断行位置错误、文字溢出或显示异常。
 *
 * 本模块确保：
 * 1. 排版前字体已就绪（FontFaceSet.ready）
 * 2. 提供 CJK 字体的系统默认回退链（font stack）
 * 3. 检测系统已安装的字体（用于字体选择器的显示）
 *
 * ## CJK 字体回退链
 *
 * 每个 FontOption 中的 fontFamily 都是完整的 CSS font stack：
 * ```
 * "Noto Serif CJK SC",  ← 首选：Google/Adobe 开源宋体
 * "Source Han Serif SC", ← 二选：思源宋体（同源不同名）
 * "Songti SC",           ← 三选：macOS 系统宋体
 * "SimSun",              ← 四选：Windows 中易宋体
 * serif                  ← 最终回退：浏览器默认衬线体
 * ```
 *
 * 这种设计确保了跨平台一致的阅读体验，
 * 即使某个字体不可用也能降级到系统默认字体。
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
