import Mustache from "mustache";

// Prompts are plain text, not HTML — disable Mustache's default HTML escaping so
// values like "A & B" or "<co>" pass through verbatim.
Mustache.escape = (text) => text;

/**
 * Render a Mustache prompt template with the given variables.
 *
 * - `{{var}}` is substituted; `{{#section}}…{{/section}}` is included only when
 *   its variable is truthy.
 * - Throws if the rendered output still contains a `{{` placeholder, guarding
 *   against malformed templates or values that inject unrendered tags.
 *
 * Required-variable enforcement is the caller's Zod schema (see `askAi`); this
 * function only renders and sanity-checks the result.
 */
export function renderPrompt(
  template: string,
  variables: Record<string, unknown>,
): string {
  const rendered = Mustache.render(template, variables);

  if (rendered.includes("{{")) {
    throw new Error(
      "Unresolved placeholder remains in rendered prompt — check the template and provided variables.",
    );
  }

  return rendered;
}
