# Graph Report - opencode-bridge  (2026-10-20)

## Corpus Check
- 52 files · ~37,275 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 1, .lock 1)

## Summary
- 487 nodes · 1021 edges · 24 communities (19 shown, 5 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 107 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- units.test.ts
- bridge.ts
- fake-host.ts
- OpenCode Bridge
- tasks.md
- .context
- ADDED Requirements
- package.json
- Bridge
- EventMux
- ADDED Requirements
- Hosting
- decode.ts
- compilerOptions
- ADDED Requirements
- .startConversation
- .drive
- ADDED Requirements
- Logger
- proposal.md
- PendingCalls
- opencode-bridge-l9xk--opencode-bridge-mvp-spikes-grupo-1.md
- AGENTS.md

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
10. `Disposable` - 13 edges

## Surprising Connections (you probably didn't know these)
- `6. Chat Completions (texto)` --references--> `FakeHost`  [INFERRED]
  openspec/changes/add-opencode-bridge-mvp/tasks.md → test/fake-host.ts
- `Decisions` --references--> `CanonicalRequest`  [INFERRED]
  openspec/changes/add-opencode-bridge-mvp/design.md → src/core/canonical.ts
- `3. Núcleo e host` --references--> `CanonicalRequest`  [INFERRED]
  openspec/changes/add-opencode-bridge-mvp/tasks.md → src/core/canonical.ts
- `Decisions` --references--> `CanonicalEvent`  [INFERRED]
  openspec/changes/add-opencode-bridge-mvp/design.md → src/core/canonical.ts
- `3. Núcleo e host` --references--> `CanonicalEvent`  [INFERRED]
  openspec/changes/add-opencode-bridge-mvp/tasks.md → src/core/canonical.ts

## Import Cycles
- None detected.

## Communities (24 total, 5 thin omitted)

### Community 0 - "units.test.ts"
Cohesion: 0.07
Nodes (49): Context, Requirement: Entrada tolerante, Requirement: Resposta não-streaming, Scenario: Chat simples, Scenario: Conteúdo em partes, Scenario: Parâmetro desconhecido, Requirement: System prompt do cliente, Scenario: System do cliente (+41 more)

### Community 1 - "bridge.ts"
Cohesion: 0.07
Nodes (37): BridgeConfig, abortReason(), BridgeTool, Conversation, Outstanding, Status, Turn, WRITE_ACTIONS (+29 more)

### Community 2 - "fake-host.ts"
Cohesion: 0.08
Nodes (17): ModelRef, CtxHost, ClientToolDef, ContextDraft, Disposable, HostEvent, ModelInfo, NativeMessage (+9 more)

### Community 3 - "OpenCode Bridge"
Cohesion: 0.06
Nodes (32): Requirement: Opções do plugin, Scenario: Opção inválida, ADDED Requirements, Requirement: Agent padrão, Requirement: Histórico do cliente como contexto nativo, Requirement: Limpeza de sessões, Requirement: Modelo da request, Requirement: Política de permissões sem interface (+24 more)

### Community 4 - "tasks.md"
Cohesion: 0.06
Nodes (29): Open Questions, ADDED Requirements, Requirement: Carga como plugin v2, Requirement: Conflito de porta, Requirement: Logs fora do terminal do OpenCode, Requirement: Seleção da location, Requirement: Servidor único por processo, Scenario: Caminho com link simbólico (+21 more)

### Community 5 - ".context"
Cohesion: 0.06
Nodes (21): Check for context, Ending Discovery, Guardrails, OpenSpec Awareness, The Stance, What You Don't Have To Do, What You Might Do, When a change exists (+13 more)

### Community 6 - "ADDED Requirements"
Cohesion: 0.08
Nodes (23): ADDED Requirements, Requirement: Declaração de tools do cliente, Requirement: Expiração de chamadas pendentes, Requirement: Limpeza das tools do cliente, Requirement: Retomada com o resultado, Requirement: Retomada sem pendência correspondente, Requirement: Tool call do cliente devolvida, Requirement: Tools nativas executam no servidor (+15 more)

### Community 7 - "package.json"
Cohesion: 0.10
Nodes (19): dependencies, ajv, @opencode/plugin, description, devDependencies, openai, @types/bun, typescript (+11 more)

### Community 8 - "Bridge"
Cohesion: 0.17
Nodes (6): Decisions, Goals / Non-Goals, Risks / Trade-offs, Desenvolvimento, Bridge, OpenCodeHost

### Community 9 - "EventMux"
Cohesion: 0.17
Nodes (4): Channel, EventMux, Next, STREAM_LOST

### Community 10 - "ADDED Requirements"
Cohesion: 0.13
Nodes (14): ADDED Requirements, Requirement: Autenticação opcional, Requirement: Cancelamento por desconexão, Requirement: Compatibilidade de rede, Requirement: Keepalive e ausência de timeout ocioso do servidor, Requirement: Logs estruturados, Requirement: Timeouts por fase, Scenario: Chave inválida (+6 more)

### Community 12 - "decode.ts"
Cohesion: 0.37
Nodes (13): GenerationParams, ToolChoice, bad(), decodeChatRequest(), decodeMessages(), decodeParams(), decodeToolCalls(), decodeToolChoice() (+5 more)

### Community 13 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck, strict (+4 more)

### Community 14 - "ADDED Requirements"
Cohesion: 0.17
Nodes (11): ADDED Requirements, Requirement: Listagem de modelos, Requirement: Modelo padrão, Requirement: Resolução estrita de modelo, Scenario: ID completo, Scenario: ID sem provider único, Scenario: Modelo desabilitado, Scenario: Modelo inexistente (+3 more)

### Community 15 - ".startConversation"
Cohesion: 0.22
Nodes (5): buildSystem(), sanitize(), uniqueName(), validationError(), ClientTool

### Community 16 - ".drive"
Cohesion: 0.20
Nodes (4): mapFinish(), num(), safeParse(), Metrics

### Community 17 - "ADDED Requirements"
Cohesion: 0.25
Nodes (7): ADDED Requirements, Requirement: Erros no formato OpenAI, Requirement: Streaming SSE, Scenario: Erro no meio do stream, Scenario: Ordem dos eventos, Scenario: Request inválida, Scenario: Usage incluído

### Community 19 - "proposal.md"
Cohesion: 0.29
Nodes (6): Capabilities, Impact, Modified Capabilities, New Capabilities, What Changes, Why

### Community 21 - "opencode-bridge-l9xk--opencode-bridge-mvp-spikes-grupo-1.md"
Cohesion: 0.50
Nodes (3): Achados parciais (spike), Pivot (decisao do usuario), Summary of Changes

## Knowledge Gaps
- **2 isolated node(s):** `@types/bun`, `typescript`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 181 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `system()` connect `units.test.ts` to `tasks.md`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `OpenCodeHost` (e.g. with `Decisions` and `Risks / Trade-offs`) actually correct?**
  _`OpenCodeHost` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/bun`, `typescript` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `units.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0679563492063492 - nodes in this community are weakly interconnected._
- **Why does `Decisions` connect `Bridge` to `units.test.ts`, `bridge.ts`, `OpenCode Bridge`, `tasks.md`, `.context`, `EventMux`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `FakeHost` (e.g. with `3. Núcleo e host` and `6. Chat Completions (texto)`) actually correct?**
  _`FakeHost` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `bridge.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07043650793650794 - nodes in this community are weakly interconnected._