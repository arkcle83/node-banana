"use client";

/**
 * LLMFallbackPopover
 *
 * Small centered modal for selecting a fallback LLM for an llmGenerate node.
 * Persists the selection as a SelectedModel on nodeData.fallbackModel, with
 * "google" mapped to "gemini" as ProviderType (matches how NBP stores LLM
 * provider info so JSON round-trips cleanly).
 */

import { Select, TextInput } from "@/components/ui/Controls";
import { useState, useEffect } from "react";
import { Dialog, DialogBody, DialogButton, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useWorkflowStore } from "@/store/workflowStore";
import type {
  LLMGenerateNodeData,
  NodeLLMProvider,
  LLMModelType,
  ProviderType,
  SelectedModel,
} from "@/types";

import { NODE_LLM_PROVIDER_OPTIONS, defaultLLMModel, isCustomLLMProvider, llmModelLabel, llmModelOptions } from "@/lib/llm/catalog";

const mapLlmToProviderType = (p: NodeLLMProvider): ProviderType =>
  p === "google" ? "gemini" : p;

const mapProviderTypeToLlm = (p: ProviderType): NodeLLMProvider =>
  p === "gemini" ? "google" : (p as NodeLLMProvider);

interface LLMFallbackPopoverProps {
  nodeId: string;
  onClose: () => void;
}

export function LLMFallbackPopover({ nodeId, onClose }: LLMFallbackPopoverProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId));
  const data = node?.data as LLMGenerateNodeData | undefined;
  const existing = data?.fallbackModel;

  const initialProvider: NodeLLMProvider = existing
    ? mapProviderTypeToLlm(existing.provider)
    : "anthropic";
  const initialModel: LLMModelType = (existing?.modelId as LLMModelType) || defaultLLMModel(initialProvider);

  const [provider, setProvider] = useState<NodeLLMProvider>(initialProvider);
  const [model, setModel] = useState<LLMModelType>(initialModel);

  // A legacy id already saved as the fallback stays selectable until changed.
  const isCustom = isCustomLLMProvider(provider);
  const modelOptions = llmModelOptions(provider, existing?.modelId);

  // Ensure model is valid whenever provider changes (the custom endpoint takes any name)
  useEffect(() => {
    if (isCustom) return;
    const valid = modelOptions.some((m) => m.value === model);
    if (!valid) setModel(defaultLLMModel(provider));
  }, [provider, model, modelOptions, isCustom]);

  const handleSave = () => {
    const name = isCustom ? model.trim() : model;
    if (!name) return;
    const label = isCustom ? name : llmModelLabel(name);
    const fallbackModel: SelectedModel = {
      provider: mapLlmToProviderType(provider),
      modelId: name,
      displayName: label,
    };
    updateNodeData(nodeId, { fallbackModel, fallbackParameters: {} });
    onClose();
  };

  const handleRemove = () => {
    updateNodeData(nodeId, { fallbackModel: undefined, fallbackParameters: undefined });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} size="xs" portal>
      <DialogHeader compact closeButton={false}>
        <DialogTitle compact>Select fallback LLM</DialogTitle>
      </DialogHeader>
      <DialogBody compact>
        <label htmlFor="llm-fallback-provider" className="block text-xs text-neutral-400 mb-1">Provider</label>
        <Select
          id="llm-fallback-provider"
          value={provider}
          options={NODE_LLM_PROVIDER_OPTIONS}
          onChange={(next) => {
            setProvider(next as NodeLLMProvider);
            // The custom endpoint's model is typed in, so start from an empty name
            if (isCustomLLMProvider(next)) setModel("");
          }}
          className="mb-3"
        />

        <label htmlFor="llm-fallback-model" className="block text-xs text-neutral-400 mb-1">Model</label>
        {isCustom ? (
          <TextInput
            id="llm-fallback-model"
            type="text"
            value={model}
            placeholder="e.g. llama3.1:8b"
            onChange={(e) => setModel(e.target.value)}
            className="mb-1"
          />
        ) : (
          <Select
            id="llm-fallback-model"
            value={model}
            options={modelOptions}
            onChange={(next) => setModel(next as LLMModelType)}
            className="mb-1"
          />
        )}

      </DialogBody>
      <DialogFooter compact className="justify-between">
        <DialogButton compact variant="danger" onClick={handleRemove}>
          Remove fallback
        </DialogButton>
        <div className="flex gap-1.5">
          <DialogButton compact variant="ghost" onClick={onClose}>
            Cancel
          </DialogButton>
          <DialogButton compact variant="primary" onClick={handleSave} disabled={isCustom && !model.trim()}>
            Save
          </DialogButton>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
