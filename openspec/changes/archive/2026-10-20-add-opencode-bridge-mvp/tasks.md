## 1. Spikes de validação (gate do desenho)

- [x] 1.1 Criar um plugin v2 mínimo de laboratório (`Plugin.define`, carregado por `.opencode/plugins/` em um projeto de teste) com logging em arquivo
- [x] 1.2 S6: singleton por `globalThis`, `setup` por location, descarga/cleanup, conflito de porta (logs só em arquivo por design; a não interferência com o TUI interativo não foi verificada)
- [x] 1.3 S2: tool in-process registrada por request via `ctx.tool.transform` com `execute` suspenso por minutos; conferir `context` (sessionID/callID), `dispose()` e ausência de vazamento entre sessões
- [x] 1.4 S3: identificar nos eventos o momento em que todas as tool calls de uma step estão pendentes (chamadas paralelas)
- [x] 1.5 S5: `interrupt` com `execute` suspenso (cancelamento via `context.signal`) e estado resultante da sessão
- [x] 1.6 S8: observar pedidos de permissão nos eventos e responder/negar pelo `ctx`
- [x] 1.7 S1: injetar o `system` do cliente (instructions entries, hook `context` ou prefixo) e conferir o que fica no histórico persistido
- [x] 1.8 S4: histórico nativo (`tool-call`/`tool-result`) injetável via `e.messages` do hook `context`; `ctx` não tem `session.import`
- [x] 1.9 S7: levantar quais parâmetros de geração (`temperature`, `max_tokens`, `stop`) podem ser aplicados
- [x] 1.10 Gravar fixtures de eventos reais (texto, reasoning, tool nativa, tool do cliente pendente, permissão, erro) em `test/fixtures/`
- [x] 1.11 Atualizar design.md (D4-D9) e as specs com os resultados dos spikes

## 2. Projeto e infraestrutura

- [x] 2.1 Inicializar projeto Bun/TypeScript do plugin (`package.json`, `tsconfig`, `@opencode/plugin`, lint, `bun test`)
- [x] 2.2 Implementar `config.ts` (leitura de `ctx.options`, padrões, validação) 
- [x] 2.3 Implementar `obs/logger.ts` (JSON em arquivo, `reqId`, `sessionID`, sem conteúdo de mensagens por padrão)
- [x] 2.4 Implementar `core/errors.ts` e o mapeamento para o formato de erro OpenAI

## 3. Núcleo e host

- [x] 3.1 Definir tipos canônicos (`CanonicalRequest`, `CanonicalEvent`) em `core/canonical.ts`
- [x] 3.2 Definir a interface `OpenCodeHost` e um `FakeHost` para testes
- [x] 3.3 Implementar o adapter de `OpenCodeHost` sobre o `ctx` do plugin v2
- [x] 3.4 Implementar `EventMux` (assinatura única, despacho por `sessionID`, fechamento de iteradores, cleanup por `AbortSignal`)
- [x] 3.5 Implementar `SessionManager` (sessão no contexto do projeto, agent `build`, modelo da request, título `[bridge]`, conjunto de sessões do bridge, limpeza)
- [x] 3.5b Implementar o `ContextHook` único (`session.hook("context")` só para sessões do bridge): system do cliente, hint de code mode, `options` de geração (respeitando `capabilities.temperature`), filtro de `e.tools` por conversa e injeção de `e.messages` nativas
- [x] 3.6 Implementar `TurnRunner` (eventos do OpenCode para `CanonicalEvent`, interrupção, timeouts por fase)
- [x] 3.7 Testes unitários do `EventMux` e do `TurnRunner` com `FakeHost` e fixtures

## 4. Hospedagem do plugin

- [x] 4.1 Implementar o entrypoint `Plugin.define` com `setup`/cleanup e registro de locations
- [x] 4.2 Servidor singleton por processo com contagem de instâncias e encerramento ordenado
- [x] 4.3 Tratamento de conflito de porta sem derrubar o OpenCode
- [x] 4.4 Seleção de location por `x-opencode-directory`
- [x] 4.5 Testes de hospedagem (duas locations, descarga, porta ocupada)

## 5. Catálogo de modelos

- [x] 5.1 Implementar `opencode/models.ts` (`ctx.model.list()` e `default()` retornam `{location,data}`; filtrar `enabled && status === "active"`; cache curto; IDs `provider/model`)
- [x] 5.2 Implementar resolução estrita com `model_ambiguous` e `model_not_found`
- [x] 5.3 Implementar `GET /v1/models` e testes

## 6. Chat Completions (texto)

- [x] 6.1 Implementar o decoder (`string`/partes, `developer`, parâmetros ignorados com log)
- [x] 6.2 Implementar o encoder JSON (`chat.completion`, `usage`)
- [x] 6.3 Implementar o encoder SSE (role, deltas, finish, `include_usage`, `[DONE]`, chunk de erro)
- [x] 6.4 Implementar `POST /v1/chat/completions` ligando decoder, `TurnRunner` e encoder
- [x] 6.5 Teste de conformidade com o SDK oficial `openai` (JSON e stream) contra o plugin com `FakeHost`

## 7. Ciclo de vida e segurança

- [x] 7.1 Cancelamento por `request.signal` (interrupt, fechar iterador, remover sessão)
- [x] 7.2 Keepalive SSE a cada 15 s e `idleTimeout` desligado para streams
- [x] 7.3 Timeouts configuráveis (primeiro evento, ocioso, total) com erro `504`
- [x] 7.4 Autenticação Bearer opcional, recusa de bind fora de loopback sem chave, CORS por allowlist
- [x] 7.5 `GET /health` com locations registradas, turns ativas e chamadas pendentes
- [x] 7.6 Política de permissões sem interface via `permission.hook("evaluate")` (`autoApprove`, `readOnly`; `ask` nunca fica pendente)

## 8. Tool calling híbrido

- [x] 8.1 Decoder de `tools`, `tool_choice`, mensagens `assistant.tool_calls` e `tool`
- [x] 8.2 Registro por conversa das tools do cliente (`ctx.tool.transform`, `options.codemode: false`, JSON Schema do cliente como `input`, prefixo estável `br_<convId>_`, mapeamento de volta ao nome original, `dispose()` ao fim da conversa)
- [x] 8.3 `PendingCallStore` com `execute` suspenso, TTL e rejeição por timeout/cancelamento
- [x] 8.4 Coletar `session.tool.called` de tools do bridge até `session.step.streamed` e encerrar a resposta com `tool_calls` (`tool_call.id` = `context.id`)
- [x] 8.5 Validação do `input` contra o schema; erro devolvido ao modelo quando inválido
- [x] 8.6 Encoder JSON e SSE de `tool_calls` (`index`, `id`, `function.arguments`) e `finish_reason: "tool_calls"`
- [x] 8.7 Retomada: mensagens `tool` resolvem pendências e a mesma sessão continua no novo response; erro para resultados parciais
- [x] 8.8 Caminho de replay para retomada sem pendência correspondente (TTL, reinício) e para o histórico de turns anteriores do usuário, injetando mensagens nativas pelo `ContextHook`
- [x] 8.9 Testes: mistura de nativa e cliente, tools isoladas entre requests concorrentes, nome igual a tool nativa, ciclo multi-turn, cancelamento com pendência

## 9. Estabilidade em sessões longas

- [x] 9.1 Teste de soak: requests longos concorrentes, desconexões no meio, ausência de vazamento de sessões, assinaturas, tools e pendências
- [x] 9.2 Métricas básicas (turns ativas, sessões vivas, pendências, latência por fase)
- [x] 9.3 Verificar custo de contexto por turn e documentar recomendações (AGENTS.md grandes)

## 10. Aceitação e documentação

- [x] 10.1 Teste de integração contra um OpenCode v2 real (opt-in) cobrindo texto, stream, tool nativa e tool do cliente
- [x] 10.2 Validar manualmente com o pen.dev (loop multi-turn com suas tools e skills do projeto) e com o Cursor
- [x] 10.3 README com instalação (`plugins` no `opencode.json`), opções, comportamento multi-instância e limitações conhecidas
