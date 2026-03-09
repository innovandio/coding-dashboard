"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useOpenAILoginStream } from "@/hooks/use-openai-login-stream";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export interface CatalogModel {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
}

export interface ProviderGroup {
  id: string;
  models: CatalogModel[];
}

export type ModelApi = "anthropic-messages" | "openai-completions";

export interface ModelConfigState {
  mode: "catalog" | "custom";
  // Catalog fields
  provider: string;
  modelKey: string;
  // Custom fields
  customProvider: string;
  customBaseUrl: string;
  customApi: ModelApi;
  customModelId: string;
  // Shared
  apiKey: string;
  // OpenAI OAuth (set when user signs in via browser)
  openaiAuthenticated?: boolean;
}

interface Props {
  value: ModelConfigState;
  onChange: (v: ModelConfigState) => void;
  disabled?: boolean;
  compact?: boolean;
}

function isOpenAIProvider(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes("openai") || lower.includes("codex");
}

export function isModelConfigValid(state: ModelConfigState): boolean {
  const needsApiKey = !(
    state.mode === "catalog" &&
    isOpenAIProvider(state.provider) &&
    state.openaiAuthenticated
  );
  if (needsApiKey && !state.apiKey) return false;
  if (state.mode === "catalog") {
    return !!(state.provider && state.modelKey);
  }
  return !!(state.customProvider && state.customBaseUrl && state.customModelId);
}

export function emptyModelConfig(): ModelConfigState {
  return {
    mode: "catalog",
    provider: "",
    modelKey: "",
    customProvider: "",
    customBaseUrl: "",
    customApi: "openai-completions",
    customModelId: "",
    apiKey: "",
  };
}

const CUSTOM_SENTINEL = "__custom__";

export function ModelConfigForm({ value, onChange, disabled, compact }: Props) {
  const [catalog, setCatalog] = useState<ProviderGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginActive, setLoginActive] = useState(false);

  const { loginState, exitCode, oauthUrl } = useOpenAILoginStream(loginActive);

  useEffect(() => {
    fetch("/api/model-config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCatalog(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Check OpenAI auth status when an OpenAI provider is selected
  useEffect(() => {
    if (value.mode === "catalog" && isOpenAIProvider(value.provider)) {
      fetch("/api/openai-login/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.authenticated && !value.openaiAuthenticated) {
            onChange({ ...value, openaiAuthenticated: true });
          }
        })
        .catch(() => {});
    }
  }, [value.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open OAuth URL when it arrives
  useEffect(() => {
    if (oauthUrl) {
      window.open(oauthUrl, "_blank");
    }
  }, [oauthUrl]);

  // Auto-complete on success after 2s delay
  useEffect(() => {
    if (loginState === "exited" && exitCode === 0) {
      const timer = setTimeout(() => {
        setLoginActive(false);
        onChange({ ...value, openaiAuthenticated: true });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loginState, exitCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(() => {
    setLoginActive(false);
    // Reset by toggling off then on in next tick
    setTimeout(() => setLoginActive(true), 0);
  }, []);

  const provider = catalog.find((p) => p.id === value.provider);
  const models = provider?.models ?? [];
  const isCustom = value.mode === "custom";

  const labelCls = compact ? "text-[11px]" : "text-xs";
  const inputCls = compact ? "h-7 text-xs" : "h-8 text-xs";
  const gap = compact ? "space-y-2" : "space-y-3";

  // The provider select uses the actual provider id, or __custom__ sentinel
  const selectValue = isCustom ? CUSTOM_SENTINEL : value.provider;

  return (
    <div className={gap}>
      <div className="space-y-1">
        <Label className={labelCls}>Provider</Label>
        <Select
          value={selectValue}
          onValueChange={(id) => {
            if (id === CUSTOM_SENTINEL) {
              onChange({
                ...emptyModelConfig(),
                mode: "custom",
                apiKey: value.apiKey,
              });
            } else {
              const newProvider = catalog.find((p) => p.id === id);
              onChange({
                ...emptyModelConfig(),
                mode: "catalog",
                provider: id,
                modelKey: newProvider?.models[0]?.key ?? "",
              });
            }
          }}
          disabled={disabled || loading}
        >
          <SelectTrigger className={`w-full ${inputCls}`}>
            <SelectValue placeholder={loading ? "Loading providers..." : "Select provider"} />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-60">
            {catalog.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.id}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_SENTINEL}>Custom (OpenAI / Anthropic compatible)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustom ? (
        <>
          <div className="space-y-1">
            <Label className={labelCls}>Provider name</Label>
            <Input
              value={value.customProvider}
              onChange={(e) => onChange({ ...value, customProvider: e.target.value })}
              placeholder="e.g. dashscope"
              className={inputCls}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>API type</Label>
            <Select
              value={value.customApi}
              onValueChange={(v) => onChange({ ...value, customApi: v as ModelApi })}
              disabled={disabled}
            >
              <SelectTrigger className={`w-full ${inputCls}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-60">
                <SelectItem value="openai-completions">OpenAI compatible</SelectItem>
                <SelectItem value="anthropic-messages">Anthropic compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Base URL</Label>
            <Input
              value={value.customBaseUrl}
              onChange={(e) => onChange({ ...value, customBaseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              className={inputCls}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Model ID</Label>
            <Input
              value={value.customModelId}
              onChange={(e) => onChange({ ...value, customModelId: e.target.value })}
              placeholder="e.g. qwen-max"
              className={inputCls}
              disabled={disabled}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <Label className={labelCls}>Model</Label>
          <Select
            value={value.modelKey}
            onValueChange={(key) => onChange({ ...value, modelKey: key })}
            disabled={disabled || loading || models.length === 0}
          >
            <SelectTrigger className={`w-full ${inputCls}`}>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-60">
              {models.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.name}{" "}
                  <span className="text-muted-foreground">
                    ({Math.round(m.contextWindow / 1000)}k ctx)
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isCustom && isOpenAIProvider(value.provider) ? (
        <div className="space-y-1">
          <Label className={labelCls}>Authentication</Label>
          {value.openaiAuthenticated ? (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Signed in with OpenAI
            </div>
          ) : loginState === "exited" && exitCode === 0 ? (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Signed in with OpenAI
            </div>
          ) : loginState === "exited" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <XCircle className="h-4 w-4" />
                Login failed
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full bg-white text-black border text-xs"
                onClick={handleRetry}
                disabled={disabled}
              >
                Retry
              </Button>
            </div>
          ) : loginState === "exchanging" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Completing login...
            </div>
          ) : loginActive && oauthUrl ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Complete sign-in in browser...
            </div>
          ) : loginActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full bg-white text-black border text-xs"
              disabled
            >
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Preparing...
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full bg-white text-black border text-xs"
              onClick={() => setLoginActive(true)}
              disabled={disabled}
            >
              Sign in with OpenAI
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <Label className={labelCls}>API Key</Label>
          <Input
            type="password"
            value={value.apiKey}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            placeholder="API key"
            className={inputCls}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
