import { describe, it, expect, vi, afterEach } from 'vitest'
import { listProviderModels } from './models'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return { ok: false, status, json: async () => json } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('listProviderModels — OpenRouter', () => {
  it('confirms the key, then returns text models sorted by id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ data: { label: 'sk-or-v1-abc' } }))
      .mockResolvedValueOnce(
        okResponse({
          data: [
            { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o-mini', architecture: { output_modalities: ['text'] } },
            { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic: Claude Haiku 4.5' },
            { id: 'some/image-gen', name: 'Image only', architecture: { output_modalities: ['image'] } },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listProviderModels('openrouter', 'sk-or-test')

    expect(models).toEqual([
      { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic: Claude Haiku 4.5' },
      { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o-mini' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-test')
    expect(fetchMock.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/models')
  })

  it('rejects an invalid key before listing models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(401, { error: { message: 'User not found.' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listProviderModels('openrouter', 'bad')).rejects.toMatchObject({
      code: 'invalid_key',
      status: 401,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('listProviderModels — native providers', () => {
  it('keeps only chat models from OpenAI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini' }, { id: 'whisper-1' }, { id: 'o3-mini' }, { id: 'gpt-4o-realtime-preview' }],
        }),
      ),
    )
    const models = await listProviderModels('openai', 'sk-test')
    expect(models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'o3-mini'])
  })

  it('uses Anthropic display names and auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const models = await listProviderModels('anthropic', 'sk-ant-test')
    expect(models).toEqual([{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }])
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-test')
  })

  it('refuses OpenAI-compatible providers', async () => {
    await expect(listProviderModels('openai_compatible', 'k')).rejects.toMatchObject({
      code: 'unsupported_provider',
    })
  })
})
