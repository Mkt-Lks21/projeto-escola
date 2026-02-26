import { Bot, Trash2, MessageSquare } from "lucide-react";
import { Agent } from "@/types/database";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface AgentCardProps {
  agent: Agent;
  onDelete: (id: string) => void;
}

export default function AgentCard({ agent, onDelete }: AgentCardProps) {
  const navigate = useNavigate();

  return (
    <div className="group relative rounded-xl border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{agent.name}</h3>
          {agent.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {agent.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1 gap-2"
          onClick={() => navigate(`/chat/${agent.id}`)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Iniciar Chat
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(agent.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
