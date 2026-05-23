import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import type {
  AiCallPreset,
  AiCallPresetName,
} from "./models/ai-models-available";

export type AiCallMode = "stream" | "generate" | "agent";

export interface DefinedAiCall<TVariables extends z.ZodType = z.ZodType> {
  id: string;
  /** Absolute path to the call folder, used to resolve prompt.md. */
  dir: string;
  /** Prompt filename within `dir`, e.g. "prompt.md". */
  promptFile: string;
  preset: AiCallPresetName;
  mode: AiCallMode;
  variables: TVariables;
  presetOverrides?: Partial<AiCallPreset>;
}

export interface DefineAiCallConfig<T extends z.ZodType> {
  id: string;
  /**
   * The defining module's `import.meta.url`. The call folder is derived from it
   * so `prompt` is resolved relative to the call's own directory — not the
   * platform module or the bundled chunk.
   */
  importMetaUrl: string;
  /** Prompt file relative to the call folder, e.g. "./prompt.md". */
  prompt: string;
  preset: AiCallPresetName;
  mode: AiCallMode;
  variables: T;
  presetOverrides?: Partial<AiCallPreset>;
}

/**
 * Declare a named AI call: its id (also the log `functionId`), prompt file,
 * preset, mode, and variable schema. Each `ai-calls/<name>/<name>.ts` exports
 * one of these via `defineAiCall({ importMetaUrl: import.meta.url, ... })`.
 */
export function defineAiCall<T extends z.ZodType>(
  config: DefineAiCallConfig<T>,
): DefinedAiCall<T> {
  const dir = dirname(fileURLToPath(config.importMetaUrl));
  const promptFile = config.prompt.replace(/^\.\//, "");

  return {
    id: config.id,
    dir,
    promptFile,
    preset: config.preset,
    mode: config.mode,
    variables: config.variables,
    ...(config.presetOverrides ? { presetOverrides: config.presetOverrides } : {}),
  };
}

/** Read a defined call's prompt template from disk. */
export function loadCallPrompt(call: DefinedAiCall): string {
  return readFileSync(join(call.dir, call.promptFile), "utf8");
}
