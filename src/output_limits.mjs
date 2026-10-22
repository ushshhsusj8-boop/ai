// Reviewed 2026-10-20 against the providers' official API references.
// Unknown models have no invented ceiling; the upstream API validates them.
export function outputTokenLimit(provider, model, siteLimit = 0) {
  const option = provider.modelOptions?.find(item => item.id === model);
  if (provider.id === 'openrouter' && Array.isArray(option?.supportedParameters)
    && !option.supportedParameters.includes('max_tokens')) return 0;
  let modelLimit = option?.maxCompletionTokens;
  const host = new URL(provider.apiUrl).hostname;
  if (host === 'integrate.api.nvidia.com' && model === 'google/diffusiongemma-26b-a4b-it') modelLimit = 32768;
  if (host === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-pro'].includes(model)) modelLimit = 393216;
  const limits = [siteLimit, modelLimit].filter(value => Number.isSafeInteger(value) && value > 0);
  return limits.length ? Math.min(...limits) : undefined;
}

export function outputTokenBounds(limit) {
  return limit === 0 ? {} : { max_output_tokens: { min: 1, ...(limit ? { max: limit } : {}) } };
}
