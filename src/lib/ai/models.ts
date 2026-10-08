import { AiError, type AiModelOption, type AiProvider } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'
import { listOpenRouterModels } from './providers/openrouter'

// ============================================================
// Model catalogue lookup for the settings dropdown. Each call doubles
// as a key check: the listing endpoints reject a bad key with 401, so
// a non-empty result means "this key works with this provider".
// ============================================================

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000'
const ANTHROPIC_VERSION = '2023-06-01'

/** OpenAI's /models mixes in embeddings, audio, image and moderation
 *  models; only chat-capable families make sense for replies. */
const OPENAI_CHAT_PREFIX = /^(gpt-|o\d|chatgpt-)/
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|audio|realtime|transcribe|image|moderation|search)/

async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError(provider, res)
  return res.json().catch(() => null)
}

async function listOpenAiModels(apiKey: string, timeoutMs: number): Promise<AiModelOption[]> {
  const body = (await getJson(
    'OpenAI',
    OPENAI_MODELS_URL,
    { Authorization: `Bearer ${apiKey}` },
    timeoutMs,
  )) as { data?: { id?: string }[] } | null
  return (body?.data ?? [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => OPENAI_CHAT_PREFIX.test(id) && !OPENAI_NON_CHAT.test(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, name: id }))
}

async function listAnthropicModels(apiKey: string, timeoutMs: number): Promise<AiModelOption[]> {
  const body = (await getJson(
    'Anthropic',
    ANTHROPIC_MODELS_URL,
    { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    timeoutMs,
  )) as { data?: { id?: string; display_name?: string }[] } | null
  // Anthropic already returns newest first — keep that order.
  return (body?.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => typeof m?.id === 'string')
    .map((m) => ({ id: m.id, name: m.display_name?.trim() || m.id }))
}

/**
 * List the models the given key can use. Throws `AiError` (invalid_key,
 * rate_limited, network…) when the provider rejects the call, and
 * `unsupported_provider` for providers without a catalogue
 * (OpenAI-compatible endpoints — the model stays free text there).
 */
export async function listProviderModels(
  provider: AiProvider,
  apiKey: string,
): Promise<AiModelOption[]> {
  const timeoutMs = aiRequestTimeoutMs()
  switch (provider) {
    case 'openai':
      return listOpenAiModels(apiKey, timeoutMs)
    case 'anthropic':
      return listAnthropicModels(apiKey, timeoutMs)
    case 'openrouter':
      return listOpenRouterModels(apiKey, timeoutMs)
    default:
      throw new AiError(`Model listing is not supported for provider: ${provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}
