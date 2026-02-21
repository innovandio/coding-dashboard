"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
}

interface Props {
  value: ModelConfigState;
  onChange: (v: ModelConfigState) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function isModelConfigValid(state: ModelConfigState): boolean {
  if (!state.apiKey) return false;
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

  useEffect(() => {
    fetch("/api/model-config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCatalog(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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
            <SelectItem value={CUSTOM_SENTINEL}>
              Custom (OpenAI / Anthropic compatible)
            </SelectItem>
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
    </div>
  );
}
