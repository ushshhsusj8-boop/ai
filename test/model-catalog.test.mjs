import assert from "node:assert/strict";
import { test } from "node:test";

import { hydrateProviderModels, normalizeModelCatalog } from "../src/model_catalog.mjs";

const provider = Object.freeze({
  id: "openrouter",
  apiKey: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
  model: "openrouter/auto",
  models: ["openrouter/auto", "openrouter/free"],
  modelCatalogUrl: "https://openrouter.test/api/v1/models/user",
});

test("OpenRouter catalog keeps all safe text chat models and useful labels", () => {
  const options = normalizeModelCatalog({
    data: [
      {
        id: "openrouter/free",
        name: "Duplicate",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
      {
        id: "vendor/model:free",
        name: "Vendor\u0000 Model",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        pricing: { prompt: "0", completion: "0" },
      },
      {
        id: "~vendor/model-latest",
        name: "Latest alias",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        pricing: { prompt: "0.1", completion: "0.2" },
      },
      {
        id: "vendor/image-only",
        name: "Image only",
        architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      },
      { id: "https://unsafe.example", name: "Unsafe" },
      {
        id: "vendor/unknown-pricing",
        name: "Unknown pricing",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        pricing: { prompt: null, completion: null },
      },
    ],
  }, provider);

  assert.deepEqual(options.map(({ id }) => id), [
    "openrouter/auto", "openrouter/free", "vendor/model:free", "~vendor/model-latest",
    "vendor/unknown-pricing",
  ]);
  assert.match(options[2].label, /Vendor Model · 免费 · vendor\/model:free/);
  assert.doesNotMatch(options[4].label, /免费/);
});

test("curated catalogs keep only configured models that the account can use", () => {
  const curatedProvider = Object.freeze({
    ...provider,
    modelCatalogMode: "curated",
    models: ["openrouter/auto", "~vendor/smart-latest", "vendor/unavailable"],
  });
  const options = normalizeModelCatalog({
    data: [
      {
        id: "~vendor/smart-latest",
        name: "Smart model",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
      {
        id: "vendor/not-selected",
        name: "Not selected",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
    ],
  }, curatedProvider);

  assert.deepEqual(options.map(({ id }) => id), [
    "openrouter/auto", "~vendor/smart-latest",
  ]);
});

test("catalog hydration authenticates safely and expands the provider allowlist", async () => {
  let captured;
  const config = Object.freeze({ providers: Object.freeze({ openrouter: provider }) });
  const hydrated = await hydrateProviderModels(config, async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      data: Array.from({ length: 15 }, (_, index) => ({
        id: `vendor/model-${index}`,
        name: `Model ${index}`,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      })),
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.equal(captured.url, provider.modelCatalogUrl);
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers.authorization, `Bearer ${provider.apiKey}`);
  assert.equal(hydrated.providers.openrouter.modelCatalogLoaded, true);
  assert.equal(hydrated.providers.openrouter.models.length, 16);
  assert.equal(Object.isFrozen(hydrated.providers.openrouter.models), true);
});

test("catalog failures keep fallback models without logging the API key", async () => {
  const config = Object.freeze({ providers: Object.freeze({ openrouter: provider }) });
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (value) => warnings.push(String(value));
  try {
    for (const responseFactory of [
      () => new Response("unauthorized", { status: 401 }),
      () => new Response("not-json", { status: 200 }),
      () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ]) {
      const hydrated = await hydrateProviderModels(config, async () => responseFactory());
      assert.equal(hydrated.providers.openrouter.modelCatalogLoaded, false);
      assert.deepEqual(hydrated.providers.openrouter.models, provider.models);
    }
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 3);
  assert.equal(warnings.join("\n").includes(provider.apiKey), false);
});
