import { Link, useLocation } from "react-router-dom";
import { Settings, MessageSquare, Home, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import ConversationList from "./ConversationList";
import { Conversation } from "@/types/database";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface AppSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
  agentId?: string;
}

export default function AppSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  agentId,
}: AppSidebarProps) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Sessao encerrada com sucesso.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel sair da sessao.";
      toast.error(message);
    }
  };

  return (
    <aside className="w-64 flex flex-col h-[calc(100vh-2rem)] glass-panel rounded-2xl overflow-hidden relative z-20">
      <div className="p-4 border-b border-white/40 space-y-1">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-arquem.svg" alt="Arquem" className="w-6 h-6 object-contain" />
          <span className="font-semibold">Arquem Analyst</span>
        </Link>
        <p className="text-xs text-muted-foreground truncate" title={user?.email || ""}>
          {user?.email || "Usuario autenticado"}
        </p>
      </div>

      <nav className="p-2 border-b border-white/35">
        <Link
          to="/"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            "hover:bg-white/40"
          )}
        >
          <Home className="w-4 h-4" />
          Home
        </Link>
        <Link
          to="/chat"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            location.pathname.startsWith("/chat")
              ? "bg-primary text-primary-foreground"
              : "hover:bg-white/40"
          )}
        >
          <MessageSquare className="w-4 h-4" />
          Chat {agentId ? "(Agente)" : ""}
        </Link>
        <Link
          to="/admin"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            location.pathname === "/admin"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-white/40"
          )}
        >
          <Settings className="w-4 h-4" />
          Configurações
        </Link>
      </nav>

      <div className="flex-1 overflow-hidden">
        <ConversationList
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          onNew={onNewConversation}
        />
      </div>

      <div className="p-2 border-t border-white/35">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/40"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
