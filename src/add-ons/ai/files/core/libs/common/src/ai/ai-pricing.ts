/**
 * Fallback prices (USD per 1M tokens: [input, output]) for `ai_logs.cost_usd`
 * when the provider does not report the cost itself (OpenRouter does; Gemini
 * does not). Estimates only: check your provider's price page and edit or
 * extend this table. Keys match the model id without the `vendor/` prefix;
 * the longest matching prefix wins (`gemini-2.5-flash-lite-001` →
 * `gemini-2.5-flash-lite`).
 */
export const AI_PRICES_PER_MILLION: Record<string, [input: number, output: number]> = {
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-pro': [1.25, 10],
  'gemini-2.0-flash-lite': [0.075, 0.3],
  'gemini-2.0-flash': [0.1, 0.4],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4.1-mini': [0.4, 1.6],
};

export function findPrice(model: string): [number, number] | null {
  const id = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  let best: string | null = null;
  for (const key of Object.keys(AI_PRICES_PER_MILLION)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? AI_PRICES_PER_MILLION[best] : null;
}

/** Estimated cost in USD, or null for models not in the table. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = findPrice(model);
  if (!price) return null;
  const cost = (promptTokens * price[0] + completionTokens * price[1]) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
