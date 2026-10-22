const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_CATALOG_MODELS = 2_000;
const MODEL_ID = /^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/;

function cleanLabel(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
}

function textChatModel(item) {
  const input = item?.architecture?.input_modalities;
  const output = item?.architecture?.output_modalities;
  return Array.isArray(input) && input.includes("text")
    && Array.isArray(output) && output.includes("text");
}

function freeModel(item) {
  const zeroPrice = (value) => (typeof value === "number" && Number.isFinite(value) && value === 0)
    || (typeof value === "string" && value.trim() !== "" && Number(value) === 0);
  const pricing = item?.pricing;
  if (!pricing || !zeroPrice(pricing.prompt) || !zeroPrice(pricing.completion)) return false;
  return pricing.request === undefined || zeroPrice(pricing.request);
}

export function normalizeModelCatalog(payload, provider) {
  const configured = Array.isArray(provider.models) && provider.models.length
    ? provider.models : [provider.model];
  const options = [];
  const seen = new Set();
  const catalogItems = Array.isArray(payload?.data) ? payload.data : [];
  const catalogById = new Map(catalogItems
    .filter((item) => textChatModel(item) && typeof item?.id === "string")
    .map((item) => [item.id, item]));
  const metadataFor = (item) => ({
    inputModalities: item?.architecture?.input_modalities,
    supportedParameters: item?.supported_parameters,
    maxCompletionTokens: item?.top_provider?.max_completion_tokens,
  });
  const labelFor = (item, id) => {
    const name = cleanLabel(item?.name);
    const suffix = freeModel(item) ? " · 免费" : "";
    return name ? `${name}${suffix} · ${id}` : id;
  };
  const append = (id, label = id, metadata = {}) => {
    if (typeof id !== "string" || !MODEL_ID.test(id) || id.includes("://") || seen.has(id)) return;
    const supportedParameters = Array.isArray(metadata.supportedParameters)
      ? [...new Set(metadata.supportedParameters.filter((item) =>
        typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(item)
      ))] : [];
    const maxCompletionTokens = metadata.maxCompletionTokens;
    options.push(Object.freeze({
      id,
      label: cleanLabel(label) || id,
      ...(Array.isArray(metadata.inputModalities) ? { inputModalities: Object.freeze(metadata.inputModalities.filter(value => ['text', 'image'].includes(value))) } : {}),
      ...(supportedParameters.length ? { supportedParameters: Object.freeze(supportedParameters) } : {}),
      ...(Number.isSafeInteger(maxCompletionTokens) && maxCompletionTokens > 0
        ? { maxCompletionTokens } : {}),
    }));
    seen.add(id);
  };

  for (const id of configured) {
    const item = catalogById.get(id);
    if (catalogItems.length && !item && id !== provider.model) continue;
    append(id, labelFor(item, id), metadataFor(item));
  }
  if (catalogItems.length && provider.modelCatalogMode !== "curated") {
    for (const item of catalogItems) {
      if (options.length >= MAX_CATALOG_MODELS || !textChatModel(item)) continue;
      append(item?.id, labelFor(item, item?.id), metadataFor(item));
    }
  }
  return Object.freeze(options);
}

async function fetchModelCatalog(provider, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(provider.modelCatalogUrl, {
      method: "GET",
      redirect: "error",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        accept: "application/json",
        "user-agent": "huawei-cloud-backend/0.2",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`catalog returned ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
      await response.body?.cancel();
      throw new Error("catalog is too large");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_CATALOG_BYTES) {
      throw new Error("catalog is too large");
    }
    const payload = JSON.parse(text);
    if (!Array.isArray(payload?.data) || payload.data.length === 0) {
      throw new Error("catalog did not contain models");
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function hydrateProviderModels(config, fetchImpl = fetch) {
  const entries = await Promise.all(Object.entries(config.providers).map(async ([id, provider]) => {
    if (!provider.modelCatalogUrl) return [id, provider];
    try {
      const payload = await fetchModelCatalog(provider, fetchImpl);
      const modelOptions = normalizeModelCatalog(payload, provider);
      return [id, Object.freeze({
        ...provider,
        models: Object.freeze(modelOptions.map((item) => item.id)),
        modelOptions,
        modelCatalogLoaded: true,
      })];
    } catch {
      console.warn(JSON.stringify({
        level: "warn",
        event: "model_catalog_unavailable",
        provider: id,
      }));
      const modelOptions = normalizeModelCatalog(null, provider);
      return [id, Object.freeze({
        ...provider,
        modelOptions,
        modelCatalogLoaded: false,
      })];
    }
  }));
  return Object.freeze({
    ...config,
    providers: Object.freeze(Object.fromEntries(entries)),
  });
}
