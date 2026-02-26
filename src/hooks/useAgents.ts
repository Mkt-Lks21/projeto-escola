import { useState, useEffect, useCallback } from "react";
import { Agent } from "@/types/database";
import { getAgents, deleteAgent as apiDeleteAgent } from "@/lib/api";
import { toast } from "sonner";

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAgents();
      setAgents(data);
    } catch (error) {
      console.error("Failed to load agents:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    try {
      await apiDeleteAgent(id);
      setAgents((prev) => prev.filter((a) => a.id !== id));
      toast.success("Agente excluído");
    } catch {
      toast.error("Erro ao excluir agente");
    }
  }, []);

  return { agents, loading, reload: load, remove };
}
