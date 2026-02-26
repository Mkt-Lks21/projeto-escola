import { Link, useLocation } from "react-router-dom";
import { Database, Settings, MessageSquare, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import ConversationList from "./ConversationList";
import { Conversation } from "@/types/database";

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

  return (
    <aside className="w-64 border-r bg-card flex flex-col h-screen">
      <div className="p-4 border-b">
        <Link to="/" className="flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          <span className="font-semibold">DB Analyst</span>
        </Link>
      </div>

      <nav className="p-2 border-b">
        <Link
          to="/"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            "hover:bg-accent"
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
              : "hover:bg-accent"
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
              : "hover:bg-accent"
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
    </aside>
  );
}
