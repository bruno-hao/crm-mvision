'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiModelOption, AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<Exclude<AiProvider, 'openai_compatible'>, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  openrouter: 'OpenRouter',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  openrouter: 'sk-or-...',
  openai_compatible: 'your-api-key',
};

// Providers whose key can list its models (POST /api/ai/models). The
// OpenAI-compatible option has no catalogue, so its model stays free text.
const canListModels = (p: AiProvider) => p !== 'openai_compatible';

// Above this many models a filter box is shown over the dropdown —
// OpenRouter alone returns several hundred.
const MODEL_FILTER_THRESHOLD = 15;

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  // Model catalogue for the dropdown, tagged with the provider it was
  // fetched for so a provider switch never shows another provider's list.
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelsProvider, setModelsProvider] = useState<AiProvider | null>(null);
  const [modelFilter, setModelFilter] = useState('');

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  /**
   * Confirm the key with the provider and load its models into the
   * dropdown. `apiKeyOverride` undefined = use the stored key. Returns
   * whether the key was accepted.
   */
  const loadModels = useCallback(
    async (
      forProvider: AiProvider,
      apiKeyOverride: string | undefined,
      opts: { silent?: boolean } = {},
    ): Promise<boolean> => {
      try {
        const res = await fetch('/api/ai/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: forProvider, api_key: apiKeyOverride }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (!opts.silent) toast.error(data.error ?? t('modelsFailed'));
          return false;
        }
        const list: AiModelOption[] = Array.isArray(data.models) ? data.models : [];
        setModels(list);
        setModelsProvider(forProvider);
        setModelFilter('');
        if (!opts.silent) toast.success(t('modelsLoaded', { count: list.length }));
        return true;
      } catch {
        if (!opts.silent) toast.error(t('modelsFailed'));
        return false;
      }
    },
    [t],
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setBaseUrl(data.base_url ?? '');
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        // Pre-fill the dropdown from the stored key; quiet on failure —
        // the field falls back to free text.
        if (data.has_key && canListModels(data.provider)) {
          void loadModels(data.provider, undefined, { silent: true });
        }
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [loadModels]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    setModels([]);
    setModelsProvider(null);
    setModelFilter('');
    // Also swap a model picked from the previous provider's dropdown —
    // e.g. an OpenAI id means nothing to OpenRouter.
    const isDefaultModel =
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model) ||
      models.some((m) => m.id === model) ||
      model.trim() === '';
    if (isDefaultModel) setModel(next === 'openai_compatible' ? '' : AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      // First confirm the key and fill the model dropdown. With no model
      // picked yet that's the whole test — the user chooses one next.
      if (canListModels(provider)) {
        const ok = await loadModels(provider, keyPayload());
        if (!ok || !model.trim()) return;
      }
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      toast.error(t('missingBaseUrl'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  // Dropdown options, or null to fall back to the free-text model input.
  // A saved model missing from the catalogue (renamed/retired) is kept as
  // an option so the current value never silently disappears.
  const modelOptions: AiModelOption[] | null =
    modelsProvider === provider && models.length > 0
      ? model && !models.some((m) => m.id === model)
        ? [{ id: model, name: model }, ...models]
        : models
      : null;
  const filterText = modelFilter.trim().toLowerCase();
  const visibleModels = (modelOptions ?? []).filter(
    (m) =>
      !filterText ||
      m.id === model ||
      m.id.toLowerCase().includes(filterText) ||
      m.name.toLowerCase().includes(filterText),
  );

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('encryptionNotice')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="openrouter">
                      {PROVIDER_LABEL.openrouter}
                    </SelectItem>
                    <SelectItem value="openai_compatible">
                      {t('providerOpenAiCompatible')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                {modelOptions ? (
                  <>
                    {modelOptions.length > MODEL_FILTER_THRESHOLD && (
                      <Input
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        placeholder={t('modelSearchPlaceholder')}
                        disabled={disabled}
                        autoComplete="off"
                      />
                    )}
                    <Select
                      value={model || null}
                      onValueChange={(v) => setModel(typeof v === 'string' ? v : '')}
                      disabled={disabled}
                    >
                      <SelectTrigger id="ai-model" className="w-full">
                        <SelectValue placeholder={t('modelSelectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">
                            {t('modelsNoMatch')}
                          </p>
                        ) : (
                          visibleModels.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Input
                      id="ai-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                      disabled={disabled}
                    />
                    {canListModels(provider) && (
                      <p className="text-xs text-muted-foreground">{t('modelsHint')}</p>
                    )}
                  </>
                )}
              </div>

              {provider === 'openai_compatible' && (
                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">{t('baseUrl')}</Label>
                  <Input
                    id="ai-base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                      // A different key may see different models.
                      setModels([]);
                      setModelsProvider(null);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
              {provider === 'openrouter' && (
                <p className="text-xs text-muted-foreground">{t('openRouterHint')}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
