## Context

O plugin é carregado pelo OpenCode v2 a partir de um `index.ts` na raiz (que reexporta `src/index.ts`); não existe etapa de build. O README hoje instrui apontar para o diretório do repositório. O repositório fica em `git@github.com:girardidev/opencode-bridge.git`, e o nome npm `opencode-bridge` já está ocupado. Trusted Publishing do npm exige que o pacote já exista no registro antes de configurar o publisher.

## Goals / Non-Goals

**Goals:**
- Publicar como `opencode-as-openai` e permitir instalação pelo npm.
- Publicação automática a cada GitHub Release, sem segredos de longa duração.
- Tarball enxuto, contendo só o necessário para o plugin rodar.

**Non-Goals:**
- Etapa de build/transpilação (o OpenCode carrega o `.ts` direto).
- Changelog automático, semantic-release ou bump de versão por PR.
- Mudanças no comportamento do plugin.

## Decisions

**Trusted Publishing (OIDC) em vez de `NPM_TOKEN`.** O job pede um token efêmero ao GitHub (`permissions: id-token: write`) e o npm o aceita para o par repo + workflow configurado. Não há segredo para vazar ou renovar, e o pacote sai com provenance. Alternativa descartada: `NPM_TOKEN` nos secrets, mais simples mas de longa duração.

**Versão vinda da tag do release.** O workflow remove o prefixo `v` da tag e roda `npm version <x.y.z> --no-git-tag-version` antes de publicar, então o `package.json` do repositório não precisa ser bumpado à mão. Se a tag não for semver válido, o job falha antes de publicar. Alternativa descartada: exigir que tag e `package.json` coincidam, o que obriga um commit de bump antes de cada release.

**Disparo em `release: published`.** Pré-releases (`prerelease: true`) publicam com `--tag next` para não virar `latest`. Alternativa: disparar em push de tag, mas o release é o gesto que o usuário já pretende fazer.

**Gate de qualidade antes do publish.** `bun install --frozen-lockfile`, `bun run typecheck` e `bun test` rodam no mesmo job; falha em qualquer um aborta o publish.

**Publicar com `npm publish` no Node, instalar com Bun.** Trusted Publishing é suportado pelo npm CLI (>= 11.5.1, Node >= 22.14); o Bun não faz o handshake OIDC. O job usa `actions/setup-node` para publicar e `oven-sh/setup-bun` para instalar e testar.

**Allowlist via `files`.** `files: ["index.ts", "src", "README.md", "LICENSE"]` evita publicar `test/`, `.beans/`, `graphify-out/`, `openspec/` etc. Alternativa `.npmignore` descartada por ser blocklist e frágil.

**Metadados.** `license` (MIT), `repository` apontando para o repo no GitHub (deve coincidir exatamente com o que o trusted publisher valida), `keywords`, `publishConfig: { access: "public", provenance: true }`.

**Primeiro publish manual.** `0.1.0` publicado do terminal para criar o pacote; em seguida configura-se o trusted publisher no npmjs.com (repo, workflow `publish.yml`). Releases subsequentes são totalmente automáticos.

## Risks / Trade-offs

- [Nome do repositório no GitHub diferente do campo `repository`] → renomear o repo para `opencode-as-openai` antes de configurar o trusted publisher, que precisa bater com o nome real do repo.
- [Pacote publicado com `.ts` sem build pode não ser aceito por todas as versões do OpenCode] → validar instalando o tarball (`npm pack`) num projeto de teste antes do primeiro publish.
- [Publish irreversível: versões não podem ser reaproveitadas] → gate de typecheck/test no CI e `npm pack --dry-run` na verificação manual do primeiro publish.
- [Tag malformada ou release criado por engano publica versão ruim] → validação de semver na tag; remediação é `npm deprecate` e novo release.

## Migration Plan

1. Aplicar mudanças no repositório (rename, metadados, workflow, README).
2. Conferir o tarball com `npm pack --dry-run` e testar a instalação local.
3. `npm publish` manual de `0.1.0`.
4. Configurar o trusted publisher no npmjs.com.
5. Criar um release `v0.1.1` para validar o pipeline de ponta a ponta.

Rollback: `npm deprecate` na versão problemática e novo release corrigido; `npm unpublish` só dentro da janela permitida pelo npm.

## Decisões confirmadas

- Licença: MIT.
- O repositório no GitHub será renomeado para `opencode-as-openai`; `repository` no `package.json` e o `origin` local usam o novo nome. O GitHub redireciona a URL antiga, mas o trusted publisher deve ser configurado com o nome novo.

## Open Questions

Nenhuma.
