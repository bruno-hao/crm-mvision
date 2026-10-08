import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listProviderModels } from '@/lib/ai/models'
import { AiError, isAiProvider } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ai/models  (admin+)
 *
 * Confirm a provider key and return the models it can use, for the
 * settings model dropdown. Body: `{ provider, api_key? }`. When
 * `api_key` is omitted the stored key is used — but only if it was
 * saved for the same provider (an OpenAI key is useless against
 * OpenRouter). Returns `{ models: [{ id, name }] }`; 400 with the
 * provider's message when the key is rejected.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-models:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    const provider: unknown = body.provider
    if (!isAiProvider(provider)) {
      return NextResponse.json({ error: t('ai.providerInvalid') }, { status: 400 })
    }
    if (provider === 'openai_compatible') {
      return NextResponse.json({ error: t('ai.modelsUnsupported'), code: 'unsupported_provider' }, { status: 400 })
    }

    let apiKeyPlain = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key, provider')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!existing?.api_key || existing.provider !== provider) {
        return NextResponse.json({ error: t('ai.enterApiKey') }, { status: 400 })
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return NextResponse.json({ error: t('ai.storedKeyReenter') }, { status: 400 })
      }
    }

    try {
      const models = await listProviderModels(provider, apiKeyPlain)
      return NextResponse.json({ models })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      console.error('[ai/models] listing error:', err)
      return NextResponse.json({ error: t('ai.modelsFailed') }, { status: 400 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
