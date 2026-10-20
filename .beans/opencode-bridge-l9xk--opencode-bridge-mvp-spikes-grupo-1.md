---
# opencode-bridge-l9xk
title: 'OpenCode Bridge MVP: spikes (grupo 1)'
status: completed
type: task
priority: normal
created_at: 2026-10-20T15:01:07Z
updated_at: 2026-10-20T15:29:46Z
---

Implementa o grupo 1 de openspec/changes/add-opencode-bridge-mvp/tasks.md (spikes S1-S5 + fixtures).

- [x] S1 system do cliente (hook context)
- [x] S2 tool in-process suspensa (240s ok)
- [x] S3 paralelas: tool.called ate step.streamed
- [x] S4 historico nativo via e.messages
- [x] S5 interrupt com execute suspenso
- [x] S6 hospedagem (singleton, porta, SIGTERM)
- [x] S7 options de geracao via hook
- [x] S8 permissao via permission.hook
- [x] fixtures (test/fixtures)
- [x] atualizar design/specs/tasks

## Achados parciais (spike)
- OpenCode instalado e v2.1.1: API em /api/* (nao /session). Auth basic usuario opencode; spec OpenAPI nao esta num path obvio (docs: opencode.ai/v2/docs/api).
- Prompt v2 (POST /api/session/{id}/prompt): text, files, agents, skills, metadata. NAO tem tools map nem system por prompt; modelo/agent por sessao (create / switchModel / switchAgent).
- POST /api/generate e stateless, so texto (prompt, model), sem tools.
- Candidatos novos: session/import (semear transcript = S3), /synthetic, /session/{id}/instructions/entries, PUT /api/mcp/{server}, DELETE /api/mcp/{server} (desregistro EXISTE, derruba a necessidade do pool de slots), /api/session/{id}/interrupt, GET /api/event.
- /api/agent com location vazio listou 'build' (agentes vem da config global do usuario).
- Nenhuma sessao criada nos testes; servidor de teste (porta 4199) encerrado.


## Pivot (decisao do usuario)
Bridge passa a ser PLUGIN do OpenCode v2 (somente v2), contexto do projeto herdado, agent build, tools hibridas (nativas no servidor, do cliente suspensas/retomadas). Artefatos do change reescritos; spikes agora sao contra a API de plugin v2 (tasks grupo 1).


## Summary of Changes
Spikes do grupo 1 concluidos contra OpenCode 2.1.1 com plugin de laboratorio (/tmp/ocb-lab, fora do repo). Resultados no design.md (decisoes D3-D9 marcadas [validado]); fixtures gravadas em test/fixtures/; specs e tasks ajustadas. Pendente apenas verificar logs vs TUI interativo.
