import { AiError, type AiModelOption, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE}/chat/completions`
const OPENROUTER_KEY_URL = `${OPENROUTER_BASE}/key`
const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE}/models`

/**
 * Optional attribution headers OpenRouter uses to show the app on its
 * dashboard / rankings. Harmless when the site URL isn't configured.
 */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Title': 'MVision CRM' }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (site) headers['HTTP-Referer'] = site
  return headers
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface OpenRouterModelsResponse {
  data?: {
    id?: string
    name?: string
    architecture?: { output_modalities?: string[] }
  }[]
}

/**
 * Call OpenRouter's (OpenAI-shaped) Chat Completions endpoint with the
 * caller's own key. Model ids are OpenRouter slugs such as
 * `anthropic/claude-haiku-4.5` or `openai/gpt-4o-mini`.
 */
export async function generateOpenRouter(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...mergeConsecutive(messages)],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenRouter', res)

  const data = (await res.json().catch(() => null)) as OpenRouterResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(t('ai.emptyResponse', { provider: 'OpenRouter' }), {
      code: 'empty_response',
    })
  }

  return {
    text,
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
  }
}

/**
 * Confirm the key with OpenRouter, then return the chat-capable model
 * catalogue. The `/models` listing itself is public, so the key is
 * checked first against `/key` — otherwise any string would "work".
 */
export async function listOpenRouterModels(
  apiKey: string,
  timeoutMs: number,
): Promise<AiModelOption[]> {
  let keyRes: Response
  try {
    keyRes = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, ...attributionHeaders() },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!keyRes.ok) throw await providerHttpError('OpenRouter', keyRes)

  let res: Response
  try {
    res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, ...attributionHeaders() },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenRouter', res)

  const body = (await res.json().catch(() => null)) as OpenRouterModelsResponse | null
  return (body?.data ?? [])
    .filter((m): m is { id: string; name?: string; architecture?: { output_modalities?: string[] } } =>
      typeof m?.id === 'string' && m.id.length > 0,
    )
    // Keep text-generating models; entries without modality info are kept.
    .filter((m) => {
      const out = m.architecture?.output_modalities
      return !Array.isArray(out) || out.includes('text')
    })
    .map((m) => ({ id: m.id, name: m.name?.trim() || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
