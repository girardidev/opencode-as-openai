## ADDED Requirements

### Requirement: Listagem de modelos
O sistema SHALL expor `GET /v1/models` no formato OpenAI (`object: "list"`, itens com `id`, `object: "model"`, `created`, `owned_by`), contendo apenas modelos de providers conectados no OpenCode, com `id` no formato `provider/model`.

#### Scenario: Providers conectados
- **WHEN** o cliente chama `GET /v1/models` e o OpenCode tem dois providers conectados
- **THEN** a resposta lista apenas os modelos desses providers, cada um como `provider/model`

#### Scenario: Provider não conectado
- **WHEN** um provider está configurado mas sem credenciais
- **THEN** seus modelos não aparecem na lista

#### Scenario: Modelo desabilitado
- **WHEN** um modelo está desabilitado ou com status diferente de ativo no OpenCode
- **THEN** ele não aparece na lista nem pode ser selecionado

### Requirement: Resolução estrita de modelo
O sistema SHALL resolver o campo `model` de uma request para exatamente um modelo do OpenCode, e MUST retornar erro em vez de escolher silenciosamente quando não houver correspondência única.

#### Scenario: ID completo
- **WHEN** a request usa `model: "anthropic/claude-sonnet-4"` e ele existe
- **THEN** a request é atendida com esse modelo

#### Scenario: ID sem provider único
- **WHEN** a request usa um ID sem provider que existe em mais de um provider
- **THEN** o sistema responde `400` com `code: "model_ambiguous"` listando os candidatos

#### Scenario: Modelo inexistente
- **WHEN** a request usa um modelo que não existe
- **THEN** o sistema responde `404` com `code: "model_not_found"`

### Requirement: Modelo padrão
O sistema SHALL usar o modelo padrão do OpenCode quando a request não informar `model`.

#### Scenario: Sem model
- **WHEN** a request omite `model`
- **THEN** a request é atendida com o modelo padrão do OpenCode
