import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLLMSettings } from "@/hooks/useLLMSettings";
import { useMetadata } from "@/hooks/useMetadata";
import { OPENAI_MODELS, GOOGLE_MODELS } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Save, Database, Key, Plug, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const formSchema = z.object({
  provider: z.enum(["openai", "google"]),
  model: z.string().min(1, "Selecione um modelo"),
  api_key: z.string().min(1, "API Key é obrigatória"),
});

type FormValues = z.infer<typeof formSchema>;

export default function Admin() {
  const navigate = useNavigate();
  const { settings, isLoading: settingsLoading, saveSettings, isSaving } = useLLMSettings();
  const { metadata, isLoading: metadataLoading, refresh, isRefreshing, groupedMetadata, refreshExternal, externalMetadata, externalGroupedMetadata } = useMetadata();
  
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [isLoadingExternal, setIsLoadingExternal] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: "openai",
      model: "",
      api_key: "",
    },
  });

  const selectedProvider = form.watch("provider");

  useEffect(() => {
    if (settings) {
      form.setValue("provider", settings.provider as "openai" | "google");
      form.setValue("model", settings.model);
      form.setValue("api_key", settings.api_key);
    }
  }, [settings, form]);

  useEffect(() => {
    form.setValue("model", "");
  }, [selectedProvider, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await saveSettings({
        provider: values.provider,
        model: values.model,
        api_key: values.api_key,
      });
      toast.success("Configurações salvas com sucesso!");
    } catch (error) {
      toast.error("Erro ao salvar configurações");
    }
  };

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
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ action: "test-connection" }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setConnectionStatus("success");
        setConnectionMessage(data.message);
        toast.success("Conexão estabelecida!");
      } else {
        setConnectionStatus("error");
        setConnectionMessage(data.error || "Falha na conexão");
        toast.error(data.error || "Falha na conexão");
      }
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage("Erro ao testar conexão");
      toast.error("Erro ao testar conexão");
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

  const models = selectedProvider === "openai" ? OPENAI_MODELS : GOOGLE_MODELS;

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
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
              Configure o provedor de LLM e gerencie os metadados do banco de dados.
            </p>
          </div>
        </div>

        <Tabs defaultValue="llm" className="space-y-4">
          <TabsList>
            <TabsTrigger value="llm" className="gap-2">
              <Key className="w-4 h-4" />
              LLM
            </TabsTrigger>
            <TabsTrigger value="external" className="gap-2">
              <Plug className="w-4 h-4" />
              Banco Externo
            </TabsTrigger>
            <TabsTrigger value="metadata" className="gap-2">
              <Database className="w-4 h-4" />
              Metadados
            </TabsTrigger>
          </TabsList>

          <TabsContent value="llm">
            <Card>
              <CardHeader>
                <CardTitle>Configuração do LLM</CardTitle>
                <CardDescription>
                  Configure as credenciais do provedor de linguagem.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="provider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Provedor</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione o provedor" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="openai">OpenAI</SelectItem>
                              <SelectItem value="google">Google (Gemini)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="model"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Modelo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione o modelo" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {models.map((model) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="api_key"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Key</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="sk-..."
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Sua chave de API do provedor selecionado.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" disabled={isSaving}>
                      <Save className="w-4 h-4 mr-2" />
                      {isSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

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
                                  className="border rounded-lg p-4 bg-muted/30"
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
                              className="border rounded-lg p-4 bg-muted/30"
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
        </Tabs>
      </div>
    </div>
  );
}
