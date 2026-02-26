import { useState, useEffect, useCallback } from "react";
import { LLMSettings } from "@/types/database";
import { getLLMSettings, saveLLMSettings } from "@/lib/api";

export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const data = await getLLMSettings();
      setSettings(data);
    } catch (error) {
      console.error("Failed to load LLM settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = useCallback(
    async (newSettings: { provider: string; model: string; api_key: string }) => {
      setIsSaving(true);
      try {
        const saved = await saveLLMSettings(newSettings);
        setSettings(saved);
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  return {
    settings,
    isLoading,
    isSaving,
    saveSettings,
  };
}
