# project-context Specification

## Purpose
TBD - created by archiving change add-opencode-bridge-mvp. Update Purpose after archive.
## Requirements
### Requirement: Sessão no contexto do projeto
O sistema SHALL criar a sessão da request na location do projeto e MUST preservar o contexto do OpenCode: `AGENTS.md`, skills, agents, MCPs e tools nativas, do projeto e globais.

#### Scenario: Instruções do projeto
- **WHEN** o projeto tem `AGENTS.md` com uma regra
- **THEN** a regra faz parte do contexto da request

#### Scenario: Skills do projeto
- **WHEN** o projeto define uma skill
- **THEN** o modelo pode usá-la na request, como em uma sessão normal do OpenCode

### Requirement: Agent padrão
O sistema SHALL usar o agent `build` (ou o configurado em `defaultAgent`) em toda sessão do bridge e MUST retornar erro claro na inicialização da turn se o agent não existir.

#### Scenario: Agent padrão
- **WHEN** uma request é atendida sem configuração adicional
- **THEN** a sessão usa o agent `build`

#### Scenario: Agent inexistente
- **WHEN** `defaultAgent` aponta para um agent que não existe
- **THEN** o sistema responde `500` com `code: "agent_not_found"`

### Requirement: Modelo da request
O sistema SHALL usar o modelo resolvido da request na sessão, sobrepondo o modelo do agent.

#### Scenario: Modelo escolhido pelo cliente
- **WHEN** a request usa `model: "anthropic/claude-sonnet-4"`
- **THEN** os model requests da sessão usam esse modelo

### Requirement: System prompt do cliente
O sistema SHALL repassar mensagens `system`/`developer` do cliente ao modelo como contexto adicional, sem substituir o prompt do agent nem as instruções do projeto.

#### Scenario: System do cliente
- **WHEN** a request inclui uma mensagem `system`
- **THEN** o modelo recebe esse conteúdo junto com o contexto do projeto

### Requirement: Histórico do cliente como contexto nativo
O sistema SHALL apresentar ao modelo o histórico enviado pelo cliente (mensagens `user`, `assistant`, chamadas e resultados de tools) como mensagens nativas do OpenCode, preservando as chamadas e resultados de tools como tais, e MUST NOT persistir essas mensagens injetadas no histórico da sessão.

#### Scenario: Conversa com histórico
- **WHEN** a request traz mensagens anteriores com uma tool call e seu resultado
- **THEN** o modelo usa essas informações ao responder à última mensagem do usuário

#### Scenario: Histórico não persistido
- **WHEN** a sessão do bridge é mantida com `keepSessions`
- **THEN** o histórico persistido contém apenas a mensagem enviada como prompt e as respostas geradas

### Requirement: Política de permissões sem interface
O sistema SHALL preservar as decisões `allow` e `deny` das regras do agent e SHALL resolver todo pedido que as regras marcariam como `ask` segundo a configuração (`autoApprove`: `none`, `edit` ou `all`), MUST negar por padrão (`none`) e MUST NOT deixar a turn aguardando uma resposta humana. Com `readOnly`, SHALL negar também edições e comandos de shell permitidos pelas regras.

#### Scenario: Permissão negada por padrão
- **WHEN** o modelo chama uma tool nativa cuja regra resolve para `ask` e `autoApprove` é `none`
- **THEN** o pedido é negado com uma mensagem, o modelo recebe o erro `permission.rejected` e a turn prossegue sem travar

#### Scenario: Regra já permitida
- **WHEN** o agent permite `read` e o modelo lê um arquivo
- **THEN** a leitura é executada normalmente

#### Scenario: Auto-aprovação de edição
- **WHEN** `autoApprove` é `edit`, a regra resolve para `ask` e o modelo pede para editar um arquivo
- **THEN** o pedido é aprovado e a edição acontece

#### Scenario: Modo somente leitura
- **WHEN** `readOnly` é verdadeiro e o modelo pede `shell`, mesmo permitido pelas regras
- **THEN** o pedido é negado

### Requirement: Limpeza de sessões
O sistema SHALL remover a sessão ao fim da conversa do bridge (turn concluída sem tool pendente, erro, cancelamento ou expiração de TTL), salvo com `keepSessions`, e MUST remover as sessões abertas ao ser descarregado.

#### Scenario: Cancelamento
- **WHEN** o cliente desconecta no meio da turn
- **THEN** a sessão é interrompida e removida

#### Scenario: Manter sessões
- **WHEN** `keepSessions` é verdadeiro
- **THEN** a sessão permanece no OpenCode com o título `[bridge] ...`

