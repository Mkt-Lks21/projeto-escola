import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Send, Square } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  onSendAudio: (audio: Blob) => Promise<void> | void;
  isLoading: boolean;
}

type AudioState = "idle" | "recording" | "transcribing";

export default function ChatInput({ onSend, onSendAudio, isLoading }: ChatInputProps) {
  const MAX_INPUT_LENGTH = 4000;
  const [input, setInput] = useState("");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevIsLoadingRef = useRef(isLoading);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pendingAudioSendRef = useRef<Promise<void> | null>(null);

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

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    };
  }, []);

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
    if (sanitized && !isLoading && audioState === "idle") {
      onSend(sanitized);
      setInput("");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const startRecording = async () => {
    if (isLoading || audioState !== "idle") return;

    setAudioError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
      const selectedMimeType = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
      const recorder = new MediaRecorder(stream, selectedMimeType ? { mimeType: selectedMimeType } : undefined);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      setAudioState("recording");

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setAudioState("idle");
        setAudioError("Nao foi possivel gravar o audio.");
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        const mimeType = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: mimeType });

        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;

        if (!audioBlob.size) {
          setAudioState("idle");
          setAudioError("Nenhum audio foi capturado.");
          return;
        }

        setAudioState("transcribing");
        const sendPromise = Promise.resolve(onSendAudio(audioBlob));
        pendingAudioSendRef.current = sendPromise;
        try {
          await sendPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao transcrever o audio.";
          setAudioError(message);
        } finally {
          if (pendingAudioSendRef.current === sendPromise) {
            pendingAudioSendRef.current = null;
          }
          setAudioState("idle");
        }
      };

      recorder.start();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Permissao de microfone negada."
          : "Nao foi possivel acessar o microfone.";
      setAudioError(message);
      setAudioState("idle");
    }
  };

  const handleAudioButtonClick = () => {
    if (audioState === "recording") {
      stopRecording();
      return;
    }

    if (audioState === "idle") {
      void startRecording();
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
        {audioState !== "idle" && (
          <p className="text-xs text-muted-foreground">
            {audioState === "recording"
              ? "Gravando audio... clique no microfone para parar."
              : "Transcrevendo audio..."}
          </p>
        )}
        {audioError && <p className="text-xs text-destructive">{audioError}</p>}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(sanitizeUserInput(e.target.value))}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte algo..."
            className="min-h-[44px] md:min-h-[48px] max-h-[200px] resize-none bg-transparent border-white/40 pr-28 text-base md:text-sm"
            disabled={isLoading || audioState !== "idle"}
            maxLength={MAX_INPUT_LENGTH}
          />
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            <Button
              type="button"
              onClick={handleAudioButtonClick}
              disabled={isLoading}
              size="icon"
              variant={audioState === "recording" ? "destructive" : "secondary"}
              className="h-[36px] w-[36px]"
              title={audioState === "recording" ? "Parar gravacao" : "Gravar audio"}
            >
              {audioState === "recording" ? (
                <Square className="w-4 h-4" />
              ) : audioState === "transcribing" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || audioState !== "idle"}
              size="icon"
              className="h-[36px] w-[36px]"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
