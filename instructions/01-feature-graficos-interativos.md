# Instrução de Arquitetura: Gráficos Interativos com Function Calling

## 1. Contexto e Objetivo
Atue como um Arquiteto de Software Sênior. O objetivo é transformar o chat atual ("Arquem IA") em um Agente Inteligente capaz de gerar visualizações de dados.

**Decisão de Arquitetura:**
Não usaremos parsing de texto (regex). Usaremos **Native Function Calling** (Chamada de Ferramentas nativa da OpenAI/Gemini).
O LLM deve receber uma definição de ferramenta chamada `generate_chart`. Quando o usuário pedir uma análise visual, o LLM retornará um objeto estruturado `tool_calls` em vez de texto.

**Stack:**
- **Frontend:** React, TypeScript, TailwindCSS, `react-plotly.js`.
- **Backend Orchestrator:** Supabase Edge Functions (Deno).
- **Data Processor:** Novo Microserviço Python (FastAPI + Pandas + Plotly).

---

## 2. Frentes de Implementação (Executar em Ordem)

### Frente 1: Microserviço Python (Data Processor)
Crie um serviço isolado para processamento de dados.
**Requisitos:**
- Framework: **FastAPI**.
- Endpoint: `POST /generate-chart`.
- Input Payload: `{ "data": [Array de Objetos do Banco], "chart_intent": "string (ex: bar, line, pie)", "title": "string" }`.
- Lógica:
  1. Converter `data` para DataFrame Pandas.
  2. Usar lógica inteligente (ou mapeamento simples inicial) para selecionar as colunas X e Y baseadas no tipo de dado.
  3. Gerar gráfico usando `plotly.express`.
  4. Retornar o JSON de configuração do gráfico (`fig.to_json()`).
- Output: JSON pronto para o Plotly.js.

### Frente 2: Supabase Edge Function (The Orchestrator)
Reescreva a lógica crítica em `supabase/functions/chat/index.ts` para suportar Tools.
**Requisitos:**
1. **Definição da Tool:**
   - Adicione ao payload da chamada da OpenAI/Gemini o parâmetro `tools`.
   - Defina a tool `generate_chart` com os parâmetros:
     - `sql_query`: A query SQL para buscar os dados (string).
     - `chart_type`: O tipo sugerido de gráfico (enum: bar, line, pie, scatter).
     - `chart_title`: Título para o gráfico (string).

2. **Handling da Resposta:**
   - Verifique se a resposta do LLM contém `tool_calls` (OpenAI) ou `functionCall` (Gemini).
   - **Caso TENHA tool_call:**
     a) Não retorne o texto imediatamente.
     b) Extraia a `sql_query` e execute no banco (usando `rpc`).
     c) Envie o resultado do banco + parâmetros do gráfico para a API Python (Frente 1).
     d) Receba o JSON do Plotly.
     e) Retorne para o frontend uma resposta especial estruturada, ex: `[CHART_CONTENT] { ...json_do_plotly... }`.
   - **Caso NÃO tenha tool_call:**
     - Faça o stream da resposta de texto normalmente.

### Frente 3: Frontend (Visualização)
Prepare o React para renderizar o componente rico.
**Requisitos:**
1. Instale `react-plotly.js` e `plotly.js`.
2. No componente `ChatMessage.tsx` (ou parser equivalente):
   - Implemente uma lógica que detecte se a mensagem é um payload de gráfico (identificado pela tag `[CHART_CONTENT]` ou estrutura JSON específica vinda da Edge Function).
3. Se for gráfico: Renderize o componente `<Plot />` com os dados recebidos, ocupando 100% da largura disponível no chat.
4. Se for texto: Renderize Markdown (comportamento atual).