import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SUPPORTED_LANGUAGE_CODES } from '../i18n/languages';
import type { TranslationStrings } from '../i18n/types';
import english from './en';
import baseline from './fallback-baseline.json';

const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
const overlayFiles = new Set(
  readdirSync(new URL('.', import.meta.url)).filter((name) => name.endsWith('.ts')).map((name) => name.slice(0, -3)),
);

describe('fork locale overlays', () => {
  // Counts are the untranslated fork-only keys retained from 0b970eac7.
  // Upstream-only locales intentionally inherit those keys from English.
  it.each(SUPPORTED_LANGUAGE_CODES.filter((locale) => locale !== 'en'))(
    '%s keeps upstream keys and does not grow its inherited fork fallback count',
    async (locale) => {
      const overlay: TranslationStrings = overlayFiles.has(locale) ? (await import(`./${locale}.ts`)).default : {};
      const catalog: TranslationStrings = (await import(`../i18n/${locale}/index.ts`)).default;
      for (const [key, translated] of Object.entries(overlay)) {
        expect(english[key], key).toBeDefined();
        expect(translated, key).not.toBe(english[key]);
        expect(placeholders(translated), key).toEqual(placeholders(english[key]));
        expect(catalog[key], key).toBe(translated);
      }
      expect(Object.keys(english).filter((key) => !overlay[key]).length).toBeLessThanOrEqual(
        baseline[locale as keyof typeof baseline],
      );
    },
  );
});
