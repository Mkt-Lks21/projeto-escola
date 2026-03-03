import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

interface PublicOnlyRouteProps {
  children?: ReactNode;
}

function resolveNextPath(search: string): string {
  const params = new URLSearchParams(search);
  const next = params.get("next");

  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

export default function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const { session, isAuthLoading } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative z-10">
        <div className="glass-card rounded-2xl px-5 py-3 text-sm text-muted-foreground">Carregando sessao...</div>
      </div>
    );
  }

  if (session) {
    return <Navigate to={resolveNextPath(location.search)} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
