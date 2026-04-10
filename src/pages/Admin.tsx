import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyFrontendErrorLogs, testExternalConnection } from "@/lib/api";
import { useMetadata } from "@/hooks/useMetadata";
import { FrontendErrorLog } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Database, Plug, CheckCircle2, XCircle, ArrowLeft, Bug } from "lucide-react";
import { toast } from "sonner";

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

export default function Admin() {
  const navigate = useNavigate();
  const { metadata, isLoading: metadataLoading, refresh, isRefreshing, groupedMetadata, refreshExternal, externalGroupedMetadata } = useMetadata();

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [isLoadingExternal, setIsLoadingExternal] = useState(false);
  const [frontendLogs, setFrontendLogs] = useState<FrontendErrorLog[]>([]);
  const [isLoadingFrontendLogs, setIsLoadingFrontendLogs] = useState(true);

  const loadFrontendLogs = async () => {
    setIsLoadingFrontendLogs(true);

    try {
      const data = await getMyFrontendErrorLogs(50);
      setFrontendLogs(data);
    } catch (error) {
      toast.error("Nao foi possivel carregar os logs do frontend.");
    } finally {
      setIsLoadingFrontendLogs(false);
    }
  };

  useEffect(() => {
    void loadFrontendLogs();
  }, []);

  const handleRefreshMetadata = async () => {
    try {
      await refresh();
      toast.success("Metadados atualizados com sucesso!");
    } catch (error) {
      toast.error("Erro ao atualizar metadados");
    }
  };

  const handleTestConnection = async () => {
    setConnectionStatus("testing");
    setConnectionMessage("");

    try {
      const data = await testExternalConnection();

      if (data.success) {
        setConnectionStatus("success");
        setConnectionMessage(data.message || "Conexao estabelecida!");
        toast.success("Conexao estabelecida!");
      } else {
        setConnectionStatus("error");
        setConnectionMessage(data.error || "Falha na conexao");
        toast.error(data.error || "Falha na conexao");
      }
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage("Erro ao testar conexao");
      toast.error("Erro ao testar conexao");
    }
  };

  const handleRefreshExternalMetadata = async () => {
    setIsLoadingExternal(true);
    try {
      await refreshExternal();
      toast.success("Metadados externos atualizados!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao buscar metadados externos");
    } finally {
      setIsLoadingExternal(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto relative z-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4 glass-panel rounded-2xl p-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Configurações</h1>
            <p className="text-muted-foreground">
              Gerencie os metadados do banco de dados supabase externo.
            </p>
          </div>
        </div>

        <Tabs defaultValue="external" className="space-y-4">
          <TabsList className="glass-subtle rounded-2xl p-1">
            <TabsTrigger value="external" className="gap-2">
              <Plug className="w-4 h-4" />
              Banco Externo
            </TabsTrigger>
            <TabsTrigger value="metadata" className="gap-2">
              <Database className="w-4 h-4" />
              Metadados
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-2">
              <Bug className="w-4 h-4" />
              Logs Frontend
            </TabsTrigger>
          </TabsList>

          <TabsContent value="external">
            <Card>
              <CardHeader>
                <CardTitle>Banco de Dados Externo</CardTitle>
                <CardDescription>
                  Conecte a um banco de dados Supabase externo para análise.
                  <br />
                  <span className="text-xs text-muted-foreground">
                    Configure os secrets EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_KEY nas configurações do projeto.
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={connectionStatus === "testing"}
                  >
                    {connectionStatus === "testing" ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plug className="w-4 h-4 mr-2" />
                    )}
                    Testar Conexão
                  </Button>

                  {connectionStatus === "success" && (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="text-sm">{connectionMessage}</span>
                    </div>
                  )}

                  {connectionStatus === "error" && (
                    <div className="flex items-center gap-2 text-red-600">
                      <XCircle className="w-5 h-5" />
                      <span className="text-sm">{connectionMessage}</span>
                    </div>
                  )}
                </div>

                {connectionStatus === "success" && (
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">Metadados do Banco Externo</h4>
                        <p className="text-sm text-muted-foreground">
                          Carregue a estrutura das tabelas do banco externo.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleRefreshExternalMetadata}
                        disabled={isLoadingExternal}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingExternal ? "animate-spin" : ""}`} />
                        Carregar Metadados
                      </Button>
                    </div>

                    {Object.keys(externalGroupedMetadata).length > 0 && (
                      <div className="space-y-4 mt-4">
                        {Object.entries(externalGroupedMetadata).map(([schema, tables]) => (
                          <div key={schema}>
                            <h3 className="text-lg font-semibold mb-2">
                              Schema: {schema}
                            </h3>
                            <div className="space-y-4">
                              {Object.entries(tables).map(([table, columns]) => (
                                <div
                                  key={table}
                                  className="rounded-2xl glass-subtle p-4"
                                >
                                  <h4 className="font-medium mb-2">{table}</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {columns.map((col) => (
                                      <Badge
                                        key={col.column_name}
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {col.column_name}{" "}
                                        <span className="text-muted-foreground ml-1">
                                          ({col.data_type})
                                        </span>
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metadata">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Metadados do Supabase Externo (public)</CardTitle>
                    <CardDescription>
                      Estrutura das tabelas disponíveis para análise no Supabase externo (schema public).
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleRefreshMetadata}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {metadataLoading ? (
                  <p className="text-muted-foreground">Carregando metadados...</p>
                ) : Object.keys(groupedMetadata).length === 0 ? (
                  <p className="text-muted-foreground">
                    Nenhum metadado encontrado. Clique em "Atualizar" para carregar.
                  </p>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedMetadata).map(([schema, tables]) => (
                      <div key={schema}>
                        <h3 className="text-lg font-semibold mb-2">
                          Schema: {schema}
                        </h3>
                        <div className="space-y-4">
                          {Object.entries(tables).map(([table, columns]) => (
                            <div
                              key={table}
                              className="rounded-2xl glass-subtle p-4"
                            >
                              <h4 className="font-medium mb-2">{table}</h4>
                              <div className="flex flex-wrap gap-2">
                                {columns.map((col) => (
                                  <Badge
                                    key={col.column_name}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {col.column_name}{" "}
                                    <span className="text-muted-foreground ml-1">
                                      ({col.data_type})
                                    </span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="diagnostics">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>Logs do Frontend</CardTitle>
                    <CardDescription>
                      Eventos capturados no navegador do usuario e sincronizados no Supabase.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void loadFrontendLogs()}
                    disabled={isLoadingFrontendLogs}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingFrontendLogs ? "animate-spin" : ""}`} />
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingFrontendLogs ? (
                  <p className="text-muted-foreground">Carregando logs do frontend...</p>
                ) : frontendLogs.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nenhum log sincronizado ainda. Quando um erro ocorrer no navegador, ele aparecera aqui.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {frontendLogs.map((log) => (
                      <div key={log.id} className="rounded-2xl glass-subtle p-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{log.category}</Badge>
                          {log.stage && <Badge variant="outline">{log.stage}</Badge>}
                          {log.code && <Badge variant="destructive">{log.code}</Badge>}
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(log.created_at)}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <p className="font-medium break-words">{log.message}</p>
                          {log.pathname && (
                            <p className="text-sm text-muted-foreground break-all">
                              Rota: {log.pathname}
                            </p>
                          )}
                          {log.conversation_id && (
                            <p className="text-sm text-muted-foreground break-all">
                              Conversa: {log.conversation_id}
                            </p>
                          )}
                        </div>

                        {log.user_agent && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">User Agent</p>
                            <div className="rounded-xl bg-background/70 px-3 py-2 text-xs break-all">
                              {log.user_agent}
                            </div>
                          </div>
                        )}

                        {Object.keys(log.metadata || {}).length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Metadata</p>
                            <pre className="rounded-xl bg-background/70 px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}



