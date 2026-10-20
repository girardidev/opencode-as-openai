## Context

O OpenCode v2 (instalado: 2.1.1) carrega plugins com `Plugin.define({ id, setup(ctx) })` (pacote `@opencode/plugin`). O `ctx` é essencialmente o cliente do servidor (`ctx.session`, `ctx.model`, `ctx.agent`, `ctx.skill`, `ctx.mcp`, `ctx.event`, `ctx.permission`) mais métodos exclusivos de plugin: `transform` para registrar tools (`ctx.tool.transform` com `execute(input, context)` in-process), agents, skills, MCPs; hooks (`ctx.session.hook("context")`, `ctx.permission.hook("evaluate")`, `ctx.tool.hook(...)`); `ctx.location` e `ctx.options`. Plugins listados em `plugins` do `opencode.json` ou em `.opencode/plugins/` são carregados uma vez **por location** dentro do mesmo processo, sob demanda (na primeira requisição àquela location).

O prompt v2 (`session.prompt`) aceita só `text`, `files`, `agents`, `skills` e `metadata`: não há `system`, `tools` nem `model` por prompt. Isso é contornado pelos hooks (ver decisões).

O proxy da KochC usa MCP dinâmico com pool de slots porque o OpenCode v1 não permitia desregistrar MCP. No v2 isso não é necessário: tools in-process são registradas e descartadas (`Registration.dispose()`), e o hook `context` filtra as tools visíveis por sessão.

Cliente-alvo: pen.dev, cujo agente faz muitas round-trips de tool calling com tools que ele mesmo expõe, além de querer o contexto do projeto (AGENTS.md, skills, tools nativas).

## Goals / Non-Goals

**Goals:**
- Plugin v2 em TypeScript, testável sem OpenCode real (fake `ctx`).
- Contrato OpenAI Chat Completions fiel o bastante para pen.dev, Cursor e SDKs oficiais.
- Tool calling híbrido estável: nativas no servidor, do cliente com suspensão e retomada.
- Estabilidade em requests longos e em uso multi-instância do OpenCode.
- Núcleo independente de protocolo, para adicionar Responses e Anthropic depois.

**Non-Goals:**
- OpenCode v1, Responses API, Anthropic Messages.
- Servidor standalone fora do OpenCode e sessões isoladas sem contexto do projeto.
- Multi-tenant, rate limiting por chave, UI.

## Decisions

Os itens marcados **[validado]** foram verificados com um plugin de laboratório contra o OpenCode 2.1.1 (fixtures gravadas em `test/fixtures/`).

**D1. Plugin v2 em processo, sem gateway de rede.**
O bridge roda dentro do OpenCode e fala com ele pelo `ctx`. Mantém-se uma interface fina `OpenCodeHost` sobre o `ctx` (`listModels`, `createSession`, `prompt`, `interrupt`, `removeSession`, `subscribe`, `registerClientTools`, `hooks`) para permitir fake em testes e isolar mudanças da API. Alternativa descartada: processo standalone via HTTP com `opencode serve`.

**D2. Modelo canônico e codecs puros.**
`protocols/openai-chat` converte request em `CanonicalRequest` e `CanonicalEvent` (`text.delta`, `reasoning.delta`, `tool_call`, `usage`, `finish`, `error`) em JSON ou chunks SSE. Sem I/O, testado por fixtures. Novos protocolos são novos pares decoder/encoder.

**D3. `EventMux`: uma assinatura de eventos para todas as requests. [validado]**
Uma chamada a `ctx.event.subscribe({ signal })` por plugin despacha por `event.data.sessionID`. Ciclo observado de uma turn: `session.execution.started` → `step.started` → `text.started/delta/ended` e/ou `reasoning.*` → `tool.input.started/ended` → `tool.called` (`executed:false` para tools sem execução prévia) → `step.streamed` (fim do streaming do modelo na step) → `tool.success/failed` → `step.ended` (`finish`: `stop`/`tool-calls`, `tokens`) → `usage.updated` → `execution.succeeded | interrupted`. Em falha: `step.failed`, `tool.failed`. O iterador é fechado ao fim da turn, em erro ou interrupção.

**D4. Sessão no contexto do projeto, agent `build`, controlada por hooks. [validado]**
Cada conversa cria `ctx.session.create({ agent: "build", model, title: "[bridge] ..." })` (a location é a do plugin; o `ctx` da location certa é escolhido por `x-opencode-directory`). O contexto do projeto (AGENTS.md, skills, MCPs, tools nativas) é herdado. Um hook `ctx.session.hook("context")`, que age **apenas** nas sessões do bridge (conjunto de `sessionID`), faz:
- **system do cliente:** `e.system.push({ type: "text", text })` (transitório, não entra no histórico persistido; o modelo obedeceu a instrução injetada);
- **parâmetros de geração:** `e.options.temperature`, `e.options.maxOutputTokens` etc., omitindo `temperature` quando `model.capabilities.temperature` for `false`;
- **tools visíveis:** `delete e.tools[nome]` para tudo que não pertença à conversa (tools do cliente de outras conversas, e opcionalmente nativas bloqueadas por política); confirmado que sem o filtro a tool de outra request aparece na sessão;
- **histórico nativo (replay):** `e.messages.splice(0, 0, ...)` com mensagens `user/assistant/tool` e partes `tool-call {id,name,input}` e `tool-result {id,name,result:{type:"text",value}}`; o modelo usa corretamente as informações e a seed **não** é persistida (D6).
O ID da sessão é removido do conjunto e a sessão é apagada (`ctx.session.remove`) quando a conversa termina, exceto com `keepSessions`.

**D5. Tool bridge híbrido por tools in-process com suspensão e retomada. [validado]**
- Tools nativas executam no loop do OpenCode; o cliente só recebe texto.
- Ao iniciar uma conversa com `tools`, o bridge registra uma tool in-process por tool declarada via `ctx.tool.transform`, com `options: { codemode: false }` (**obrigatório**: por padrão tools de plugin entram no catálogo *code mode* e o modelo as chama por dentro do `execute`), `input` = JSON Schema do cliente tal como veio e nome `br_<convId>_<nome>` (o bridge mapeia de volta ao nome original; o prefixo é estável durante todo o tool loop da conversa). `Registration.dispose()` remove a tool (verificado).
- O `execute(input, context)` recebe `context = { sessionID, agent, messageID, id, progress, signal }`; `context.id` é igual ao `id` do evento `tool.called` e é usado como `tool_call.id` do OpenAI. O `execute` retorna uma promessa suspensa guardada em um `PendingCallStore` (`callId → deferred`).
- **Chamadas paralelas:** o conjunto de chamadas da step é o das `tool.called` de tools do bridge recebidas até o evento `step.streamed` (as `tool.called` das paralelas e o `execute` de cada uma chegam no mesmo instante, antes do `step.streamed`). Nesse ponto o `TurnRunner` encerra a resposta HTTP com `tool_calls`; a sessão continua viva, bloqueada nos `execute`.
- **Retomada:** a request seguinte traz mensagens `tool` com `tool_call_id` conhecidos; o bridge resolve os `deferred` com `{ content: <texto> }` e os eventos da mesma sessão passam a alimentar a nova resposta. Sem replay. Verificado com suspensão de **240 s** sem qualquer timeout do OpenCode.
- **Cancelamento/expiração:** `session.interrupt` aciona `context.signal` em todos os `execute` pendentes (rejeitam), seguido de `tool.failed(aborted)`, `step.failed` e `execution.interrupted`, sem estado sujo. O TTL das pendências é do bridge.
- **Fallback sem pendência** (TTL, reinício): nova sessão com o histórico injetado nativamente por D4; a retomada é só mais uma conversa.
- **Hint de code mode:** o modelo tenta primeiro chamar a tool pelo `execute` (code mode) e só depois a chama direto; o hook `context` acrescenta uma instrução curta no system dizendo que as tools do cliente são funções diretas, fora do catálogo code mode.

**D6. Histórico entre turns do usuário: sessão por turn, histórico injetado nativamente.**
A sessão vive durante o tool loop (stateful). Quando a turn termina sem pendências (`finish: stop`), a sessão é removida; uma nova mensagem do usuário cria outra sessão, na qual o histórico completo do cliente é injetado como mensagens nativas pelo hook `context` e o último `user` vai como `prompt`. Isso é determinístico, mantém tool calls reais no contexto e não depende de estado do bridge. Custo: perde cache de prompt entre turns do usuário (melhoria posterior: reuso por hash do prefixo). `ctx` não expõe `session.import`; o hook cobre a necessidade.

**D7. Permissões das tools nativas sem interface. [validado]**
Um hook `ctx.permission.hook("evaluate")` age só nas sessões do bridge. O `effect` inicial vem das regras do agent (no agent `build` padrão: `allow` para quase tudo, `ask` para itens como `*.env`). Política: `allow`/`deny` das regras são respeitados; `ask` vira `allow` ou `deny` conforme `options.autoApprove` (`"none"` = `deny` por padrão; `"edit"`; `"all"`), com `e.message` explicando. Quando `deny`, o modelo recebe `tool.failed` com `error.type: "permission.rejected"` e a mensagem, e a turn segue sem nada pendente. Opcionalmente `options.readOnly: true` nega `edit`/`shell` mesmo que a regra permita.

**D8. Hospedagem: um servidor por processo, tolerante a conflitos. [validado]**
Estado compartilhado em `globalThis` (`ctxs: Map<dir, ctx>`, servidor). `setup` roda uma vez por location carregada (verificado: duas locations no mesmo processo → um servidor e dois registros). Se a porta estiver ocupada (segundo processo OpenCode), `Bun.serve` lança, o bridge captura e loga e o OpenCode funciona normalmente. O `cleanup` do plugin roda em SIGTERM para cada location; ao zerar o mapa, o servidor para e a porta é liberada. Caminhos devem ser normalizados com `realpath` (o `ctx.location.directory` vem como `/private/tmp/...` enquanto o header do cliente pode vir como `/tmp/...`). Limitação: o plugin só conhece as locations já carregadas; sem header, usa a primeira registrada. Logs vão para arquivo (nunca stdout/stderr por padrão); a não interferência com o TUI é por construção e **não** foi verificada com um TUI interativo.

**D9. Catálogo e resolução de modelo estrita. [validado]**
`ctx.model.list()`, `provider.list()` e `model.default()` retornam `{ location, data }`. Cada modelo tem `id`, `providerID`, `name`, `enabled`, `status`, `capabilities { tools, input, output, temperature }`, `limit { context, input, output }` e `variants`. O catálogo expõe `enabled && status === "active"` como `providerID/id`. ID sem provider só é aceito se único (`400 model_ambiguous` com candidatos). Sem `model` na request, usa `model.default()`.

**D10. Ciclo de vida, auth e observabilidade.**
`request.signal` do Bun cancela a turn (`interrupt`, rejeita pendências, fecha iterador, remove sessão e registro de tools). `Bun.serve` com `idleTimeout: 0` para streams (verificado como funcional) e `: ping` a cada 15 s. Timeouts: primeiro evento, ocioso e total. Erros no formato OpenAI. `Authorization: Bearer` contra `apiKeys` (bind fora de loopback exige chave). Logs JSON com `reqId`, `sessionID`, modelo, fase, duração, `finish_reason`, tool calls.

## Risks / Trade-offs

- [Custo de contexto: a configuração do usuário gera ~14 mil tokens de entrada por turn, mesmo para "olá" (instruções globais, code mode, MCPs)] → Aceito por requisito (contexto do projeto); cache de prompt do provider cobre as turns seguintes do mesmo tool loop; métricas por turn; recomendação de enxugar AGENTS.md no README.
- [Agent `build` permite quase tudo por padrão: um cliente externo pode disparar `shell`/`edit` no projeto] → Política D7 documentada, `autoApprove` e `readOnly`; chave de API obrigatória fora de loopback.
- [Qualidade das tool calls com prefixo `br_<convId>_`] → Descrição preserva o nome original; avaliar nomes sem prefixo quando a conversa for a única registrando aquele nome.
- [Modelo tenta code mode antes da chamada direta (custo de uma step)] → Hint no system (D5); medir.
- [API de plugin v2 jovem e sujeita a mudança] → `OpenCodeHost`, fixtures de eventos reais, versão testada fixada.
- [Vários OpenCode abertos disputam a porta; locations não carregadas] → D8 e documentação do comportamento.
- [Suspensão por tempo indeterminado] → TTL próprio; `interrupt` sempre limpa (verificado).

## Open Questions

- Logs fora do TUI: validar com um TUI interativo (D8).
- Hint de code mode: quanto reduz a tentativa via `execute` e se o modelo realmente o respeita.
- Reuso de sessão por prefixo entre turns do usuário (otimização de cache) fica para depois do MVP.
