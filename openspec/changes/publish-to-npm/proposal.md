## Why

O plugin só pode ser usado apontando para o diretório do repositório, o que impede instalá-lo pelo pacote oficial no npm. Queremos publicá-lo como `opencode-as-openai` (o nome `opencode-bridge` já está ocupado) e automatizar a publicação a cada release, sem guardar tokens de longa duração.

## What Changes

- Renomear o pacote de `opencode-bridge` para `opencode-as-openai` (`package.json`, README, exemplos de instalação).
- Completar os metadados de publicação no `package.json`: `files`, `license`, `repository`, `keywords`, `publishConfig`.
- Adicionar um workflow do GitHub Actions que, ao publicar um GitHub Release, roda typecheck e testes e publica no npm via Trusted Publishing (OIDC), com provenance.
- A versão publicada vem da tag do release (`v0.1.1` → `0.1.1`), sem bump manual no `package.json`.
- Primeiro publish (`0.1.0`) feito manualmente, pois o npm exige que o pacote exista antes de configurar o trusted publisher.
- Atualizar o README para instalação via npm.

## Capabilities

### New Capabilities
- `npm-release`: publicação do pacote no npm, incluindo conteúdo do tarball, nome/metadados e pipeline automático disparado por release.

### Modified Capabilities
<!-- Nenhuma: o comportamento do plugin não muda. -->

## Impact

- `package.json`: nome, metadados, `files`, `publishConfig`.
- `README.md`: seção de instalação e nome do projeto.
- Novo `.github/workflows/publish.yml`.
- Configuração externa (fora do repo): trusted publisher no npmjs.com e, opcionalmente, renomear o repositório no GitHub (o `repository` do trusted publisher precisa bater com o nome real).
- Sem mudanças no código em `src/` nem nos specs de comportamento existentes.
