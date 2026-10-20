## ADDED Requirements

### Requirement: Cancelamento por desconexão
O sistema SHALL cancelar a turn no OpenCode (interrupção da sessão e fechamento do iterador de eventos) quando o cliente fechar a conexão, e MUST liberar todos os recursos associados, incluindo chamadas pendentes e tools registradas.

#### Scenario: Cliente desconecta em streaming
- **WHEN** o cliente fecha a conexão durante um stream
- **THEN** o bridge interrompe a sessão, encerra a assinatura da request e registra o cancelamento em log

### Requirement: Keepalive e ausência de timeout ocioso do servidor
O sistema SHALL emitir um comentário SSE (`: ping`) a cada 15 segundos em streams sem eventos e MUST NOT encerrar a conexão por idle timeout do servidor HTTP enquanto a turn estiver ativa.

#### Scenario: Raciocínio longo
- **WHEN** o modelo fica 60 segundos sem emitir texto
- **THEN** o cliente recebe pings periódicos e a conexão permanece aberta

### Requirement: Timeouts por fase
O sistema SHALL aplicar timeouts configuráveis para o primeiro evento, o intervalo entre eventos e a duração total da turn, e MUST encerrar a turn com erro `504` (ou chunk de erro, se o stream já começou) ao estourá-los.

#### Scenario: Sem resposta do OpenCode
- **WHEN** nenhum evento chega dentro do timeout do primeiro evento
- **THEN** a turn é interrompida e o cliente recebe erro `504` com `type: "timeout_error"`

### Requirement: Autenticação opcional
O sistema SHALL exigir `Authorization: Bearer <chave>` quando `apiKeys` estiver configurado e MUST recusar subir em endereço fora de loopback sem chave configurada.

#### Scenario: Chave inválida
- **WHEN** a chave é ausente ou inválida e a autenticação está ativa
- **THEN** o sistema responde `401` no formato de erro OpenAI

#### Scenario: Sem chave configurada em loopback
- **WHEN** nenhuma chave está configurada e o bind é `127.0.0.1`
- **THEN** requests são aceitas com ou sem `Authorization`, e qualquer valor enviado é ignorado

### Requirement: Logs estruturados
O sistema SHALL emitir logs JSON com `reqId`, `sessionID`, `model`, fase da turn, duração, `finish_reason` e número de tool calls, e MUST NOT registrar conteúdo de mensagens nem chaves por padrão.

#### Scenario: Diagnóstico de request longa
- **WHEN** uma request falha após vários minutos
- **THEN** os logs permitem correlacionar `reqId` e `sessionID` e identificar a fase em que ocorreu a falha

### Requirement: Compatibilidade de rede
O sistema SHALL responder a preflight CORS apenas para origens configuradas e expor `GET /health` com o estado do plugin (locations registradas, turns ativas, chamadas pendentes).

#### Scenario: Health
- **WHEN** nenhuma location está registrada
- **THEN** `/health` responde `503` com o motivo
