import { Bot, MessageSquare, X } from "lucide-react";
import { Agent } from "@/types/database";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface AgentCardProps {
  agent: Agent;
  onDelete: (id: string) => void;
}

export default function AgentCard({ agent, onDelete }: AgentCardProps) {
  const navigate = useNavigate();

  return (
    <div className="group relative rounded-2xl glass-card glass-hover p-5 flex flex-col items-center text-center">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full glass-subtle text-muted-foreground hover:text-destructive transition-colors"
            onClick={(e) => e.stopPropagation()}
            aria-label="Excluir agente"
          >
            <X className="h-4 w-4" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="glass-panel rounded-2xl border border-white/60">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. O agente sera removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(agent.id);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 mb-3">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold truncate">{agent.name}</h3>
        {agent.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {agent.description}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 w-full">
        <Button
          size="sm"
          className="flex-1 gap-2"
          onClick={() => navigate(`/chat/${agent.id}`)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Iniciar Chat
        </Button>
      </div>
    </div>
  );
}