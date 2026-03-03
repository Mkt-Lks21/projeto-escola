import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Database, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const signInSchema = z.object({
  email: z.string().email("Informe um email valido."),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres."),
});

const signUpSchema = z
  .object({
    email: z.string().email("Informe um email valido."),
    password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres."),
    confirmPassword: z.string().min(6, "Confirme sua senha."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "As senhas nao conferem.",
    path: ["confirmPassword"],
  });

type SignInFormValues = z.infer<typeof signInSchema>;
type SignUpFormValues = z.infer<typeof signUpSchema>;

function resolveNextPath(search: string): string {
  const params = new URLSearchParams(search);
  const next = params.get("next");

  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = resolveNextPath(location.search);
  const { signIn, signUp } = useAuth();
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");
  const [isSubmittingSignIn, setIsSubmittingSignIn] = useState(false);
  const [isSubmittingSignUp, setIsSubmittingSignUp] = useState(false);

  const signInForm = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const signUpForm = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleSignIn = async (values: SignInFormValues) => {
    setIsSubmittingSignIn(true);
    try {
      await signIn(values.email, values.password);
      toast.success("Login realizado com sucesso.");
      navigate(nextPath, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel entrar.";
      toast.error(message);
    } finally {
      setIsSubmittingSignIn(false);
    }
  };

  const handleSignUp = async (values: SignUpFormValues) => {
    setIsSubmittingSignUp(true);
    try {
      const result = await signUp(values.email, values.password);
      if (result.requiresEmailConfirmation) {
        toast.success("Conta criada. Confirme seu email para continuar.");
        setActiveTab("signin");
        signInForm.setValue("email", values.email);
        signInForm.setValue("password", values.password);
      } else {
        toast.success("Conta criada e autenticada com sucesso.");
        navigate(nextPath, { replace: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel criar a conta.";
      toast.error(message);
    } finally {
      setIsSubmittingSignUp(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative z-10 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
          <Database className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Arquem Analyst</h1>
            <p className="text-xs text-muted-foreground">Acesse sua conta para continuar</p>
          </div>
        </div>

        <Card className="glass-card border-white/45">
          <CardHeader>
            <CardTitle>Autenticacao</CardTitle>
            <CardDescription>Entre na sua conta ou crie um novo usuario.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "signin" | "signup")}>
              <TabsList className="grid grid-cols-2 w-full glass-subtle">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-4">
                <Form {...signInForm}>
                  <form className="space-y-4" onSubmit={signInForm.handleSubmit(handleSignIn)}>
                    <FormField
                      control={signInForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="voce@empresa.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={signInForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="current-password" placeholder="******" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="w-full" disabled={isSubmittingSignIn}>
                      <LogIn className="w-4 h-4 mr-2" />
                      {isSubmittingSignIn ? "Entrando..." : "Entrar"}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="signup" className="mt-4">
                <Form {...signUpForm}>
                  <form className="space-y-4" onSubmit={signUpForm.handleSubmit(handleSignUp)}>
                    <FormField
                      control={signUpForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="voce@empresa.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={signUpForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="new-password" placeholder="******" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={signUpForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirmar senha</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="new-password" placeholder="******" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="w-full" disabled={isSubmittingSignUp}>
                      <UserPlus className="w-4 h-4 mr-2" />
                      {isSubmittingSignUp ? "Criando..." : "Criar conta"}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="underline hover:text-foreground">
            Voltar para o inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
