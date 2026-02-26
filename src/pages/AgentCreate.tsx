import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Database, ArrowLeft, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { createAgent, setAgentTables, getMetadata } from "@/lib/api";
import { DatabaseMetadata } from "@/types/database";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function AgentCreate() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemmer, setSystemPrompt] = useState("");
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [availableTables, setAvailableTables] = useState<{ schema: string; table: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadTables = async () => {
      try {
        const metadata = await getMetadata();
        const tableSet = new Map<string, { schema: string; table: string }>();
        metadata.forEach((m: DatabaseMetadata) => {
          const key = JSON.stringify({ schema: m.schema_name, table: m.table_name });
          if (!tableSet.has(key)) {
            tableSet.set(key, { schema: m.schema_name, table: m.table_name });
          }
        });
        setAvailableTables(Array.from(tableSet.values()));
      } catch (error) {
        console.error("Failed to load tables:", error);
      }
    };
    loadTables();
  }, []);

  const toggleTable = (key: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome do agente é obrigatório");
      return;
    }
    if (selectedTables.size === 0) {
      toast.error("Selecione pelo menos uma tabela");
      return;
    }

    setSaving(true);
    try {
      const agent = await createAgent({
        name: name.trim(),
        description: description.trim() || "",
        system_prompt: systemPrompt.trim() || null,
      });

      const tables = Array.from(selectedTables).map((key) => {
        const parsed = JSON.parse(key) as { schema: string; table: string };
        return { schema_name: parsed.schema, table_name: parsed.table };
      });

      await setAgentTables(agent.id, tables);
      toast.success("Agente criado com sucesso!");
      navigate("/");
    } catch (error) {
      toast.error("Erro ao criar agente");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-6 py-4 border-b">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Database className="w-5 h-5 text-primary" />
        <span className="font-semibold">Criar Agente</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Novo Agente Especialista</h1>
            <p className="text-sm text-muted-foreground">
              Configure um agente com acesso a tabelas específicas
            </p>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Nome do Agente *</Label>
          <Input
            id="name"
            placeholder='Ex: "Analista Financeiro"'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Descrição (opcional)</Label>
          <Input
            id="description"
            placeholder="Breve descrição do que este agente faz"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* System Prompt */}
        <div className="space-y-2">
          <Label htmlFor="prompt">Prompt Personalizado (opcional)</Label>
          <Textarea
            id="prompt"
            className="min-h-[140px]"
            placeholder={`Deixe vazio para usar o prompt padrão de analista de negócios.\n\nExemplo personalizado:\n"Você é um analista financeiro focado em fluxo de caixa. Sempre destaque riscos de inadimplência e sugira ações preventivas."`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Se vazio, o agente usará um prompt padrão de analista de negócios senior.
          </p>
        </div>

        {/* Table selection */}
        <div className="space-y-3">
          <Label>Tabelas do Agente *</Label>
          <p className="text-xs text-muted-foreground">
            Selecione as tabelas que este agente poderá consultar.
          </p>
          <div className="rounded-lg border bg-card p-4 max-h-[300px] overflow-y-auto space-y-2">
            {availableTables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma tabela disponível. Sincronize os metadados na aba Admin.
              </p>
            ) : (
              availableTables.map(({ schema, table }) => {
                const key = JSON.stringify({ schema, table });
                return (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-secondary/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedTables.has(key)}
                      onCheckedChange={() => toggleTable(key)}
                    />
                    <span className="text-sm">
                      <span className="text-muted-foreground">{schema}.</span>
                      <span className="font-medium">{table}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={() => navigate("/")} className="flex-1">
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? "Salvando..." : "Criar Agente"}
          </Button>
        </div>
      </main>
    </div>
  );
}
