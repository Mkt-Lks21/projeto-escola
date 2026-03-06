import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Database, LogIn, UserPlus, Eye, EyeOff } from "lucide-react";
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

const recoverSchema = z.object({
  email: z.string().email("Informe um email valido."),
});
type RecoverFormValues = z.infer<typeof recoverSchema>;

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
  const { signIn, signUp, resetPassword } = useAuth();
  const [activeTab, setActiveTab] = useState<"signin" | "signup" | "recover">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmittingSignIn, setIsSubmittingSignIn] = useState(false);
  const [isSubmittingSignUp, setIsSubmittingSignUp] = useState(false);
  const [isSubmittingRecover, setIsSubmittingRecover] = useState(false);

  const recoverForm = useForm<RecoverFormValues>({
    resolver: zodResolver(recoverSchema),
    defaultValues: { email: "" },
  });

  const handleRecover = async (values: RecoverFormValues) => {
    setIsSubmittingRecover(true);
    try {
      await resetPassword(values.email);
      toast.success("Se o email estiver cadastrado, um link de recuperação foi enviado.");
      setActiveTab("signin");
    } catch (error) {
      toast.error("Erro ao solicitar recuperação de senha.");
    } finally {
      setIsSubmittingRecover(false);
    }
  };

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
        <div className="flex justify-center mb-4">
          <img src="/logo-arquem.svg" alt="Arquem Logo" className="h-[100px] object-contain flex-shrink-0" />
        </div>

        <Card className="glass-card border-white/45">
          <CardHeader>
            <CardTitle>Autenticacao</CardTitle>
            <CardDescription>Entre na sua conta ou crie um novo usuario.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "signin" | "signup" | "recover")}>
              {activeTab !== "recover" && (
                <TabsList className="grid grid-cols-2 w-full glass-subtle">
                  <TabsTrigger value="signin">Entrar</TabsTrigger>
                  <TabsTrigger value="signup">Criar conta</TabsTrigger>
                </TabsList>
              )}

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
                            <div className="flex flex-col">
                              <div className="relative">
                                <Input type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="******" {...field} />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                  onClick={() => setShowPassword(!showPassword)}
                                >
                                  {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                                </Button>
                              </div>
                              <Button type="button" variant="link" className="p-0 h-auto text-xs font-normal text-muted-foreground hover:text-primary self-start mt-2" onClick={() => setActiveTab("recover")}>
                                Esqueceu a senha?
                              </Button>
                            </div>
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
                            <div className="relative">
                              <Input type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="******" {...field} />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                              </Button>
                            </div>
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
                            <div className="relative">
                              <Input type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="******" {...field} />
                            </div>
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

              <TabsContent value="recover" className="mt-4">
                <div className="mb-4 text-center">
                  <h3 className="text-lg font-medium">Recuperar senha</h3>
                  <p className="text-sm text-muted-foreground">Enviaremos um link para redefinir sua senha.</p>
                </div>
                <Form {...recoverForm}>
                  <form className="space-y-4" onSubmit={recoverForm.handleSubmit(handleRecover)}>
                    <FormField
                      control={recoverForm.control}
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
                    <div className="flex flex-col gap-2 pt-2">
                      <Button type="submit" className="w-full" disabled={isSubmittingRecover}>
                        {isSubmittingRecover ? "Enviando..." : "Enviar link"}
                      </Button>
                      <Button type="button" variant="ghost" className="w-full" onClick={() => setActiveTab("signin")}>
                        Voltar para o login
                      </Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
