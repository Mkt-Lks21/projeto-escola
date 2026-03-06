import { Menu, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileHeaderProps {
    onOpenSidebar: () => void;
    onNewConversation: () => void;
}

export default function MobileHeader({ onOpenSidebar, onNewConversation }: MobileHeaderProps) {
    return (
        <header
            className="flex md:hidden items-center justify-between px-3 py-2 border-b border-white/20 bg-background/80 backdrop-blur-sm"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 8px) + 8px)" }}
        >
            <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={onOpenSidebar}
                aria-label="Abrir menu"
            >
                <Menu className="h-5 w-5" />
            </Button>

            <img
                src="/logo-arquem.svg"
                alt="Arquem"
                className="h-7 object-contain"
            />

            <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={onNewConversation}
                aria-label="Nova conversa"
            >
                <SquarePen className="h-5 w-5" />
            </Button>
        </header>
    );
}
