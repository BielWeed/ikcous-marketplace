# Estado verificado localmente — 18/09/2026

> Retrato conferido no disco em **18/09/2026** (instalação da Galeria ZCode,
> execução `47ff36b7ffc14b56922feda1145a18f8`). Tudo abaixo foi medido, não
> copiado de outro documento. Se você está lendo isto muito depois, refaça as
> medições antes de decidir qualquer coisa.

## Git

- Repositório: **sim** (a cópia local É um repo — o que contradiz qualquer
  aviso em contrário).
- Branch atual: `claude/app-major-upgrade-wmc8x2` (base `develop`, PR #624 em
  rascunho segundo o bastão de 17/09 — ver
  [`00-LEIA-PRIMEIRO`](../superpowers/passagem/2026-09-17-super-atualizacao/00-LEIA-PRIMEIRO.md)).
- Remote: `origin` → `https://github.com/BielWeed/ikcous-marketplace.git`.
- Árvore de trabalho: limpa em 18/09/2026, exceto `.zcode/` (da Galeria ZCode,
  não é conteúdo do projeto) e `relatorio-instalacao.json` (registro da
  galeria) — ambos deliberadamente **fora do commit**.
- Hooks do lefthook **não estavam instalados** nesta cópia (`.git/hooks` só com
  samples) e `node_modules` **não existia** — ou seja: secretlint/commitlint não
  rodam aqui até alguém rodar `npm ci` + `lefthook install`. Commit feito sem
  `--no-verify` porque não havia hook ativo; conteúdo commitado é markdown sem
  segredo, conferido a olho.

## Contagens medidas (18/09/2026)

| O quê | Valor medido | Observação |
| --- | --- | --- |
| Arquivos `.sql` em `supabase/migrations/` | **155** | o `AGENTS.md` cita "105 migrations casadas no ledger" — as duas contagens medem coisas diferentes (arquivos no disco × estado do ledger); para decisão de migration, vale o ledger/ADR 0002 |
| Edge functions em `supabase/functions/` | **12** + `_shared` | `calculate-shipping`, `credenciais-mercado-pago`, `criar-pagamento`, `estornar-pagamento`, `melhor-envio-etiqueta`, `notify-new-order`, `reconciliar-pagamentos`, `send-order-confirmation`, `send-order-whatsapp`, `send-otp-email`, `send-push`, `webhook-mercadopago` |
| Hooks em `src/hooks/` | **45** | — |
| Contexts em `src/contexts/` | **6** | `AuthContext`, `CartContext`, `FavoritesContext`, `NotificationContext`(+`NotificationContextCore`), `StoreContext` |
| Views em `src/views/` | 3 pastas | `admin`, `customer`, `shared` |
| Versão do app (`package.json`) | **1.35.0** | — |

## Verificação (CI) — comandos oficiais

A ordem que o CI roda está no `AGENTS.md` ("Verificação"); os scripts estão em
`package.json` e batem com ele (`typecheck`, `test` = `test:edge` + `test:unit`
+ `test:front`, `build`, `lint:links`, `lint:ratchet`, `size`). Nesta cópia,
**nenhum desses comandos rodou** em 18/09/2026 (faltava `npm ci`) — não cite
"verde" daqui sem rodar.

*Fontes: `git rev-parse`/`git remote -v`/`git status`, `ls` das pastas citadas,
`package.json` lido via node. Medição única, 18/09/2026.*
