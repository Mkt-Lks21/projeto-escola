import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  sqlDebugEnabled?: boolean;
  onSqlDebugChange?: (value: boolean) => void;
}

export default function ChatInput({
  onSend,
  isLoading,
  sqlDebugEnabled = false,
  onSqlDebugChange,
}: ChatInputProps) {
  const MAX_INPUT_LENGTH = 4000;
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevIsLoadingRef = useRef(isLoading);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;

    if (!wasLoading || isLoading) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      if (activeElement.closest('[role="dialog"]')) return;

      const tagName = activeElement.tagName;
      const isAnotherTextField =
        tagName === "INPUT" || tagName === "TEXTAREA" || activeElement.isContentEditable;
      if (isAnotherTextField) return;
    }

    textareaRef.current?.focus({ preventScroll: true });
  }, [isLoading]);

  const sanitizeUserInput = (value: string): string => {
    // Remove invisible control chars often used in injection obfuscation.
    const filtered = Array.from(value)
      .filter((char) => {
        const code = char.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) return false;
        if (code === 127) return false;
        if ((code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff) return false;
        return true;
      })
      .join("");
    return filtered.slice(0, MAX_INPUT_LENGTH);
  };

  const handleSend = () => {
    const sanitized = sanitizeUserInput(input).trim();
    if (sanitized && !isLoading) {
      onSend(sanitized);
      setInput("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 pointer-events-none px-2 sm:px-3 md:px-6 pt-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 12px) + 12px)" }}
    >
      <div
        className="pointer-events-auto w-full max-w-4xl mx-auto space-y-2 glass-subtle rounded-2xl p-3 shadow-[0_18px_45px_rgba(0,0,0,0.14)] border border-white/45"
        data-testid="chat-input-column"
      >
        {onSqlDebugChange && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Switch checked={sqlDebugEnabled} onCheckedChange={onSqlDebugChange} />
              <span>Mostrar SQL</span>
            </label>
            {sqlDebugEnabled && <span>Somente leitura</span>}
          </div>
        )}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(sanitizeUserInput(e.target.value))}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte algo..."
            className="min-h-[44px] md:min-h-[48px] max-h-[200px] resize-none bg-transparent border-white/40 pr-14 text-base md:text-sm"
            disabled={isLoading}
            maxLength={MAX_INPUT_LENGTH}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="absolute right-1.5 bottom-1.5 h-[36px] w-[36px]"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
