import { Conversation } from "@/types/database";
import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ConversationListProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function ConversationList({
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  onNew,
}: ConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <Button onClick={onNew} className="w-full" variant="outline">
          <Plus className="w-4 h-4 mr-2" />
          Nova Conversa
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma conversa ainda
          </p>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-accent transition-colors",
                currentConversationId === conversation.id && "bg-accent"
              )}
              onClick={() => onSelect(conversation.id)}
            >
              <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{conversation.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(conversation.updated_at), {
                    addSuffix: true,
                    locale: ptBR,
                  })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conversation.id);
                }}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
