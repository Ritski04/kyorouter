// Per-combo / per-model prompt injection, independent of the global customPrompt.
//
// Priority within a request: model prompt (if set & enabled) wins over combo
// prompt (fallback for members without their own). Both are ADDITIVE to the
// global customPrompt — the global "skill" prompt stays intact so token-saving
// instructions never get lost when a combo/model prompt is enabled.
//
// Settings shape (in settingsRepo):
//   comboPrompts: { [comboName]: { text: string, enabled: boolean } }
//   modelPrompts: { [modelId]:   { text: string, enabled: boolean } }
//
// `modelId` matches the routed member string, e.g. "gonka24/claude-5" (with
// provider prefix) or a bare combo-without-slash handled separately.

import { injectSystemPrompt } from "./systemInject.js";

/**
 * Pick the prompt that applies to a (model, comboName) pair.
 * Returns { source, text } or null when nothing is enabled.
 * @param {object} opts
 * @param {object} opts.settings - settings object (must include modelPrompts / comboPrompts)
 * @param {string} opts.model - the routed model member string (e.g. "gonka24/claude-5")
 * @param {string|null} [opts.comboName] - combo name when request came through a combo
 */
export function resolveComboModelPrompt({ settings, model, routedModel, comboName }) {
  try {
    if (!settings || (!model && !routedModel)) return null;

    const modelPrompts = settings.modelPrompts || {};
    const comboPrompts = settings.comboPrompts || {};

    // Try the exact routed member string first (e.g. "Dahl/deepseek-ai/DeepSeek-V4-Flash-0731")
    const routedKeys = routedModel ? [routedModel, stripProviderPrefix(routedModel)] : [];
    for (const key of routedKeys) {
      const direct = modelPrompts[key];
      if (direct && direct.enabled && typeof direct.text === "string" && direct.text.trim()) {
        return { source: "model", text: direct.text, key };
      }
    }

    // Fall back to the bare model id (e.g. "deepseek-ai/DeepSeek-V4-Flash-0731")
    if (model && model !== routedModel) {
      const direct = modelPrompts[model];
      if (direct && direct.enabled && typeof direct.text === "string" && direct.text.trim()) {
        return { source: "model", text: direct.text, key: model };
      }
    }

    // Combo-level fallback when the member has no prompt of its own
    if (comboName && comboPrompts[comboName]) {
      const comboEntry = comboPrompts[comboName];
      if (comboEntry && comboEntry.enabled && typeof comboEntry.text === "string" && comboEntry.text.trim()) {
        return { source: "combo", text: comboEntry.text };
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}

function stripProviderPrefix(modelStr) {
  const slash = modelStr.indexOf("/");
  return slash > 0 ? modelStr.slice(slash + 1) : modelStr;
}

/**
 * Apply the resolved prompt to the final request body.
 * @returns {boolean} true if injected
 */
export function injectComboModelPrompt(body, format, resolution) {
  if (!resolution || !resolution.text) return false;
  try {
    injectSystemPrompt(body, format, resolution.text);
    return true;
  } catch (_) {
    return false;
  }
}
