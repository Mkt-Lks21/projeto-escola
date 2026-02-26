import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Bot, MessageSquare, Trash2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAgent, getAgentTables, deleteAgent } from "@/lib/api";
import { Agent, AgentTable } from "@/types/database";
import { toast } from "sonner";

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tables, setTables] = useState<AgentTable[]>([]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const [a, t] = await Promise.all([getAgent(id), getAgentTables(id)]);
        setAgent(a);
        setTables(t);
      } catch {
        toast.error("Agente não encontrado");
        navigate("/");
      }
    };
    load();
  }, [id, navigate]);

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteAgent(id);
      toast.success("Agente excluído");
      navigate("/");
    } catch {
      toast.error("Erro ao excluir");
    }
  };

  if (!agent) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-6 py-4 border-b">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Database className="w-5 h-5 text-primary" />
        <span className="font-semibold">Detalhes do Agente</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/15">
            <Bot className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            {agent.description && (
              <p className="text-muted-foreground mt-1">{agent.description}</p>
            )}
          </div>
        </div>

        {/* Prompt */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-2">Prompt</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {agent.system_prompt || "Usando prompt padrão de analista de negócios."}
          </p>
        </div>

        {/* Tables */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-2">Tabelas ({tables.length})</h3>
          <div className="space-y-1">
            {tables.map((t) => (
              <div key={t.id} className="text-sm">
                <span className="text-muted-foreground">{t.schema_name}.</span>
                <span className="font-medium">{t.table_name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button className="flex-1 gap-2" onClick={() => navigate(`/chat/${agent.id}`)}>
            <MessageSquare className="h-4 w-4" />
            Iniciar Chat
          </Button>
          <Button variant="destructive" className="gap-2" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
            Excluir
          </Button>
        </div>
      </main>
    </div>
  );
}
