---
description: Cria a autorização de atualização do Core para propagação aos clientes
argument-hint: <resumo curto da mudança>
---

# Autorização de atualização: $ARGUMENTS

Gera o `.md` que o manager (`manager-claude`) lê para propagar esta mudança do Core aos clones de cliente.

## 1. Levantar o que mudou
```
git status --short
git diff --name-only
git log --oneline -5
```
Use os caminhos **relativos à raiz do projeto**, com barra normal (`src/components/...`).

**Não liste** arquivos que nunca são sincronizados (a verificação do manager os ignora ou vai marcar tudo como divergente):
- `.env*`, `vercel.json`, `supabase/config.toml`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`
- arquivos de marca: `src/config/branding.json`, `public/branding/logo.png`, `public/branding/favicon.ico`, `public/logo.svg`, `public/favicon.ico`

Se a mudança **exigir** ajuste em algum desses (ex.: nova origem no CSP do `vercel.json`, variável nova no `.env`), não coloque em `files_modified` — escreva como passo manual no corpo das instruções.

## 2. Criar o arquivo
Caminho e nome exatos:
```
C:/Users/Gabriel/Documents/software Gerenciador ecossistema ikcous/projects/authorizations/auth_<YYYYMMDD>_<HHMM>_<slug_snake_case>.md
```

Formato (o parser é regex, mantenha exatamente estas chaves e a indentação de 2 espaços nas listas):
```markdown
---
title: "<título curto e descritivo>"
source_project: "Original"
created_at: "YYYY-MM-DD HH:MM"
description: "<1-2 frases: o que mudou e por quê>"
files_modified:
  - "src/caminho/Arquivo.tsx"
  - "supabase/migrations/20260716000000_algo.sql"
applied_projects:
  - "Original"
---
# Instruções de Atualização para o Super Agente

1. <passo concreto, citando arquivo e o que procurar/substituir>
2. <passo concreto>
3. <passos manuais que o sync NÃO faz — ver seção 3 abaixo>
4. Rodar `npx biome check . && npx tsc -b` no projeto de destino.
```

Observações do formato:
- `source_project` é sempre `"Original"` (nome do Core em `manager-claude/projects.json`).
- `applied_projects` começa só com `"Original"` — os clientes entram conforme forem aplicados.
- Listas vazias se escrevem inline: `files_modified: []`.

## 3. Passos manuais obrigatórios no corpo (se aplicável)
O motor de sync copia arquivo por MD5 e não faz nada disso — precisa estar escrito nas instruções:
- **Migration nova**: rodar/aplicar no Supabase **daquele cliente** e regerar `src/types/database.types.ts` com o project_ref dele.
- **Host externo novo** (fonte, CDN, API, imagem): adicionar ao CSP do `vercel.json` do cliente — esse arquivo nunca é sincronizado, a correção **não** chega sozinha.
- **Variável de ambiente nova**: adicionar ao `.env.example` (no mesmo commit do Core) e ao `.env` do cliente.
- **Dependência nova**: `npm install` no cliente + conferir `npx size-limit`.
- **Bump de versão**: fazer pelo manager, não à mão.

## 4. Script de verificação (opcional, mas recomendado quando a mudança não é 1:1 de arquivo)
Crie `auth_<mesmo_nome_base>.py` na mesma pasta (ou em `authorizations/scripts/`). Ele recebe o caminho do projeto de destino em `sys.argv[1]`, tem 10s de timeout e deve sair com código **0 se a mudança está aplicada** e ≠0 caso contrário (o stderr vira o motivo da divergência).

Sem script, a verificação é comparação de conteúdo normalizado dos `files_modified` entre Core e cliente — ou seja: qualquer arquivo que legitimamente difira por cliente **não pode** estar nessa lista.

## 5. Conferir
De dentro de `manager-claude/`:
```
python cli.py auth
```
A nova autorização deve aparecer com título, data e a lista de projetos. Antes de propagar de fato:
```
python cli.py diff "SR Tudo10"
python cli.py sync "SR Tudo10" --dry-run
```
