# Graph Report - opencode-bridge  (2026-10-20)

## Corpus Check
- 64 files · ~42,446 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .lock 1)

## Summary
- 660 nodes · 1195 edges · 44 communities (37 shown, 7 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 120 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1f0cc7c8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- units.test.ts
- server.ts
- fake-host.ts
- opencode-as-openai
- setup
- openspec-explore/SKILL.md
- Requirements
- package.json
- ADDED Requirements
- ADDED Requirements
- Requirements
- bridge.ts
- Requirements
- compilerOptions
- ADDED Requirements
- ADDED Requirements
- Requirement: Listagem de modelos
- ADDED Requirements
- ADDED Requirements
- Requirements
- ADDED Requirements
- opencode-bridge-l9xk--opencode-bridge-mvp-spikes-grupo-1.md
- AGENTS.md
- opencode-bridge-et3c--opencode-bridge-mvp-implementacao-grupos-2-8.md
- .ask
- 2026-10-20-add-opencode-bridge-mvp/tasks.md
- Requirements
- opsx-explore.md
- history.ts
- system
- publish-to-npm/design.md
- 2026-10-20-add-opencode-bridge-mvp/proposal.md
- publish-to-npm/proposal.md
- .port
- 2026-10-20-add-opencode-bridge-mvp/design.md
- publish-to-npm/tasks.md
- ScriptApi
- Requirement: Seleção da location
- Requirement: Limpeza de sessões
- chat-completions Specification
- Requirement: Servidor único por processo
- opencode-bridge-ds92--publicar-opencode-as-openai-no-npm-change-publish.md
- opencode-bridge-ppqz--validar-opencode-bridge-com-pendev-e-cursor-manual.md

## God Nodes (most connected - your core abstractions)
1. `Bridge` - 29 edges
2. `OpenCodeHost` - 25 edges
3. `FakeHost` - 24 edges
4. `BridgeError` - 22 edges
5. `Logger` - 19 edges
6. `Hosting` - 16 edges
7. `CtxHost` - 15 edges
8. `EventMux` - 15 edges
9. `ModelRef` - 14 edges
10. `system()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Risks / Trade-offs` --references--> `OpenCodeHost`  [INFERRED]
  openspec/changes/archive/2026-10-20-add-opencode-bridge-mvp/design.md → src/opencode/host.ts
- `6. Chat Completions (texto)` --references--> `FakeHost`  [INFERRED]
  openspec/changes/archive/2026-10-20-add-opencode-bridge-mvp/tasks.md → test/fake-host.ts
- `Scenario: Conteúdo em partes` --references--> `user()`  [INFERRED]
  openspec/changes/archive/2026-10-20-add-opencode-bridge-mvp/specs/chat-completions/spec.md → test/helpers.ts
- `Scenario: Conteúdo em partes` --references--> `user()`  [INFERRED]
  openspec/specs/chat-completions/spec.md → test/helpers.ts
- `Desenvolvimento` --references--> `Bridge`  [INFERRED]
  README.md → src/core/bridge.ts

## Import Cycles
- None detected.

## Communities (44 total, 7 thin omitted)

### Community 0 - "units.test.ts"
Cohesion: 0.07
Nodes (42): openai, AutoApprove, ConfigError, defaultLogFile(), defaults, isLoopback(), LOOPBACK, parseConfig() (+34 more)

### Community 1 - "server.ts"
Cohesion: 0.10
Nodes (31): BridgeConfig, Turn, GenerationParams, ToolChoice, Usage, toBridgeError(), createServer(), authenticate() (+23 more)

### Community 2 - "fake-host.ts"
Cohesion: 0.06
Nodes (26): Decisions, 3. Núcleo e host, Desenvolvimento, Conversation, CanonicalEvent, CanonicalRequest, FinishReason, ModelRef (+18 more)

### Community 3 - "opencode-as-openai"
Cohesion: 0.20
Nodes (9): Custo de contexto, Instalação, Limitações conhecidas, Multi-instância, Observabilidade, opencode-as-openai, Segurança, Tools: modelo híbrido (+1 more)

### Community 4 - "setup"
Cohesion: 0.40
Nodes (4): 4. Hospedagem do plugin, @opencode/plugin, sharedHosting(), setup()

### Community 5 - "openspec-explore/SKILL.md"
Cohesion: 0.18
Nodes (10): Check for context, Ending Discovery, Guardrails, Handling Different Entry Points, OpenSpec Awareness, The Stance, What You Don't Have To Do, What You Might Do (+2 more)

### Community 6 - "Requirements"
Cohesion: 0.08
Nodes (25): client-tool-calling Specification, Purpose, Requirement: Declaração de tools do cliente, Requirement: Expiração de chamadas pendentes, Requirement: Limpeza das tools do cliente, Requirement: Retomada com o resultado, Requirement: Retomada sem pendência correspondente, Requirement: Tool call do cliente devolvida (+17 more)

### Community 7 - "package.json"
Cohesion: 0.06
Nodes (32): author, bugs, url, dependencies, ajv, @opencode/plugin, description, devDependencies (+24 more)

### Community 8 - "ADDED Requirements"
Cohesion: 0.08
Nodes (23): ADDED Requirements, Requirement: Declaração de tools do cliente, Requirement: Expiração de chamadas pendentes, Requirement: Limpeza das tools do cliente, Requirement: Retomada com o resultado, Requirement: Retomada sem pendência correspondente, Requirement: Tool call do cliente devolvida, Requirement: Tools nativas executam no servidor (+15 more)

### Community 9 - "ADDED Requirements"
Cohesion: 0.11
Nodes (17): ADDED Requirements, Requirement: Automated publish on release, Requirement: Installation documentation, Requirement: Package identity, Requirement: Quality gate before publish, Requirement: Tarball contents, Requirement: Tokenless authentication with provenance, Requirement: Version derived from tag (+9 more)

### Community 10 - "Requirements"
Cohesion: 0.11
Nodes (17): project-context Specification, Purpose, Requirement: Agent padrão, Requirement: Histórico do cliente como contexto nativo, Requirement: Limpeza de sessões, Requirement: Modelo da request, Requirement: Sessão no contexto do projeto, Requirements (+9 more)

### Community 11 - "bridge.ts"
Cohesion: 0.06
Nodes (24): abortReason(), Bridge, BridgeTool, buildSystem(), mapFinish(), num(), Outstanding, safeParse() (+16 more)

### Community 12 - "Requirements"
Cohesion: 0.12
Nodes (16): Purpose, request-lifecycle Specification, Requirement: Autenticação opcional, Requirement: Cancelamento por desconexão, Requirement: Compatibilidade de rede, Requirement: Keepalive e ausência de timeout ocioso do servidor, Requirement: Logs estruturados, Requirement: Timeouts por fase (+8 more)

### Community 13 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck, strict (+4 more)

### Community 14 - "ADDED Requirements"
Cohesion: 0.12
Nodes (15): ADDED Requirements, Requirement: Carga como plugin v2, Requirement: Conflito de porta, Requirement: Logs fora do terminal do OpenCode, Requirement: Seleção da location, Requirement: Servidor único por processo, Scenario: Caminho com link simbólico, Scenario: Descarga da última instância (+7 more)

### Community 15 - "ADDED Requirements"
Cohesion: 0.13
Nodes (14): ADDED Requirements, Requirement: Autenticação opcional, Requirement: Cancelamento por desconexão, Requirement: Compatibilidade de rede, Requirement: Keepalive e ausência de timeout ocioso do servidor, Requirement: Logs estruturados, Requirement: Timeouts por fase, Scenario: Chave inválida (+6 more)

### Community 16 - "Requirement: Listagem de modelos"
Cohesion: 0.14
Nodes (13): model-catalog Specification, Purpose, Requirement: Listagem de modelos, Requirement: Modelo padrão, Requirement: Resolução estrita de modelo, Requirements, Scenario: ID completo, Scenario: ID sem provider único (+5 more)

### Community 17 - "ADDED Requirements"
Cohesion: 0.15
Nodes (12): ADDED Requirements, Requirement: Agent padrão, Requirement: Histórico do cliente como contexto nativo, Requirement: Modelo da request, Requirement: Sessão no contexto do projeto, Scenario: Agent inexistente, Scenario: Agent padrão, Scenario: Conversa com histórico (+4 more)

### Community 18 - "ADDED Requirements"
Cohesion: 0.17
Nodes (11): ADDED Requirements, Requirement: Listagem de modelos, Requirement: Modelo padrão, Requirement: Resolução estrita de modelo, Scenario: ID completo, Scenario: ID sem provider único, Scenario: Modelo desabilitado, Scenario: Modelo inexistente (+3 more)

### Community 19 - "Requirements"
Cohesion: 0.17
Nodes (12): Requirement: Entrada tolerante, Requirement: Erros no formato OpenAI, Requirement: Resposta não-streaming, Requirement: Streaming SSE, Requirements, Scenario: Chat simples, Scenario: Conteúdo em partes, Scenario: Erro no meio do stream (+4 more)

### Community 20 - "ADDED Requirements"
Cohesion: 0.18
Nodes (10): ADDED Requirements, Requirement: Entrada tolerante, Requirement: Erros no formato OpenAI, Requirement: Streaming SSE, Scenario: Conteúdo em partes, Scenario: Erro no meio do stream, Scenario: Ordem dos eventos, Scenario: Parâmetro desconhecido (+2 more)

### Community 21 - "opencode-bridge-l9xk--opencode-bridge-mvp-spikes-grupo-1.md"
Cohesion: 0.50
Nodes (3): Achados parciais (spike), Pivot (decisao do usuario), Summary of Changes

### Community 24 - ".ask"
Cohesion: 0.25
Nodes (10): Requirement: Política de permissões sem interface, Scenario: Auto-aprovação de edição, Scenario: Modo somente leitura, Scenario: Permissão negada por padrão, Scenario: Regra já permitida, Requirement: Política de permissões sem interface, Scenario: Auto-aprovação de edição, Scenario: Modo somente leitura (+2 more)

### Community 25 - "2026-10-20-add-opencode-bridge-mvp/tasks.md"
Cohesion: 0.22
Nodes (8): 10. Aceitação e documentação, 1. Spikes de validação (gate do desenho), 2. Projeto e infraestrutura, 5. Catálogo de modelos, 6. Chat Completions (texto), 7. Ciclo de vida e segurança, 8. Tool calling híbrido, 9. Estabilidade em sessões longas

### Community 26 - "Requirements"
Cohesion: 0.18
Nodes (10): plugin-hosting Specification, Purpose, Requirement: Carga como plugin v2, Requirement: Conflito de porta, Requirement: Logs fora do terminal do OpenCode, Requirements, Scenario: Falha na inicialização do servidor, Scenario: Plugin declarado no projeto (+2 more)

### Community 27 - "opsx-explore.md"
Cohesion: 0.20
Nodes (9): Check for context, Ending Discovery, Guardrails, OpenSpec Awareness, The Stance, What You Don't Have To Do, What You Might Do, When a change exists (+1 more)

### Community 28 - "history.ts"
Cohesion: 0.28
Nodes (7): CanonicalMessage, ToolCall, CONTINUE_PROMPT, parseArgs(), toNativeMessages(), toolResult(), NativeMessage

### Community 29 - "system"
Cohesion: 0.32
Nodes (8): Requirement: Resposta não-streaming, Scenario: Chat simples, Requirement: System prompt do cliente, Scenario: System do cliente, Requirement: System prompt do cliente, Scenario: System do cliente, Parâmetros suportados, system()

### Community 30 - "publish-to-npm/design.md"
Cohesion: 0.25
Nodes (7): Context, Decisions, Decisões confirmadas, Goals / Non-Goals, Migration Plan, Open Questions, Risks / Trade-offs

### Community 32 - "2026-10-20-add-opencode-bridge-mvp/proposal.md"
Cohesion: 0.29
Nodes (6): Capabilities, Impact, Modified Capabilities, New Capabilities, What Changes, Why

### Community 33 - "publish-to-npm/proposal.md"
Cohesion: 0.29
Nodes (6): Capabilities, Impact, Modified Capabilities, New Capabilities, What Changes, Why

### Community 34 - ".port"
Cohesion: 0.47
Nodes (5): Requirement: Opções do plugin, Scenario: Opção inválida, Requirement: Opções do plugin, Scenario: Opção inválida, Opções (`options` do plugin)

### Community 35 - "2026-10-20-add-opencode-bridge-mvp/design.md"
Cohesion: 0.40
Nodes (4): Context, Goals / Non-Goals, Open Questions, Risks / Trade-offs

### Community 36 - "publish-to-npm/tasks.md"
Cohesion: 0.40
Nodes (4): 1. Rename e metadados do pacote, 2. Workflow de release, 3. Verificação local, 4. Publicação e configuração externa

### Community 38 - "Requirement: Seleção da location"
Cohesion: 0.50
Nodes (4): Requirement: Seleção da location, Scenario: Caminho com link simbólico, Scenario: Diretório desconhecido, Scenario: Header de diretório

### Community 39 - "Requirement: Limpeza de sessões"
Cohesion: 0.67
Nodes (3): Requirement: Limpeza de sessões, Scenario: Cancelamento, Scenario: Manter sessões

### Community 41 - "Requirement: Servidor único por processo"
Cohesion: 0.67
Nodes (3): Requirement: Servidor único por processo, Scenario: Descarga da última instância, Scenario: Duas locations no mesmo processo

## Knowledge Gaps
- **2 isolated node(s):** `@types/bun`, `typescript`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 287 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `system()` connect `system` to `units.test.ts`, `2026-10-20-add-opencode-bridge-mvp/design.md`, `Requirements`, `ADDED Requirements`, `2026-10-20-add-opencode-bridge-mvp/tasks.md`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `OpenCodeHost` (e.g. with `Decisions` and `Risks / Trade-offs`) actually correct?**
  _`OpenCodeHost` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/bun`, `typescript` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `units.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07475678443420379 - nodes in this community are weakly interconnected._
- **Why does `setup()` connect `setup` to `2026-10-20-add-opencode-bridge-mvp/tasks.md`, `fake-host.ts`, `Requirements`, `ADDED Requirements`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `FakeHost` (e.g. with `3. Núcleo e host` and `6. Chat Completions (texto)`) actually correct?**
  _`FakeHost` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `server.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09696969696969697 - nodes in this community are weakly interconnected._