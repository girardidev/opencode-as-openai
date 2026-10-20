## 1. Rename e metadados do pacote

- [x] 1.1 Criar o arquivo `LICENSE` (MIT, titular Victor Girardi, ano 2026)
- [x] 1.2 Em `package.json`: `name` → `opencode-as-openai`, adicionar `license: MIT`, `repository` (`girardidev/opencode-as-openai`), `keywords`, `files` e `publishConfig` (`access: public`, `provenance: true`)
- [x] 1.3 Atualizar o README: nome do projeto, diagrama e seção de instalação via npm (`"plugins": ["opencode-as-openai"]`), mantendo a alternativa de caminho local
- [x] 1.4 Renomear o repositório no GitHub para `opencode-as-openai` (Settings → Rename, ou `gh repo rename opencode-as-openai`) e atualizar o `origin` local com `git remote set-url`

## 2. Workflow de release

- [x] 2.1 Criar `.github/workflows/publish.yml` disparado em `release: published`, com `permissions: contents: read, id-token: write`
- [x] 2.2 Adicionar passos de `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run typecheck` e `bun test`
- [x] 2.3 Adicionar passo que extrai a versão da tag (removendo `v`), valida semver e aplica com `npm version --no-git-tag-version`
- [x] 2.4 Adicionar `actions/setup-node` (Node >= 22.14, registry npmjs) e `npm publish --provenance --access public`, com `--tag next` quando o release for pré-release

## 3. Verificação local

- [x] 3.1 Rodar `npm pack --dry-run` e conferir que o tarball contém só `index.ts`, `src/`, `README.md` e `LICENSE`
- [x] 3.2 Gerar o tarball com `npm pack` e testar a instalação num projeto OpenCode limpo, confirmando que o plugin carrega e responde em `/v1/models`
- [x] 3.3 Rodar `bun run typecheck` e `bun test` após as mudanças

## 4. Publicação e configuração externa

- [x] 4.1 Publicar `0.1.0` manualmente (`npm publish --access public`) para criar o pacote no registro
- [ ] 4.2 No npmjs.com, configurar o Trusted Publisher: GitHub Actions, repositório `girardidev/<repo>`, workflow `publish.yml`
- [ ] 4.3 Criar o release `v0.1.1` no GitHub e verificar que o workflow publica a versão com provenance
- [ ] 4.4 Conferir `npm view opencode-as-openai` e instalar o pacote publicado num projeto de teste
