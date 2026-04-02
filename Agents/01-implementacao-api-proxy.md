Markdown
# Fase 1: Implementação da API Proxy (Supabase Edge Function)

## 1. Contexto do Sistema
Você é um desenvolvedor backend sênior especialista em Deno e Supabase Edge Functions.
Sua tarefa é criar um proxy de banco de dados (`external-db-proxy`) que receba instruções lógicas em JSON de uma aplicação frontend e repasse essas instruções para uma API legada em Delphi (SQL Server).
Você não deve gerar código de banco de dados diretamente; seu papel é orquestrar requisições HTTP de forma segura, mascarando credenciais sensíveis e formatando os payloads corretamente.

## 2. Arquivos Afetados
- Crie ou sobrescreva o arquivo: `supabase/functions/external-db-proxy/index.ts`

## 3. Contratos de Interface (I/O)

### Input Esperado (Request Body recebido do Frontend)
A Edge Function receberá uma requisição `POST` com `application/json`.
```typescript
interface ProxyRequest {
  fields: string;   // Obrigatório. Ex: "AT.ATEN_ID, C.CLIE_NOMEPRINC"
  tables: string;   // Obrigatório. Ex: "ATENDIMENTO AS AT LEFT JOIN CLIENTE..."
  cond: string;     // Obrigatório. Ex: "AT.EMP_ID = 1 AND..."
  order?: string;   // Opcional. Ex: "AT.ATEN_ID DESC"
  pageNumber?: number | string; // Opcional. Fallback interno: "1"
  rowspPage?: number | string;  // Opcional. Fallback interno: "15"
  empresa?: string; // Opcional. Fallback interno: "1"
}
Output Esperado (Response retornado ao Frontend)
Você deve normalizar a resposta bruta da API Delphi para bater EXATAMENTE com este padrão adotado pelo nosso frontend:

TypeScript
interface ProxyResponse {
  success: boolean;
  data: any[]; // O array de objetos real retornado pela base
  rowCount: number; // Quantidade de registros retornados no array data
  pagination?: {
    pageNumber: number;
    totalPages: number;
    totalRec: number;
  };
  error?: string; // Presente apenas se success = false
}
4. Variáveis de Ambiente Necessárias
É estritamente proibido utilizar credenciais "hardcoded" no código. Utilize Deno.env.get():

DELPHI_API_URL (URL base da API Delphi. Ex: https://app.registrobase.com.br:32077/api/listarfromselect)

DELPHI_API_TOKEN (Chave de sistema injetada no FormData como 'TokenAPI')

DELPHI_AUTH_BEARER (Token longo JWT injetado no Header HTTP 'Authorization')

5. Regras de Negócio e Implementação Passo a Passo
Passo 1: Setup e CORS

Importe o serve do https://deno.land/std@0.168.0/http/server.ts.

Adicione os headers de CORS padrão do Supabase (Access-Control-Allow-Origin: *, etc).

Se req.method === 'OPTIONS', retorne 200 OK apenas com os headers de CORS para liberar o preflight.

Passo 2: Validação de Entrada

Faça o parse do JSON de entrada usando await req.json().

Valide a presença obrigatória de fields, tables e cond. Se faltar algum, retorne 400 Bad Request com a mensagem informando o erro.

Passo 3: Construção do Payload para a API Delphi

A API Delphi legada EXIGE que o payload seja enviado no formato multipart/form-data.

Crie uma instância de FormData().

Insira as chaves estáticas de sistema: formData.append("function", "1") e formData.append("TokenAPI", Deno.env.get("DELPHI_API_TOKEN")).

Insira as chaves dinâmicas do request garantindo que TODAS sejam convertidas para string (o append do FormData falha com numéricos no Deno).

Aplique os fallbacks caso os parâmetros opcionais não venham no JSON: pageNumber = "1", RowspPage = "15", empresa = "1". Atenção ao case sensitive exigido pela Delphi: a chave de paginação é RowspPage.

Passo 4: Chamada HTTP (Fetch) para a Delphi

O fetch para a API Delphi DEVE utilizar o método POST (O motor do Deno bloqueia envio de FormData em requisições GET).

Injete o header de segurança: Authorization: Bearer ${Deno.env.get("DELPHI_AUTH_BEARER")}.

O body da requisição será a instância de FormData criada no Passo 3. (Aviso: Não defina o Content-Type manualmente no fetch, o Deno precisa calcular o boundary automaticamente).

Passo 5: Parsing Estrito do Retorno da Delphi
A API Delphi retorna o JSON em um formato customizado e aninhado, semelhante a este:

JSON
{"PARAMS":[null], "RESULT":[ { "pageNumber": 2, "totalPages": 2, "totalRec": 170, "rowspPage": 100, "data": [{"ATEN_ID": 8570, ...}] } ] }
Faça o parse seguro do retorno com await response.json().

Você deve extrair o array de registros contido especificamente em RESULT[0].data.

Extraia também os dados de paginação (pageNumber, totalPages, totalRec) de dentro de RESULT[0] se existirem.

Se a estrutura retornar vazia, falhar ou RESULT[0] for indefinido, não cause exceção; simplesmente retorne data: [] e rowCount: 0 na resposta normalizada.

Passo 6: Tratamento de Exceções Global

Envolva toda a lógica principal em um bloco try/catch.

Qualquer falha de rede, erro do Deno ou quebra de código deve ser capturada e retornar um HTTP 500 Internal Server Error com a estrutura exata: { "success": false, "error": error.message }.