/**
 * Typed localStorage wrapper with JSON serialization.
 *
 * Provides type-safe read/write for small data (settings, progress).
 * Falls back gracefully if localStorage is unavailable (SSR, privacy mode).
 */

const STORAGE_PREFIX = 'novel-frontend:';

function isAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const available = isAvailable();

export function getItem<T>(key: string, fallback: T): T {
  if (!available) return fallback;
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + key);
    if (value === null) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function setItem<T>(key: string, value: T): void {
  if (!available) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — fail silently
    console.warn(`[localStorage] Failed to write key: ${key}`);
  }
}

export function removeItem(key: string): void {
  if (!available) return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Ignore
  }
}

export function getAllKeys(): string[] {
  if (!available) return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keys.push(key.slice(STORAGE_PREFIX.length));
    }
  }
  return keys;
}
