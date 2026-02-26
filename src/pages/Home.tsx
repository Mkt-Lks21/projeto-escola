import { Link } from "react-router-dom";
import { Database, MessageSquare, Bot, Settings } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import AgentCard from "@/components/home/AgentCard";

export default function Home() {
  const { agents, loading, remove } = useAgents();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          <span className="font-semibold text-lg">DB Analyst</span>
        </div>
        <Link
          to="/admin"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="w-4 h-4" />
          Configurações
        </Link>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Bem-vindo ao DB Analyst</h1>
        <p className="text-muted-foreground mb-10">
          Converse com seus dados ou crie agentes especialistas.
        </p>

        {/* Action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl mb-14">
          <Link
            to="/chat"
            className="group rounded-xl border bg-card p-6 text-center transition-colors hover:border-primary/40"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <MessageSquare className="h-7 w-7 text-primary" />
            </div>
            <h2 className="font-semibold text-lg mb-1">Novo Chat</h2>
            <p className="text-sm text-muted-foreground">
              Inicie uma conversa livre com seu banco de dados
            </p>
          </Link>

          <Link
            to="/agents/new"
            className="group rounded-xl border bg-card p-6 text-center transition-colors hover:border-primary/40"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <h2 className="font-semibold text-lg mb-1">Criar Agente</h2>
            <p className="text-sm text-muted-foreground">
              Crie um agente especialista em tabelas específicas
            </p>
          </Link>
        </div>

        {/* Agents list */}
        {!loading && agents.length > 0 && (
          <div className="w-full max-w-3xl">
            <h2 className="text-lg font-semibold mb-4">Meus Agentes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} onDelete={remove} />
              ))}
            </div>
          </div>
        )}

        {!loading && agents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum agente criado ainda. Crie seu primeiro agente especialista!
          </p>
        )}
      </main>
    </div>
  );
}
