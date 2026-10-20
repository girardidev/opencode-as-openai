---
# opencode-bridge-et3c
title: 'OpenCode Bridge MVP: implementacao (grupos 2-8)'
status: completed
type: feature
priority: normal
created_at: 2026-10-20T15:41:34Z
updated_at: 2026-10-20T16:01:17Z
---

Implementa os grupos 2 a 8 de openspec/changes/add-opencode-bridge-mvp/tasks.md.

- [x] G2 projeto e infra
- [x] G3 nucleo e host
- [x] G4 hospedagem
- [x] G5 modelos
- [x] G6 chat completions texto
- [x] G7 ciclo de vida
- [x] G8 tool calling hibrido
- [x] G9 soak, metricas, custo de contexto
- [x] G10 integracao real (10.1) e README (10.3)


## Summary of Changes
Plugin OpenCode v2 implementado em src/ (protocols/openai-chat, core, opencode, http, hosting). 94 testes (unidade, soak de 300 conversas, HTTP + SDK openai com host simulado) + 7 testes de integracao contra OpenCode real com modelo real (texto, stream, tool nativa, tools do cliente paralelas com retomada). Achados: carga por diretorio exige index.ts na raiz; campo de geracao e maxTokens. Pendente: 10.2 validacao manual com pen.dev/Cursor.
