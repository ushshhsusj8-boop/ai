import { collectProviderStream } from './provider_stream.mjs';
import { imageParts } from '../public/image_attachments.js';
const MAX_SEARCH_SOURCES = 12;
const MAX_SOURCE_URL_CHARS = 2048;
const MAX_SOURCE_TITLE_CHARS = 240;
const MAX_SEARCH_QUERY_CHARS = 300;
const MAX_SEARCH_QUERIES = 8;
const MAX_SEARCH_SUGGESTIONS_CHARS = 50_000;

function safeWebUrl(value) {
  if (typeof value !== "string" || value.length > MAX_SOURCE_URL_CHARS) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeSources(candidates) {
  const sources = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const url = safeWebUrl(candidate?.url ?? candidate?.uri);
    if (!url || seen.has(url)) continue;
    let title = typeof candidate?.title === "string"
      ? candidate.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_TITLE_CHARS)
      : "";
    if (!title) title = new URL(url).hostname;
    sources.push({ title, url });
    seen.add(url);
    if (sources.length >= MAX_SEARCH_SOURCES) break;
  }
  return sources;
}

function normalizeSearchQueries(values) {
  const queries = [];
  const seen = new Set();
  for (const value of values || []) {
    if (typeof value !== "string") continue;
    const query = value.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_QUERY_CHARS);
    if (!query || seen.has(query)) continue;
    queries.push(query);
    seen.add(query);
    if (queries.length >= MAX_SEARCH_QUERIES) break;
  }
  return queries;
}

function responseOutputTextItems(payload) {
  const items = [];
  for (const output of payload?.output || []) {
    if (output?.type !== "message") continue;
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") items.push(content);
    }
  }
  return items;
}

function openAICitation(annotation) {
  if (annotation?.type !== "url_citation") return null;
  const value = annotation.url_citation && typeof annotation.url_citation === "object"
    ? annotation.url_citation : annotation;
  const url = safeWebUrl(value.url);
  if (!url) return null;
  return {
    url,
    title: value.title,
    startIndex: value.start_index,
    endIndex: value.end_index,
  };
}

function responsesSources(payload) {
  const candidates = [];
  for (const content of responseOutputTextItems(payload)) {
    for (const annotation of content.annotations || []) {
      const citation = openAICitation(annotation);
      if (citation) candidates.push(citation);
    }
  }
  for (const output of payload?.output || []) {
    if (output?.type !== "web_search_call") continue;
    for (const source of output.action?.sources || []) candidates.push(source);
  }
  return normalizeSources(candidates);
}

function decorateResponseText(text, annotations, sources) {
  const sourceIndex = new Map(sources.map((source, index) => [source.url, index + 1]));
  const insertions = [];
  const seen = new Set();
  for (const annotation of annotations || []) {
    const citation = openAICitation(annotation);
    const number = citation ? sourceIndex.get(citation.url) : undefined;
    const endIndex = citation?.endIndex;
    if (!number || !Number.isSafeInteger(endIndex) || endIndex < 0 || endIndex > text.length) continue;
    const key = `${endIndex}:${number}`;
    if (seen.has(key)) continue;
    const markdownUrl = citation.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
    insertions.push({ endIndex, marker: ` [${number}](${markdownUrl})` });
    seen.add(key);
  }
  insertions.sort((a, b) => b.endIndex - a.endIndex);
  let result = text;
  for (const insertion of insertions) {
    result = `${result.slice(0, insertion.endIndex)}${insertion.marker}${result.slice(insertion.endIndex)}`;
  }
  return result;
}

function responsesText(payload, sources = []) {
  const items = responseOutputTextItems(payload);
  if (items.length) {
    return items.map((content) => decorateResponseText(
      content.text,
      content.annotations,
      sources,
    )).join("\n").trim();
  }
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  return "";
}

function responsesSearchQueries(payload) {
  const candidates = [];
  for (const output of payload?.output || []) {
    if (output?.type !== "web_search_call") continue;
    if (typeof output.action?.query === "string") candidates.push(output.action.query);
    if (Array.isArray(output.action?.queries)) candidates.push(...output.action.queries);
  }
  return normalizeSearchQueries(candidates);
}

function responsesSearchUsed(payload) {
  return (payload?.output || []).some((item) => item?.type === "web_search_call");
}

function responsesUsage(payload) {
  const usage = payload?.usage;
  if (
    !Number.isSafeInteger(usage?.input_tokens)
    || usage.input_tokens < 0
    || !Number.isSafeInteger(usage?.output_tokens)
    || usage.output_tokens < 0
    || !Number.isSafeInteger(usage?.total_tokens)
    || usage.total_tokens < 0
  ) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

function chatCompletionsAnnotations(payload) {
  const annotations = payload?.choices?.[0]?.message?.annotations;
  return Array.isArray(annotations) ? annotations : [];
}

function chatCompletionsSources(payload) {
  return normalizeSources(chatCompletionsAnnotations(payload)
    .map(openAICitation)
    .filter(Boolean));
}

function chatCompletionsSearchUsed(payload) {
  const count = payload?.usage?.server_tool_use?.web_search_requests;
  return (Number.isSafeInteger(count) && count > 0)
    || chatCompletionsAnnotations(payload).some((item) => item?.type === "url_citation");
}

function chatCompletionsText(payload, sources = []) {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  return typeof content === "string"
    ? decorateResponseText(content, chatCompletionsAnnotations(payload), sources).trim()
    : "";
}

function chatCompletionsUsage(payload) {
  const usage = payload?.usage;
  const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
  const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
  if (
    !Number.isSafeInteger(inputTokens)
    || inputTokens < 0
    || !Number.isSafeInteger(outputTokens)
    || outputTokens < 0
    || !Number.isSafeInteger(usage?.total_tokens)
    || usage.total_tokens < 0
  ) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens,
  };
}

function geminiText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .filter((part) => part?.thought !== true && typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function geminiUsage(payload) {
  const usage = payload?.usageMetadata;
  if (
    !Number.isSafeInteger(usage?.promptTokenCount)
    || usage.promptTokenCount < 0
    || !Number.isSafeInteger(usage?.candidatesTokenCount)
    || usage.candidatesTokenCount < 0
    || !Number.isSafeInteger(usage?.totalTokenCount)
    || usage.totalTokenCount < 0
  ) return undefined;
  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

function geminiGroundingMetadata(payload) {
  return payload?.candidates?.[0]?.groundingMetadata;
}

function geminiSources(payload) {
  return normalizeSources((geminiGroundingMetadata(payload)?.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter(Boolean));
}

function geminiSearchQueries(payload) {
  return normalizeSearchQueries(geminiGroundingMetadata(payload)?.webSearchQueries);
}

function geminiSearchSuggestions(payload) {
  const html = geminiGroundingMetadata(payload)?.searchEntryPoint?.renderedContent;
  return typeof html === "string" && html.length <= MAX_SEARCH_SUGGESTIONS_CHARS ? html : undefined;
}

function geminiSearchUsed(payload) {
  const metadata = geminiGroundingMetadata(payload);
  return Boolean(metadata && (
    metadata.webSearchQueries?.length
    || metadata.groundingChunks?.length
    || metadata.searchEntryPoint?.renderedContent
  ));
}

function geminiFinishReason(payload) {
  const reason = payload?.candidates?.[0]?.finishReason;
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(reason)) {
    return "content_filter";
  }
  return null;
}

function finishReasonFor(provider, payload) {
  if (provider.protocol === "chat-completions") {
    const reason = payload?.choices?.[0]?.finish_reason;
    if (["stop", "length", "content_filter", "tool_calls"].includes(reason)) return reason;
    return null;
  }
  if (provider.protocol === "responses") {
    if (payload?.status === "incomplete") return "length";
    if (payload?.status === "completed") return "stop";
  }
  return null;
}

function geminiSearchRequest(provider, messages, config, generationParameters) {
  if (!provider.webSearchApiBaseUrl) {
    const error = new Error("Gemini web search endpoint is not configured");
    error.statusCode = 500;
    throw error;
  }
  const model = provider.model.replace(/^models\//, "");
  const url = new URL(`./${encodeURIComponent(model)}:generateContent`, provider.webSearchApiBaseUrl);
  const generationConfig = {
    ...(config.maxOutputTokens > 0 ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(generationParameters.temperature !== undefined
      ? { temperature: generationParameters.temperature } : {}),
    ...(generationParameters.top_p !== undefined
      ? { topP: generationParameters.top_p } : {}),
    ...(/^gemini-2\.5-flash(?:$|-)/.test(model)
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : /^gemini-2\.5-pro(?:$|-)/.test(model)
        ? { thinkingConfig: { thinkingBudget: 128 } }
        : {}),
  };
  return {
    url: url.toString(),
    headers: {
      "x-goog-api-key": provider.apiKey,
      "content-type": "application/json",
    },
    body: {
      systemInstruction: { parts: [{ text: config.systemPrompt }] },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      tools: [{ google_search: {} }],
      generationConfig,
    },
    parseText: geminiText,
    parseUsage: geminiUsage,
    parseSources: geminiSources,
    parseSearchQueries: geminiSearchQueries,
    parseSearchSuggestions: geminiSearchSuggestions,
    parseSearchUsed: geminiSearchUsed,
    parseFinishReason: geminiFinishReason,
  };
}

function requestFor(provider, messages, config, generationParameters = {}, webSearch = false) {
  const sampling = {
    ...(generationParameters.temperature !== undefined
      ? { temperature: generationParameters.temperature } : {}),
    ...(generationParameters.top_p !== undefined
      ? { top_p: generationParameters.top_p } : {}),
  };
  if (webSearch && provider.webSearchProtocol === "google-search") {
    return geminiSearchRequest(provider, messages, config, generationParameters);
  }
  if (webSearch && !["openai-web-search", "openrouter-web-search"].includes(provider.webSearchProtocol)) {
    const error = new Error("This provider does not support official web search");
    error.statusCode = 400;
    throw error;
  }
  if (provider.protocol === "responses") {
    return {
      url: provider.apiUrl,
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: {
        model: provider.model,
        instructions: config.systemPrompt,
        input: imageParts(messages, 'responses'),
        ...(config.maxOutputTokens > 0 ? { max_output_tokens: config.maxOutputTokens } : {}),
        store: false,
        ...sampling,
        ...(webSearch ? {
          tools: [{ type: "web_search" }],
          tool_choice: "required",
          max_tool_calls: 3,
          include: ["web_search_call.action.sources"],
        } : {}),
      },
      parseText: responsesText,
      parseUsage: responsesUsage,
      ...(webSearch ? {
        parseSources: responsesSources,
        parseSearchQueries: responsesSearchQueries,
        parseSearchUsed: responsesSearchUsed,
      } : {}),
    };
  }

  if (provider.protocol === "chat-completions") {
    const openRouterSearch = webSearch && provider.webSearchProtocol === "openrouter-web-search";
    return {
      url: provider.apiUrl,
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: {
        model: provider.model,
        messages: [
          { role: "system", content: config.systemPrompt },
          ...imageParts(messages, 'chat-completions'),
        ],
        ...(config.maxOutputTokens > 0 ? { max_tokens: config.maxOutputTokens } : {}),
        stream: false,
        ...sampling,
        ...(openRouterSearch ? {
          tools: [{
            type: "openrouter:web_search",
            parameters: {
              engine: "auto",
              max_results: 5,
              max_total_results: 10,
              max_uses: 2,
              search_context_size: "low",
            },
          }],
          max_tool_calls: 3,
        } : {}),
        ...(provider.id === "gemini" && /^gemini-2\.5-flash(?:$|-)/.test(provider.model)
          ? { reasoning_effort: "none" }
          : {}),
      },
      parseText: chatCompletionsText,
      parseUsage: chatCompletionsUsage,
      ...(openRouterSearch ? {
        parseSources: chatCompletionsSources,
        parseSearchQueries: () => [],
        parseSearchUsed: chatCompletionsSearchUsed,
      } : {}),
    };
  }

  throw new Error(`Unsupported provider protocol: ${provider.protocol}`);
}

export async function callProvider({
  provider,
  messages,
  config,
  request,
  response,
  requestId,
  fetchImpl,
  generationParameters = {},
  webSearch = false,
  onDelta,
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.requestTimeoutMs);
  const abortOnDisconnect = () => controller.abort();
  request.once("aborted", abortOnDisconnect);
  response.once("close", abortOnDisconnect);

  try {
    const upstreamRequest = requestFor(
      provider,
      messages,
      config,
      generationParameters,
      webSearch,
    );
    const streaming = typeof onDelta === 'function' && !webSearch;
    if (streaming) {
      upstreamRequest.body.stream = true;
      if (provider.protocol === 'chat-completions') upstreamRequest.body.stream_options = { include_usage: true };
    }
    const upstream = await fetchImpl(upstreamRequest.url, {
      method: "POST",
      redirect: "error",
      headers: {
        ...upstreamRequest.headers,
        ...(streaming ? { accept: 'text/event-stream' } : {}),
        "user-agent": "huawei-cloud-backend/0.2",
      },
      body: JSON.stringify(upstreamRequest.body),
      signal: controller.signal,
    });

    const upstreamRequestId = upstream.headers.get("x-request-id")
      || upstream.headers.get("x-goog-request-id")
      || undefined;
    if (!upstream.ok) {
      console.error(JSON.stringify({
        level: "error",
        event: "upstream_rejected",
        requestId,
        upstreamRequestId,
        provider: provider.id,
        status: upstream.status,
      }));
      const error = new Error("The upstream request failed");
      error.statusCode = upstream.status === 429 ? 429 : 502;
      error.retryAfter = upstream.headers.get("retry-after") || undefined;
      await upstream.body?.cancel();
      throw error;
    }

    const payload = streaming && upstream.headers.get('content-type')?.includes('text/event-stream')
      ? await collectProviderStream(upstream.body, provider.protocol, onDelta)
      : await upstream.json();
    if (payload?.error) {
      console.error(JSON.stringify({
        level: "error",
        event: "upstream_payload_error",
        requestId,
        upstreamRequestId,
        provider: provider.id,
        code: payload.error.code,
      }));
      const error = new Error("The upstream returned an error payload");
      error.statusCode = Number(payload.error.code) === 429 ? 429 : 502;
      error.usage = upstreamRequest.parseUsage(payload);
      throw error;
    }
    const sources = upstreamRequest.parseSources?.(payload) || [];
    const text = upstreamRequest.parseText(payload, sources);
    const usage = upstreamRequest.parseUsage(payload);
    if (!text) {
      const error = new Error("The upstream response did not contain text");
      error.statusCode = 502;
      error.usage = usage;
      throw error;
    }
    const searchQueries = upstreamRequest.parseSearchQueries?.(payload) || [];
    const searchSuggestions = upstreamRequest.parseSearchSuggestions?.(payload);
    const searchUsed = upstreamRequest.parseSearchUsed?.(payload) || false;
    if (webSearch && provider.webSearchProtocol === "google-search"
      && searchUsed && !searchSuggestions) {
      const error = new Error("The grounded response did not include required search suggestions");
      error.statusCode = 502;
      error.usage = usage;
      throw error;
    }
    return {
      text,
      usage,
      finishReason: upstreamRequest.parseFinishReason?.(payload)
        ?? finishReasonFor(provider, payload),
      upstreamRequestId,
      ...(webSearch ? {
        sources,
        searchQueries,
        searchSuggestions,
        searchUsed,
      } : {}),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const abortError = new Error(
        timedOut ? "The upstream request timed out" : "The client disconnected",
      );
      abortError.statusCode = timedOut ? 504 : 499;
      throw abortError;
    }
    if (Number.isInteger(error?.statusCode)) throw error;
    const upstreamError = new Error("The upstream connection failed");
    upstreamError.statusCode = 502;
    throw upstreamError;
  } finally {
    clearTimeout(timeout);
    request.removeListener("aborted", abortOnDisconnect);
    response.removeListener("close", abortOnDisconnect);
  }
}
