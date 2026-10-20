# plugin-hosting Specification

## Purpose
TBD - created by archiving change add-opencode-bridge-mvp. Update Purpose after archive.
## Requirements
### Requirement: Carga como plugin v2
O sistema SHALL ser um plugin do OpenCode v2 (`Plugin.define`) carregável por `plugins` em `opencode.json(c)` ou por `.opencode/plugins/`, e SHALL iniciar o servidor HTTP durante o `setup` sem bloquear a inicialização do OpenCode.

#### Scenario: Plugin declarado no projeto
- **WHEN** o OpenCode é aberto em um projeto cujo `opencode.json` declara o plugin
- **THEN** o servidor HTTP passa a atender na porta configurada e o OpenCode inicia normalmente

#### Scenario: Falha na inicialização do servidor
- **WHEN** o servidor não consegue subir
- **THEN** o erro é registrado em log e o OpenCode continua funcionando sem o bridge

### Requirement: Opções do plugin
O sistema SHALL ler suas opções de `ctx.options` (`host`, `port`, `apiKeys`, `defaultAgent`, `autoApprove`, `keepSessions`, `timeouts`, `corsOrigins`, `logFile`), aplicar padrões seguros (`127.0.0.1`, porta 4010, agent `build`, `autoApprove: "none"`) e MUST rejeitar valores inválidos com mensagem clara sem derrubar o OpenCode.

#### Scenario: Opção inválida
- **WHEN** `port` não é um inteiro válido
- **THEN** o plugin loga o erro de configuração e não sobe o servidor

### Requirement: Servidor único por processo
O sistema SHALL manter um único servidor HTTP por processo OpenCode mesmo que o plugin seja carregado em várias locations, e SHALL encerrá-lo quando a última instância for descarregada.

#### Scenario: Duas locations no mesmo processo
- **WHEN** o plugin é carregado em duas locations do mesmo processo
- **THEN** existe apenas um servidor e ambas as locations ficam registradas

#### Scenario: Descarga da última instância
- **WHEN** a última instância do plugin é descarregada
- **THEN** as turns em andamento são interrompidas, as sessões e tools do bridge são removidas e a porta é liberada

### Requirement: Conflito de porta
O sistema SHALL, quando a porta já estiver ocupada por outro processo, registrar um aviso com a causa e MUST NOT impedir o carregamento do OpenCode.

#### Scenario: Segundo OpenCode aberto
- **WHEN** outro processo OpenCode já usa a porta
- **THEN** o plugin loga o aviso e não sobe um segundo servidor

### Requirement: Seleção da location
O sistema SHALL executar cada request na location do projeto: a indicada pelo header `x-opencode-directory`, se corresponder a uma instância registrada, ou a primeira location registrada.

#### Scenario: Header de diretório
- **WHEN** a request envia `x-opencode-directory` com o diretório de uma instância registrada
- **THEN** a sessão é criada nessa location

#### Scenario: Diretório desconhecido
- **WHEN** o header aponta para um diretório sem instância
- **THEN** o sistema responde `404` com `code: "location_not_found"`

#### Scenario: Caminho com link simbólico
- **WHEN** o header usa um caminho equivalente por link simbólico ao diretório de uma instância (por exemplo `/tmp/x` e `/private/tmp/x`)
- **THEN** a instância correta é selecionada

### Requirement: Logs fora do terminal do OpenCode
O sistema MUST NOT escrever em stdout nem stderr por padrão; os logs SHALL ir para arquivo configurável.

#### Scenario: TUI ativo
- **WHEN** o OpenCode está em modo TUI e o bridge atende requests
- **THEN** nenhuma saída do bridge aparece no terminal do TUI

