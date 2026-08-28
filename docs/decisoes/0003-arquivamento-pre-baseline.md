# ADR 0003 — Arquivar as migrations pré-baseline para o banco zerado subir

**Status:** Aceito (execução em revisão — PR `infra/passo0-arquivo-pre-baseline`)
**Data:** 28/08/2026
**Decisor:** Gabriel (direção de 28/08: "siga desenvolvimento… vender nossa assinatura
para o primeiro lojista o mais rápido possível", com autonomia concedida) · Parecer
conjunto GLM+Claude de 25/08 ("passo 0") · Revisão técnica do Claude pendente no PR
**Depende de:** ADR 0002 · Resolve a parte que faltava (§ "O que ainda falta") e o
pedido 001 do workspace do Gerenciador

---

## Contexto

O ADR 0002 criou o baseline e deixou declarado: *um banco zerado rodaria as 98
históricas e depois o baseline, e colidiria*. O Gerenciador formalizou isso como
pedido 001 — sem banco novo não existe entrega de loja nova. Em 25/08 o parecer
conjunto fixou o arquivamento como **passo 0**. Em 28/08 o Gabriel mandou executar
com prioridade.

## Decisão

**1. As 99 migrations pré-baseline vão para `supabase/migrations/_arquivadas/`** com
`git mv` (padrão do ADR 0002; o histórico sobrevive). São 98 históricas + **1 backfill
de dados** descoberto na execução:

- `20260807000002_backfill_pedidos_abandonados.sql` — backfill one-shot de
  06/08/2026 com **contagens hardcoded** ("esperava 13 pedidos e 33 unidades"):
  aborta sozinho em qualquer banco que não seja o de desenvolvimento. É operação
  de dados, não schema; numa loja nova não tem o que fazer.

**2. Dois consertos de EXECUÇÃO no baseline** (o arquivo jamais tinha sido
executado; foi registrado no ledger por `migration repair`):

- Removidas `\restrict <token>` / `\unrestrict <token>` (linhas 68 e 5935) —
  meta-comandos do **psql** que o `pg_dump` do PG 17.6 passou a emitir; qualquer
  runner que mande o texto ao servidor como SQL engasga em `syntax error at or
  near "\"`.
- `CREATE SCHEMA public;` → `CREATE SCHEMA IF NOT EXISTS public;` — todo banco
  novo já nasce com `public`; sem `IF NOT EXISTS` o baseline colide na linha 88.

Nenhum SQL novo foi escrito; nenhuma migration nova; nada foi aplicado em banco
de verdade.

## Prova (tudo colado no PR)

1. **Controle negativo — o estado antes NÃO sobe.** Com os 142 arquivos na raiz, o
   banco zerado quebra na `20260218000000_optimize_admin_queries.sql` (4ª da ordem)
   com `relation "public.marketplace_orders" does not exist` (42P01): dependência
   invertida entre históricas — a colisão com o baseline viria depois. O defeito do
   pedido 001 é pior do que descrito, e o arquivamento o elimina inteiro.
2. **Depois: `ZERADO_SOBE` (exit 0).** Ferramenta nova versionada
   `scripts/db-prove-banco-zerado.cjs`: cria banco descartável **no mesmo servidor**
   (o papel tem CREATEDB; o nome único e o `DROP DATABASE … WITH (FORCE)` no fim são
   a contenção — autocommit, como o CLI), instala as extensões do dev, reproduz o
   provisionamento de fábrica do Supabase que o baseline valida (`auth.uid()`,
   `auth.role()`, `auth.users` com id/email/phone — medido: `auth.users` e `realtime`
   só aparecem em corpo de função e comentário), e aplica a raiz inteira. Resultado:
   **40/43 aplicados, 32 tabelas, 72 policies, 74 funções** — bate com o dev
   (32/72). 3 arquivos são PULADOS com aviso por dependerem de `pg_cron`, que só
   instala no banco de nome `postgres` (hardcode da extensão); na entrega real o CLI
   aplica no banco `postgres` do projeto novo, onde a extensão existe de fábrica.
3. **`supabase migration list` contra o banco real (a loja que vende):** 43 casadas,
   127 só-remote (= 99 movidas + 28 perdidas do ADR 0002). O remote não muda — nada
   foi aplicado nele.
4. **Invisibilidade da subpasta:** o CLI só enxerga a raiz (43); o reconciliador usa
   `readdirSync` não-recursivo; **zero** glob recursivo (`**/*.sql`/walk) em
   `scripts/`, `tests/`, `.github/`.

## Consequências

- **NUNCA rodar `supabase migration repair`** para "limpar" as 127 linhas
  só-remote: o remote é a loja que vende; reescrever o ledger dele é destruição.
  O estado é esperado e permanente, mesma classe das 28 do ADR 0002.
- `scripts/db-reconcilia-ledger.cjs` passa a acusar 127 "sem arquivo" (era 28):
  esperado, não defeito.
- 12 referências históricas a arquivos movidos (5 no mapa `VERIFICACOES` do
  `db-apply.cjs`, 7 em `db-prove-*`/`db-inspect-*` antigos): instrumentos de
  consertos já aplicados; sem efeito no fluxo novo.
- **Nota para quem aplicar migrations na mão:** o baseline deixa
  `search_path = ''` na sessão (`set_config` do pg_dump moderno). Quem aplicar
  baseline + outros na MESMA sessão precisa re-SETAR o search_path entre arquivos;
  o CLI real não sofre disso (sessão por migration). A ferramenta de prova emula.
- O caminho de criação de banco de loja nova deixa de ser bloqueado (pedido 001
  do Gerenciador): `baseline + 42 posteriores`, na ordem de timestamp, sobem.

## Desacordo registrado

Nenhum. O Claude endossou com seis travas (mesa `20260828-0637`), todas cumpridas
na execução; a revisão dele do PR é condição de merge.
