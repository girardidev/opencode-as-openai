## ADDED Requirements

### Requirement: Tools nativas executam no servidor
O sistema SHALL deixar as tools do OpenCode (nativas, MCP e skills) executarem dentro do loop da turn, sem expô-las ao cliente como `tool_calls`; o cliente recebe apenas o texto e o resultado final.

#### Scenario: Tool nativa
- **WHEN** o modelo chama `read` durante a turn
- **THEN** o OpenCode executa a tool e a resposta ao cliente contém só o texto final

### Requirement: Declaração de tools do cliente
O sistema SHALL aceitar `tools` (tipo `function`, com `name`, `description`, `parameters`) e `tool_choice` (`auto`, `none`, `required` ou função específica) e MUST disponibilizar ao modelo as tools declaradas na request corrente, sem colisão com tools nativas de mesmo nome e sem tools declaradas por outras requests.

#### Scenario: Tools isoladas entre requests
- **WHEN** duas requests sequenciais declaram tools diferentes (`get_weather`, depois `calculate`)
- **THEN** a segunda só pode produzir chamadas a `calculate` entre as tools do cliente

#### Scenario: Nome igual a tool nativa
- **WHEN** o cliente declara uma tool chamada `read` e o OpenCode também tem `read`
- **THEN** a chamada à tool do cliente é devolvida com o nome `read` e a nativa não é afetada

#### Scenario: Tools do cliente como chamadas diretas
- **WHEN** o cliente declara uma tool e o modelo decide usá-la
- **THEN** a tool é oferecida ao modelo como função direta (não dentro de um catálogo de code mode) e a chamada chega ao cliente com os argumentos originais

#### Scenario: Concorrência entre conversas
- **WHEN** duas conversas simultâneas declaram uma tool com o mesmo nome e schemas diferentes
- **THEN** cada conversa só enxerga e valida a sua própria definição

### Requirement: Tool call do cliente devolvida
Quando o modelo propõe chamar uma ou mais tools do cliente, o sistema SHALL encerrar a resposta com `finish_reason: "tool_calls"` e `message.tool_calls[]` (`id`, `type: "function"`, `function.name` original, `function.arguments` como string JSON), sem executar nada no servidor para essas tools. Em streaming, SHALL emitir `delta.tool_calls` com `index`, `id`, `type`, `function.name` e `function.arguments`.

#### Scenario: Chamada única
- **WHEN** o modelo decide chamar `get_weather`
- **THEN** a resposta tem `finish_reason: "tool_calls"` e uma entrada em `tool_calls` com argumentos JSON válidos

#### Scenario: Chamadas paralelas
- **WHEN** o modelo propõe duas chamadas na mesma step
- **THEN** a resposta contém duas entradas com `index` 0 e 1 e IDs distintos, em streaming e fora dele

#### Scenario: Mistura de nativa e cliente
- **WHEN** na mesma turn o modelo chama uma tool nativa e depois uma tool do cliente
- **THEN** a nativa executa no servidor e só a do cliente aparece em `tool_calls`

### Requirement: Retomada com o resultado
O sistema SHALL retomar a mesma sessão quando a request seguinte trouxer mensagens `tool` cujos `tool_call_id` correspondam a chamadas pendentes, entregando os resultados ao modelo e continuando a resposta, sem reenviar o histórico ao OpenCode.

#### Scenario: Ciclo completo
- **WHEN** o cliente envia o histórico com a chamada do assistant e a mensagem `tool` correspondente
- **THEN** a turn continua na mesma sessão e termina com `finish_reason: "stop"` ou novas `tool_calls`

#### Scenario: Resultados parciais
- **WHEN** a step tinha duas chamadas pendentes e a request traz o resultado de apenas uma
- **THEN** o sistema responde `400` com `invalid_request_error` indicando as chamadas sem resultado

### Requirement: Expiração de chamadas pendentes
O sistema SHALL expirar chamadas pendentes após um TTL configurável, rejeitar a execução suspensa com erro de timeout, interromper a sessão e liberar os recursos.

#### Scenario: Cliente nunca responde
- **WHEN** o TTL passa sem que o resultado chegue
- **THEN** a sessão é interrompida e removida e a tool registrada é descartada

### Requirement: Retomada sem pendência correspondente
O sistema SHALL, quando a request trouxer resultados de tools sem chamada pendente correspondente (expiração ou reinício), continuar a conversa em uma nova sessão com o histórico fornecido pelo cliente apresentado como mensagens nativas, em vez de falhar.

#### Scenario: Pendência expirada
- **WHEN** a request traz uma mensagem `tool` cujo `tool_call_id` já expirou
- **THEN** a conversa continua em uma nova sessão com o histórico fornecido pelo cliente

### Requirement: Validação dos argumentos
O sistema MUST validar o `input` proposto pelo modelo contra o `parameters` da tool do cliente antes de devolvê-lo e MUST NOT devolver uma tool call com argumentos que não sejam JSON válido.

#### Scenario: Argumentos inválidos
- **WHEN** o modelo propõe argumentos que violam o schema
- **THEN** o sistema devolve o erro de validação ao modelo para nova tentativa, sem enviar a tool call malformada ao cliente

### Requirement: Limpeza das tools do cliente
O sistema SHALL descartar o registro das tools do cliente e as chamadas pendentes ao fim da conversa, inclusive em erro, cancelamento, expiração e descarga do plugin.

#### Scenario: Cancelamento com chamada pendente
- **WHEN** o cliente desconecta enquanto há uma chamada pendente
- **THEN** a chamada é rejeitada, a sessão removida e o registro das tools descartado
