export function supportsImageInput(provider, model) {
  const metadata = provider.modelOptions?.find(option => option.id === model);
  if (Array.isArray(metadata?.inputModalities)) return metadata.inputModalities.includes('image');
  // Conservative fallbacks for documented direct endpoints. Custom endpoints and
  // catalog failures never inherit vision from an unverified model name.
  let host;
  try { host = new URL(provider.apiUrl).hostname; } catch { return false; }
  if (provider.id === 'deepseek' && host === 'api.deepseek.com') return ['deepseek-flash', 'deepseek-v4-flash-vision-exp'].includes(model);
  if (provider.id === 'gemini' && host === 'generativelanguage.googleapis.com') return /^gemini-(?:2\.5|3[.-])/.test(model);
  return false;
}
