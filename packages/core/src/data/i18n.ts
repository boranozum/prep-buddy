// Text placeholder grammar: docs/data-model.md section 2 ("Text placeholders").
// {qty:<ingredient_id>}, {temp_c:N}, {len_cm:N}. Both locales of a string must
// use the same set of placeholders, and instruction text must never contain a
// raw amount, temperature or length outside a placeholder.
import type { Violation } from './types.js';

export interface I18nStringLike {
  en: string;
  tr: string;
}

const LOCALES = ['en', 'tr'] as const;
const PLACEHOLDER_RE = /\{([a-z_]+):([^}]*)\}/g;
const RAW_UNIT_RE = /\b\d+([.,]\d+)?\s?(g|kg|ml|l|cm|mm|°C|°F|C|F)\b/;

function placeholderSet(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map(([, kind, arg]) => `${kind}:${arg}`).sort();
}

/**
 * Validates one I18nString used as instruction/coaching text (task.text,
 * method.text, on_hold_exceeded.text). Structural shape (both locales
 * present and non-empty) is already enforced by the JSON Schema; this
 * checks placeholder grammar, cross-locale consistency, and that no raw
 * amount/temperature/length leaked outside a placeholder.
 */
export function checkText(
  value: I18nStringLike,
  where: string,
  ingredientIds: ReadonlySet<string>,
): Violation[] {
  const violations: Violation[] = [];
  const placeholderSets: Record<string, string[]> = {};

  for (const loc of LOCALES) {
    const text = value[loc];
    const stripped = text.replace(PLACEHOLDER_RE, '');
    if (RAW_UNIT_RE.test(stripped)) {
      violations.push({
        where,
        severity: 'error',
        message: `[${loc}] raw amount/temperature/length in text, use a placeholder: ${JSON.stringify(text.slice(0, 60))}`,
      });
    }
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      const kind = match[1]!;
      const arg = match[2]!;
      if (kind === 'qty') {
        if (!ingredientIds.has(arg)) {
          violations.push({
            where,
            severity: 'error',
            message: `[${loc}] {qty:${arg}} is not an ingredient of this recipe`,
          });
        }
      } else if (kind === 'temp_c' || kind === 'len_cm') {
        if (Number.isNaN(Number(arg)) || arg.trim() === '') {
          violations.push({
            where,
            severity: 'error',
            message: `[${loc}] {${kind}:${arg}} needs a number`,
          });
        }
      } else {
        violations.push({
          where,
          severity: 'error',
          message: `[${loc}] unknown placeholder kind '${kind}'`,
        });
      }
    }
    const leftover = text.replace(PLACEHOLDER_RE, '');
    if (leftover.includes('{') || leftover.includes('}')) {
      violations.push({
        where,
        severity: 'error',
        message: `[${loc}] malformed placeholder braces`,
      });
    }
    placeholderSets[loc] = placeholderSet(text);
  }

  if (placeholderSets['en']!.join('|') !== placeholderSets['tr']!.join('|')) {
    violations.push({
      where,
      severity: 'error',
      message: `placeholders differ between locales: ${JSON.stringify(placeholderSets)}`,
    });
  }

  return violations;
}
