## Why

Aplicações externas (pen.dev, Cursor, SDKs OpenAI-compatible) só falam o dialeto OpenAI, enquanto os modelos, credenciais, agents, skills e tools do usuário vivem no OpenCode. O proxy existente (`KochC/opencode-llm-proxy`) já é um plugin, mas tem tool calling frágil (MCP dinâmico com pool de slots, vazamento de tools entre requests, #55/#56/#72/#73), replay do histórico inteiro a cada request, resolução ambígua de modelos e uma base em JS monolítica com suporte a V1 e V2 misturados.

O objetivo é um **plugin do OpenCode v2**: ao abrir o OpenCode num projeto que o declara, ele sobe um servidor OpenAI-compatible cujos requests rodam no contexto daquele projeto (AGENTS.md, skills, agents, MCPs e tools do projeto e globais) com o agent `build`. O pen.dev precisa ainda de tools executadas no cliente (as que ele expõe via MCP), então o bridge é **híbrido**: tools do OpenCode executam no servidor; tools declaradas na request executam no cliente.

## What Changes

- Novo plugin OpenCode **somente v2** (`Plugin.define({ id, setup(ctx) })`), em TypeScript, que sobe e derruba um servidor HTTP junto com o OpenCode, sem camada de rede entre o bridge e o OpenCode (usa `ctx.session`, `ctx.event`, `ctx.model`, `ctx.tool`).
- `GET /v1/models` com os modelos de providers conectados (`provider/model`); ID ambíguo ou desconhecido retorna erro explícito.
- `POST /v1/chat/completions` com resposta JSON e streaming SSE (`stream_options.include_usage`, `[DONE]`).
- Contexto do projeto herdado: sessões criadas no diretório do projeto, agent padrão `build` (configurável), `AGENTS.md`, skills, MCPs e tools nativas do projeto e globais disponíveis ao modelo.
- Tool calling **híbrido**: tools nativas executam dentro do loop do OpenCode e o cliente só vê texto; tools declaradas em `tools` na request executam no cliente (`finish_reason: "tool_calls"`, chamadas paralelas, retomada da mesma turn quando o resultado chega na request seguinte, com TTL).
- Política para pedidos de permissão das tools nativas em requests sem interface (rejeitar por padrão, auto-aprovar apenas o que a configuração permitir), para nunca travar uma turn.
- Ciclo de vida robusto: cancelamento por desconexão, keepalive SSE, timeouts por fase, limpeza de sessões e de tools registradas, shutdown ordenado quando o plugin é descarregado.
- Hospedagem segura em multi-instância: um único servidor por processo OpenCode, porta ocupada por outro processo não derruba o OpenCode, logs fora do stdout/stderr do TUI.
- API key opcional e logs estruturados com `reqId` e `sessionID`.
- Modelo canônico interno de request/eventos, para adicionar Responses e Anthropic Messages depois.
- Spikes iniciais contra a API de plugin v2 que validam as premissas do tool bridge.

Fora de escopo: OpenCode v1, OpenAI Responses, Anthropic Messages, servidor standalone fora do OpenCode, modo de sessão isolada (sem contexto do projeto), embeddings, imagens.

## Capabilities

### New Capabilities
- `plugin-hosting`: carga como plugin v2, ciclo de vida do servidor, singleton por processo, conflito de porta, opções e logs sem afetar o TUI.
- `model-catalog`: listagem e resolução de modelos (`/v1/models`, `provider/model`, erros de ambiguidade).
- `chat-completions`: contrato OpenAI Chat Completions, JSON e streaming SSE, tratamento de parâmetros.
- `project-context`: sessões no contexto do projeto com agent `build`, system do cliente, política de permissões e limpeza de sessões.
- `client-tool-calling`: tool calling híbrido, tools do cliente com suspensão e retomada, chamadas paralelas e resultados.
- `request-lifecycle`: cancelamento, keepalive, timeouts, erros no formato OpenAI, autenticação opcional e logs estruturados.

### Modified Capabilities

## Impact

- Código novo em `src/` (`plugin`, `http`, `protocols/openai-chat`, `core`, `opencode`, `obs`) e `test/`; não há código existente.
- Dependências: `@opencode/plugin` (tipos e `Plugin.define`), runtime Bun do OpenCode, biblioteca de schema/validação JSON; `openai` apenas como dev dependency para testes de conformidade.
- O usuário passa a declarar o plugin em `plugins` do `opencode.json` (global ou do projeto), com `options` (host, porta, chaves, agent, política de permissões).
- Risco principal: o tool bridge depende de comportamento da API de plugin v2 (tools in-process suspensas, snapshot de tools por model request, eventos) que precisa ser validado nos spikes.
