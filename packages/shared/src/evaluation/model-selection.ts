// CLI model selection → runtime parameters (#114, shared with #122).
//
// The eval CLI accepts `--model <provider>/<model-id>` as a shorthand, while
// the runtime control surface takes the two dimensions separately
// (`setModel(provider, modelId)`). The split has to happen at the CLI boundary:
// forwarding the prefixed id as the model would ask the runtime for
// `provider/provider/model-id`, a label no provider serves — exactly the
// mislabeled comparison #114 exists to prevent.
//
// Only the FIRST segment is the provider; model ids may themselves contain `/`
// (e.g. `openrouter/anthropic/claude-sonnet-4-5` → provider `openrouter`,
// model `anthropic/claude-sonnet-4-5`).

/** Provider + bare model id as the runtime control surface wants them. */
export interface ModelSelection {
  model?: string;
  provider?: string;
}

/**
 * Split a `provider/model-id` selection into provider + bare model id.
 *
 * - No `/` → returned unchanged (an id without a provider prefix is not a
 *   shorthand).
 * - `provider/` with nothing behind it → returned unchanged, so the runtime
 *   rejects the malformed id loudly instead of silently dropping the model.
 * - An explicit `provider` argument wins over the prefix (same precedence the
 *   CLI used before the two PRs were reconciled).
 */
export function normalizeModelSelection(model?: string, provider?: string): ModelSelection {
  if (!model || !model.includes('/')) return { model, provider };
  const [prefix, ...rest] = model.split('/');
  const modelId = rest.join('/');
  if (modelId.length === 0) return { model, provider };
  return { model: modelId, provider: provider ?? prefix };
}
