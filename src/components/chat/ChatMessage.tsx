import { useState, useEffect, useRef } from "react";
import { Message } from "@/types/database";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Copy, Check, User, Bot, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface ChatMessageProps {
  message: Message;
  onExecuteQuery: (query: string) => Promise<any[]>;
}

export default function ChatMessage({ message, onExecuteQuery }: ChatMessageProps) {
  const [executingQueries, setExecutingQueries] = useState<Record<string, boolean>>({});
  const [queryResults, setQueryResults] = useState<Record<string, any[]>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [autoExecuted, setAutoExecuted] = useState<Set<string>>(new Set());
  const executingRef = useRef<Set<string>>(new Set());

  const isUser = message.role === "user";

  // Check for [AUTO_EXECUTE] tag and execute queries automatically
  useEffect(() => {
    if (isUser || !message.content) return;

    const autoExecutePattern = /\[AUTO_EXECUTE\]\s*```sql\s*([\s\S]*?)```/gi;
    let match;
    let index = 0;

    while ((match = autoExecutePattern.exec(message.content)) !== null) {
      const query = match[1].trim().replace(/;+\s*$/, "");
      const key = `${message.id}-auto-${index}`;
      
      // Skip if already executed or currently executing
      if (autoExecuted.has(key) || executingRef.current.has(key)) {
        index++;
        continue;
      }

      // Mark as executing to prevent duplicates
      executingRef.current.add(key);
      
      // Execute the query
      (async () => {
        setExecutingQueries((prev) => ({ ...prev, [key]: true }));
        try {
          const results = await onExecuteQuery(query);
          setQueryResults((prev) => ({ ...prev, [key]: results }));
          setAutoExecuted((prev) => new Set(prev).add(key));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Erro ao executar query");
        } finally {
          setExecutingQueries((prev) => ({ ...prev, [key]: false }));
          executingRef.current.delete(key);
        }
      })();
      
      index++;
    }
  }, [message.content, message.id, isUser, onExecuteQuery, autoExecuted]);

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success("Código copiado!");
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleExecute = async (code: string, index: number) => {
    const key = `${message.id}-${index}`;
    const sanitizedCode = code.trim().replace(/;+\s*$/, "");
    setExecutingQueries((prev) => ({ ...prev, [key]: true }));

    try {
      const results = await onExecuteQuery(sanitizedCode);
      setQueryResults((prev) => ({ ...prev, [key]: results }));
      toast.success("Query executada com sucesso!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao executar query");
    } finally {
      setExecutingQueries((prev) => ({ ...prev, [key]: false }));
    }
  };

  const renderResults = (key: string) => {
    const results = queryResults[key];
    if (!results || results.length === 0) {
      if (queryResults[key] !== undefined) {
        return (
          <div className="mt-2 p-3 border rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">Nenhum resultado encontrado.</p>
          </div>
        );
      }
      return null;
    }

    const columns = Object.keys(results[0]);

    return (
      <div className="mt-2 border rounded-lg overflow-hidden">
        <div className="max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="text-xs">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.slice(0, 100).map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col} className="text-xs py-1">
                      {String(row[col] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {results.length > 100 && (
          <p className="text-xs text-muted-foreground p-2 border-t">
            Mostrando 100 de {results.length} resultados
          </p>
        )}
      </div>
    );
  };

  // Process content to handle [AUTO_EXECUTE] tags
  const processedContent = message.content.replace(/\[AUTO_EXECUTE\]\s*/gi, "");
  
  let codeBlockIndex = 0;
  let autoExecuteIndex = 0;

  // Check if content has auto-execute queries
  const hasAutoExecute = /\[AUTO_EXECUTE\]/gi.test(message.content);

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-lg",
        isUser ? "bg-muted/50" : "bg-background"
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary"
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0 prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const language = match ? match[1] : "";
              const code = String(children).replace(/\n$/, "");
              const isSQL = language.toLowerCase() === "sql";
              const currentIndex = codeBlockIndex++;
              
              // Use different key for auto-executed queries
              const key = hasAutoExecute && isSQL 
                ? `${message.id}-auto-${autoExecuteIndex++}` 
                : `${message.id}-${currentIndex}`;
              
              const isExecuting = executingQueries[key];

              if (match) {
                return (
                  <div className="relative group">
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {isSQL && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          onClick={() => handleExecute(code, currentIndex)}
                          disabled={isExecuting}
                        >
                          {isExecuting ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                          ) : (
                            <Play className="w-3 h-3 mr-1" />
                          )}
                          {queryResults[key] ? "Re-executar" : "Executar"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        onClick={() => handleCopy(code)}
                      >
                        {copiedCode === code ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                    {isExecuting && (
                      <div className="absolute inset-0 bg-background/50 rounded-lg flex items-center justify-center z-20">
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Executando query...
                        </div>
                      </div>
                    )}
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={language}
                      PreTag="div"
                      className="rounded-lg !mt-0"
                    >
                      {code}
                    </SyntaxHighlighter>
                    {renderResults(key)}
                  </div>
                );
              }

              return (
                <code className={cn("bg-muted px-1 py-0.5 rounded", className)} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
