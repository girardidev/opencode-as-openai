## ADDED Requirements

### Requirement: Package identity
O pacote SHALL ser publicado no npm com o nome `opencode-as-openai` e SHALL declarar `license`, `repository` e `keywords` no `package.json`.

#### Scenario: Nome e metadados
- **WHEN** o `package.json` é lido
- **THEN** `name` é `opencode-as-openai` e `license`, `repository` e `keywords` estão preenchidos

### Requirement: Tarball contents
O tarball publicado SHALL conter apenas os arquivos necessários para executar o plugin: `index.ts`, `src/`, `README.md` e `LICENSE`.

#### Scenario: Conteúdo do pacote
- **WHEN** `npm pack --dry-run` é executado
- **THEN** a lista de arquivos inclui `index.ts`, `src/**`, `README.md` e `LICENSE`
- **AND** não inclui `test/`, `.beans/`, `openspec/`, `graphify-out/` nem `.github/`

### Requirement: Automated publish on release
O sistema SHALL publicar o pacote no npm automaticamente quando um GitHub Release é publicado.

#### Scenario: Release estável
- **WHEN** um GitHub Release com tag `vX.Y.Z` é publicado
- **THEN** o workflow publica `opencode-as-openai@X.Y.Z` no npm com a dist-tag `latest`

#### Scenario: Pré-release
- **WHEN** um GitHub Release marcado como pré-release é publicado
- **THEN** o workflow publica a versão com a dist-tag `next` e não altera `latest`

### Requirement: Version derived from tag
A versão publicada SHALL ser derivada da tag do release, sem exigir bump prévio do `package.json`.

#### Scenario: Tag válida
- **WHEN** a tag do release é `v1.2.3`
- **THEN** a versão publicada é `1.2.3`

#### Scenario: Tag inválida
- **WHEN** a tag do release não é uma versão semver válida
- **THEN** o workflow falha antes de qualquer publicação

### Requirement: Quality gate before publish
O workflow SHALL executar typecheck e testes antes de publicar e SHALL abortar a publicação se qualquer um falhar.

#### Scenario: Teste falhando
- **WHEN** `bun test` falha durante o workflow de release
- **THEN** nenhum pacote é publicado e o workflow termina com falha

### Requirement: Tokenless authentication with provenance
O workflow SHALL autenticar no npm via Trusted Publishing (OIDC), sem usar `NPM_TOKEN` ou outro segredo de longa duração, e SHALL publicar com provenance.

#### Scenario: Publicação autenticada por OIDC
- **WHEN** o workflow publica o pacote
- **THEN** a autenticação usa o token efêmero do GitHub (`id-token: write`)
- **AND** nenhum segredo de npm é lido dos secrets do repositório
- **AND** o pacote publicado exibe provenance no npm

### Requirement: Installation documentation
O README SHALL documentar a instalação via npm usando o nome `opencode-as-openai`.

#### Scenario: Instruções de instalação
- **WHEN** um usuário lê a seção de instalação do README
- **THEN** ela mostra como declarar `opencode-as-openai` em `plugins` do `opencode.json`
