# chat-completions Specification

## Purpose
TBD - created by archiving change add-opencode-bridge-mvp. Update Purpose after archive.
## Requirements
### Requirement: Resposta não-streaming
O sistema SHALL responder `POST /v1/chat/completions` sem `stream` com um objeto `chat.completion` contendo `id`, `created`, `model`, `choices[0].message` (role `assistant`), `finish_reason` e `usage` quando disponível.

#### Scenario: Chat simples
- **WHEN** o cliente envia mensagens `system` e `user` sem `stream`
- **THEN** a resposta é um `chat.completion` com o texto do modelo e `finish_reason: "stop"`

### Requirement: Streaming SSE
Com `stream: true`, o sistema SHALL emitir `chat.completion.chunk` via Server-Sent Events: primeiro chunk com `delta.role: "assistant"`, chunks com `delta.content`, um chunk final com `finish_reason`, e `data: [DONE]`. Com `stream_options.include_usage`, SHALL emitir antes do `[DONE]` um chunk com `choices: []` e `usage`.

#### Scenario: Ordem dos eventos
- **WHEN** o cliente pede streaming
- **THEN** os chunks chegam na ordem role, conteúdo, finish_reason, `[DONE]`, com `Content-Type: text/event-stream`

#### Scenario: Usage incluído
- **WHEN** a request tem `stream_options.include_usage: true`
- **THEN** um chunk com `choices: []` e `usage` precede o `[DONE]`

### Requirement: Entrada tolerante
O sistema SHALL aceitar conteúdo de mensagem como string ou array de partes de texto, aceitar o role `developer` como `system`, e MUST ignorar (registrando em log) parâmetros desconhecidos ou não suportados em vez de rejeitar a request.

#### Scenario: Conteúdo em partes
- **WHEN** uma mensagem `user` tem `content: [{type:"text", text:"oi"}]`
- **THEN** o texto é tratado como `"oi"`

#### Scenario: Parâmetro desconhecido
- **WHEN** a request inclui um campo não suportado
- **THEN** a request é atendida e o campo ignorado é registrado em log

### Requirement: Erros no formato OpenAI
O sistema SHALL retornar erros como `{ "error": { "message", "type", "code" } }` com status HTTP apropriado, e MUST sinalizar erro ocorrido durante streaming com um chunk de erro seguido de `[DONE]`.

#### Scenario: Request inválida
- **WHEN** o corpo não é JSON válido ou falta `messages`
- **THEN** o sistema responde `400` com `type: "invalid_request_error"`

#### Scenario: Erro no meio do stream
- **WHEN** o OpenCode falha depois de iniciado o stream
- **THEN** o cliente recebe um chunk de erro e `[DONE]`, e a conexão é encerrada

