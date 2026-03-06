import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Database, MessageSquare, Bot, Settings } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { useChat } from "@/hooks/useChat";
import AgentCard from "@/components/home/AgentCard";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileHeader from "@/components/layout/MobileHeader";

export default function Home() {
  const navigate = useNavigate();
  const { agents, loading, remove } = useAgents();
  const {
    conversations,
    currentConversationId,
    selectConversation,
    deleteConversation,
    createNewConversation,
  } = useChat();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    navigate(`/chat?c=${id}`);
  };

  const handleNewConversation = async () => {
    const newConversationId = await createNewConversation();
    if (newConversationId) {
      navigate(`/chat?c=${newConversationId}`);
      return;
    }
    navigate("/chat");
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background p-0 md:p-4 md:gap-4 relative z-10">
      <MobileHeader
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onNewConversation={handleNewConversation}
      />
      <AppSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={handleNewConversation}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col glass-panel md:rounded-2xl overflow-auto relative z-10">
        <header className="hidden md:flex mx-4 mt-4 items-center justify-between px-6 py-4 rounded-2xl glass-panel">
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">Arquem Analyst</span>
          </div>
          <Link
            to="/admin"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="w-4 h-4" />
            Configuracoes
          </Link>
        </header>

        <div className="flex-1 flex flex-col items-center px-4 md:px-6 py-8 md:py-12">
          <h1 className="text-3xl font-bold mb-2">Bem-vindo ao Arquem Analyst</h1>
          <p className="text-muted-foreground mb-10">
            Converse com seus dados ou crie agentes especialistas.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl mb-14">
            <Link
              to="/chat"
              className="group rounded-2xl glass-card glass-hover p-6 text-center"
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
              className="group rounded-2xl glass-card glass-hover p-6 text-center"
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <h2 className="font-semibold text-lg mb-1">Criar Agente</h2>
              <p className="text-sm text-muted-foreground">
                Crie um agente especialista em tabelas especificas
              </p>
            </Link>
          </div>

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
        </div>
      </main>
    </div>
  );
}
