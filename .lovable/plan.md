# Plano: Sistema de Agentes Especialistas com Prompt Customizavel

## Visao Geral

Criar um sistema completo de agentes especialistas onde o usuario (dono de empresa) pode criar agentes vinculados a tabelas especificas e definir um prompt personalizado que orienta o comportamento do agente. Se nenhum prompt for definido, um prompt padrao robusto sera usado.

## Banco de Dados

### Tabela `agents`


| Coluna        | Tipo        | Descricao                                                  |
| ------------- | ----------- | ---------------------------------------------------------- |
| id            | uuid (PK)   | Identificador unico                                        |
| name          | text        | Nome do agente (ex: "Analista Financeiro")                 |
| description   | text        | Descricao opcional                                         |
| system_prompt | text        | Instrucoes personalizadas (nullable - usa padrao se vazio) |
| created_at    | timestamptz | Data de criacao                                            |
| updated_at    | timestamptz | Data de atualizacao                                        |


### Tabela `agent_tables`


| Coluna      | Tipo                                   | Descricao            |
| ----------- | -------------------------------------- | -------------------- |
| id          | uuid (PK)                              | Identificador unico  |
| agent_id    | uuid (FK -> agents, ON DELETE CASCADE) | Referencia ao agente |
| schema_name | text                                   | Schema da tabela     |
| table_name  | text                                   | Nome da tabela       |
| created_at  | timestamptz                            | Data de criacao      |


### Alteracao em `conversations`

Adicionar coluna `agent_id uuid REFERENCES agents(id) ON DELETE SET NULL` (nullable).

RLS: Politicas publicas em todas as tabelas (consistente com o sistema atual sem autenticacao).

## Prompt Padrao do Agente

Quando o campo `system_prompt` estiver vazio, o agente usara este prompt padrao inteligente:

```
Voce e {nome_do_agente}, um assistente de inteligencia de negocios especializado
nas areas: {lista_de_tabelas}.

Seu papel e atuar como um analista senior dedicado ao negocio do usuario.
Voce deve:
- Responder com profundidade e contexto de negocio, nao apenas dados brutos
- Ao apresentar resultados, sempre interpretar o que os numeros significam
  para o negocio (tendencias, alertas, oportunidades)
- Sugerir proativamente analises complementares relevantes
- Usar linguagem profissional mas acessivel
- Quando o usuario perguntar algo generico, direcionar para as tabelas
  que voce domina e oferecer opcoes de analise

Voce so tem acesso as seguintes tabelas: {tabelas_detalhadas}
Gere queries APENAS sobre essas tabelas.
```

Quando o usuario definir um `system_prompt` personalizado, esse texto **substitui** apenas a secao de comportamento, mantendo as instrucoes tecnicas (AUTO_EXECUTE, sem ponto e virgula, etc.) intactas.

## Nova Interface: Home Page

A rota `/` exibe uma tela limpa (sem sidebar) com:

- Titulo "DB Analyst"
- Dois cards grandes lado a lado:
  - **Novo Chat**: Icone MessageSquare, abre `/chat` (chat livre como hoje)
  - **Criar Agente**: Icone Bot, abre `/agents/new`
- Secao "Meus Agentes" abaixo com cards dos agentes existentes. Ao clicar, abre `/chat/:agentId`
- Link discreto para Configuracoes no canto

## Paginas e Componentes

### `src/pages/Home.tsx` (nova)

Tela inicial com cards e lista de agentes.

### `src/pages/Chat.tsx` (baseado no Index.tsx atual)

Chat em `/chat` (livre) e `/chat/:agentId` (com agente). Quando tem agentId:

- Carrega agente e suas tabelas
- Passa agentId na criacao de conversas e no envio de mensagens

### `src/pages/AgentCreate.tsx` (nova)

Formulario:

- Nome do agente (obrigatorio)
- Descricao (opcional)
- Prompt personalizado (textarea grande, com placeholder mostrando exemplo, opcional)
- Seletor de tabelas via checkboxes (carregado do metadata cache) *importante ele também deve guardar as tabelas na memória para saber utilizar corretamente.

### `src/pages/AgentDetail.tsx` (nova)

Visualizar agente com opcoes de editar, excluir, ou iniciar chat.

### `src/components/home/AgentCard.tsx` (novo)

Card reutilizavel para listar agentes na home.

## Alteracoes no Backend (Edge Function `chat`)

O body da requisicao passa a aceitar `agentId` opcional. Quando presente:

1. Busca o agente e suas tabelas na base
2. Se o agente tem `system_prompt`, usa como base de comportamento
3. Se nao tem, usa o prompt padrao com nome e tabelas
4. Filtra os metadados para incluir APENAS as tabelas do agente
5. Concatena as instrucoes tecnicas (AUTO_EXECUTE, sem `;`, etc.) que nunca mudam

Estrutura do prompt final:

```text
[Instrucoes de comportamento - custom ou padrao]

[Instrucoes tecnicas fixas - AUTO_EXECUTE, sem ;, formato de resposta]

[Metadados filtrados das tabelas do agente]
```

## Rotas


| Rota             | Componente      | Sidebar                  |
| ---------------- | --------------- | ------------------------ |
| `/`              | Home.tsx        | Nao                      |
| `/chat`          | Chat.tsx        | Sim                      |
| `/chat/:agentId` | Chat.tsx        | Sim (com nome do agente) |
| `/agents/new`    | AgentCreate.tsx | Nao                      |
| `/agents/:id`    | AgentDetail.tsx | Nao                      |
| `/admin`         | Admin.tsx       | Sim                      |


## Secao Tecnica

### Migracao SQL

```sql
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  system_prompt text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on agents" ON public.agents FOR SELECT USING (true);
CREATE POLICY "Allow public insert on agents" ON public.agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on agents" ON public.agents FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on agents" ON public.agents FOR DELETE USING (true);

CREATE TABLE public.agent_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  schema_name text NOT NULL,
  table_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on agent_tables" ON public.agent_tables FOR SELECT USING (true);
CREATE POLICY "Allow public insert on agent_tables" ON public.agent_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on agent_tables" ON public.agent_tables FOR DELETE USING (true);

ALTER TABLE public.conversations ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

### Arquivos a criar

- `src/pages/Home.tsx`
- `src/pages/Chat.tsx`
- `src/pages/AgentCreate.tsx`
- `src/pages/AgentDetail.tsx`
- `src/components/home/AgentCard.tsx`
- `src/hooks/useAgents.ts`

### Arquivos a modificar

- `src/App.tsx` - Novas rotas
- `src/lib/api.ts` - CRUD agents, agent_tables, createConversation com agent_id, sendChatMessage com agentId
- `src/types/database.ts` - Tipos Agent e AgentTable
- `src/components/sidebar/AppSidebar.tsx` - Mostrar nome do agente ativo e link Home
- `supabase/functions/chat/index.ts` - Receber agentId, buscar agente+tabelas, montar prompt dinamico
- Remover `src/pages/Index.tsx` (substituido por Home.tsx e Chat.tsx)

### Logica do prompt no chat Edge Function

```text
Se agentId presente:
  1. Buscar agent (name, system_prompt) e agent_tables
  2. Filtrar metadados apenas para as tabelas do agente

  Se agent.system_prompt existe e nao esta vazio:
    comportamento = agent.system_prompt
  Senao:
    comportamento = prompt padrao com {nome} e {tabelas}

  promptFinal = comportamento + instrucoesTecnicas + metadados

Se agentId ausente:
  promptFinal = prompt atual (chat livre, sem filtro)
```

### Fluxo completo

```text
Home (/) -> "Criar Agente"
  |
  v
AgentCreate -> Nome + Descricao + Prompt (opcional) + Tabelas
  |
  v
Salva agents + agent_tables no banco
  |
  v
Volta para Home -> Agente aparece na lista
  |
  v
Clica no agente -> /chat/:agentId
  |
  v
Chat carrega agente -> Cria conversa com agent_id
  |
  v
sendChatMessage envia agentId no body
  |
  v
Edge Function chat:
  1. Busca agent + agent_tables
  2. Monta prompt (custom ou padrao)
  3. Filtra metadados
  4. Envia ao LLM
  |
  v
LLM responde com contexto especializado

```

  
Faça um teste, o supabase lançou uma atualização no repositório:  
[supabase/agent-skills: Agent Skills to help developers using AI agents with Supabase](https://github.com/supabase/agent-skills)

Ou tente por este link:   
[https://www.npmjs.com/package/skills](https://www.npmjs.com/package/skills)