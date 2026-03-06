import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Home, LogOut, MessageSquare, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { getBillingPlans, getMyProfile, getMyUsageSummary, updateMyProfile, uploadProfileAvatar } from "@/lib/api";
import { BillingPlan, Conversation, UsageSummary, UserProfile } from "@/types/database";
import ConversationList from "./ConversationList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

interface AppSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
  agentId?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function sanitizeFallbackUsername(email: string | undefined): string {
  if (!email) return "usuario";
  const [prefix] = email.split("@");
  const sanitized = prefix.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return sanitized.slice(0, 30) || "usuario";
}

export default function AppSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  agentId,
  isOpen = false,
  onClose,
}: AppSidebarProps) {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isUsageDialogOpen, setIsUsageDialogOpen] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const loadProfileData = useCallback(async () => {
    const [profileResult, usageResult, plansResult] = await Promise.allSettled([
      getMyProfile(),
      getMyUsageSummary(),
      getBillingPlans(),
    ]);

    if (profileResult.status === "fulfilled") {
      setProfile(profileResult.value);
      setDisplayNameInput(profileResult.value.display_name || "");
      setUsernameInput(profileResult.value.username || "");
    } else {
      console.error("Failed to load profile:", profileResult.reason);
      toast.error("Nao foi possivel carregar seu perfil.");
    }

    if (usageResult.status === "fulfilled") {
      setUsageSummary(usageResult.value);
    } else {
      console.error("Failed to load usage summary:", usageResult.reason);
    }

    if (plansResult.status === "fulfilled") {
      setPlans(plansResult.value);
    } else {
      console.error("Failed to load billing plans:", plansResult.reason);
    }

    setIsLoadingProfile(false);
  }, []);

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    const handler = () => {
      void getMyUsageSummary()
        .then((usage) => {
          setUsageSummary(usage);
        })
        .catch((error) => {
          console.error("Failed to refresh usage summary:", error);
        });
    };

    window.addEventListener("billing-usage-updated", handler);
    return () => {
      window.removeEventListener("billing-usage-updated", handler);
    };
  }, []);

  const displayName = useMemo(() => {
    if (profile?.display_name?.trim()) return profile.display_name.trim();
    return user?.email?.split("@")[0] || "Usuario";
  }, [profile?.display_name, user?.email]);

  const username = useMemo(() => {
    if (profile?.username?.trim()) return `@${profile.username.trim()}`;
    return `@${sanitizeFallbackUsername(user?.email)}`;
  }, [profile?.username, user?.email]);

  const avatarFallback = useMemo(() => {
    const normalized = displayName.trim();
    return normalized ? normalized[0].toUpperCase() : "U";
  }, [displayName]);

  const planLabel = usageSummary?.plan_name || profile?.plan?.name || "Plano Teste";
  const usagePercent = Math.max(0, Math.min(100, usageSummary?.usage_percent || 0));

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Sessao encerrada com sucesso.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel sair da sessao.";
      toast.error(message);
    }
  };

  const handleOpenProfileDialog = () => {
    setDisplayNameInput(profile?.display_name || "");
    setUsernameInput(profile?.username || "");
    setIsProfileDialogOpen(true);
  };

  const handleSaveProfile = async () => {
    const normalizedDisplayName = displayNameInput.trim();
    const normalizedUsername = usernameInput.replace(/^@/, "").trim().toLowerCase();

    if (normalizedUsername && !/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      toast.error("Nome de usuario invalido. Use 3-30 caracteres: letras, numeros e _.");
      return;
    }

    setIsSavingProfile(true);
    try {
      const updated = await updateMyProfile({
        display_name: normalizedDisplayName || null,
        username: normalizedUsername || null,
      });

      setProfile(updated);
      setDisplayNameInput(updated.display_name || "");
      setUsernameInput(updated.username || "");
      toast.success("Perfil atualizado com sucesso.");
      setIsProfileDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar o perfil.";
      toast.error(message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const triggerAvatarUpload = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      const updated = await uploadProfileAvatar(file);
      setProfile(updated);
      toast.success("Foto de perfil atualizada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enviar imagem.";
      toast.error(message);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const refreshUsage = async () => {
    try {
      const usage = await getMyUsageSummary();
      setUsageSummary(usage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel carregar o uso.";
      toast.error(message);
    }
  };

  const sidebarContent = (
    <aside className="w-64 flex flex-col h-full glass-panel md:rounded-2xl overflow-hidden relative z-20 bg-background">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/40"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={profile?.avatar_url || ""} alt={displayName} />
                <AvatarFallback>{avatarFallback}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">
                  {isLoadingProfile ? "Carregando..." : displayName}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{planLabel}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem onSelect={handleOpenProfileDialog}>
              <User className="w-4 h-4 mr-2" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setIsUsageDialogOpen(true);
                void refreshUsage();
              }}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Usage
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSignOut()}>
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent className="glass-panel border-white/50 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Perfil</DialogTitle>
            <DialogDescription>
              Atualize sua foto, nome de exibicao e nome de usuario.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14">
                <AvatarImage src={profile?.avatar_url || ""} alt={displayName} />
                <AvatarFallback>{avatarFallback}</AvatarFallback>
              </Avatar>
              <Button
                type="button"
                variant="outline"
                onClick={triggerAvatarUpload}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar ? "Enviando..." : "Trocar foto"}
              </Button>
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-display-name" className="text-sm font-medium">
                Nome de exibicao
              </label>
              <Input
                id="profile-display-name"
                value={displayNameInput}
                onChange={(event) => setDisplayNameInput(event.target.value)}
                placeholder="Seu nome de exibicao"
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-username" className="text-sm font-medium">
                Nome de usuario
              </label>
              <Input
                id="profile-username"
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="usuario_exemplo"
                maxLength={30}
              />
              <p className="text-xs text-muted-foreground">
                Use 3-30 caracteres: letras minusculas, numeros e underscore.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsProfileDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleSaveProfile()} disabled={isSavingProfile}>
              {isSavingProfile ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isUsageDialogOpen} onOpenChange={setIsUsageDialogOpen}>
        <DialogContent className="glass-panel border-white/50 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Usage</DialogTitle>
            <DialogDescription>
              Acompanhe seu consumo do ciclo mensal corrido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Limite de uso mensal</span>
                <span>{usagePercent.toFixed(2)}%</span>
              </div>
              <Progress value={usagePercent} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="glass-subtle rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Creditos usados</p>
                <p className="font-semibold">{formatInteger(usageSummary?.credits_used || 0)}</p>
              </div>
              <div className="glass-subtle rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Creditos disponiveis</p>
                <p className="font-semibold">{formatInteger(usageSummary?.remaining_credits || 0)}</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Limite do plano: {formatInteger(usageSummary?.monthly_credit_limit || 0)} creditos
              </p>
              <p>Proximo reset: {formatDateTime(usageSummary?.cycle_end_at || "")}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Planos</p>
              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                {plans.map((plan) => {
                  const isCurrent = usageSummary?.plan_id === plan.id;
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "rounded-lg border p-3 text-sm",
                        isCurrent ? "border-primary bg-primary/10" : "border-white/40 bg-white/20"
                      )}
                    >
                      <p className="font-medium">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatInteger(plan.monthly_credit_limit)} creditos por ciclo
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsUsageDialogOpen(false)}>
              Fechar
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleSignOut()}>
              Sair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleAvatarChange(event)}
      />
    </aside>
  );

  return (
    <>
      {/* Desktop: sidebar fixa */}
      <div className="hidden md:flex h-[calc(100vh-2rem)]">
        {sidebarContent}
      </div>

      {/* Mobile: drawer overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="relative h-full w-72 max-w-[85vw] animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
