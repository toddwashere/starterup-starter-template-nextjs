import Mustache from "mustache";

// Mustache token: [type, value, start, end, subTokens?, ...]. Variable-bearing
// types are "name" ({{x}}), "&" ({{&x}}/{{{x}}}), and the section openers "#"
// and "^". "!" (comment), "text", ">" (partial) and "=" (set-delimiter) carry
// no schema variable.
type MustacheToken = [string, string, number, number, MustacheToken[]?];

const VARIABLE_TOKEN_TYPES = new Set(["name", "&", "#", "^"]);

function collect(tokens: MustacheToken[], names: string[]): void {
  for (const token of tokens) {
    const [type, value, , , subTokens] = token;
    if (VARIABLE_TOKEN_TYPES.has(type) && !names.includes(value)) {
      names.push(value);
    }
    if (subTokens) {
      collect(subTokens, names);
    }
  }
}

/**
 * Return the distinct top-level variable/section names referenced in a Mustache
 * template, in first-seen order. Comments, literal text, and partials are
 * ignored. Used to assert that a prompt's placeholders match its Zod schema.
 */
export function extractTemplateVars(template: string): string[] {
  const tokens = Mustache.parse(template) as unknown as MustacheToken[];
  const names: string[] = [];
  collect(tokens, names);
  return names;
}
