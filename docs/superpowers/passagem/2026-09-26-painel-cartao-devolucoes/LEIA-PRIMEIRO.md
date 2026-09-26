# Passagem 26/09/2026 — painel (Início, CRM, Financeiro), cartão pelo app, devoluções

Pausa urgente por cota. Este arquivo é o ponto de partida da próxima sessão.
PR: BielWeed/ikcous-marketplace#666 (rascunho), branch
`claude/pensive-mendel-b1fnuu`, base `claude/app-major-upgrade-wmc8x2`.
App de assinantes: BielWeed/ikcous-ecosystem-suite#1 (rascunho), branch
`claude/gestao-de-assinantes` (passagem própria em
`gestao-de-assinantes/docs/passagem/LEIA-PRIMEIRO.md` daquele repositório).

## 1. O que já está no branch (pushado)

- Specs/plano: `docs/superpowers/specs/2026-09-26-*.md`,
  `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`.
- 4 migrations `20261175`–`20261178` (+ rollbacks, testes estáticos, provas
  vivas `tests/banco/*-viva.cjs` isoladas por `tests/banco/rodar-isolado.cjs`
  no `rpc-ci.yml`).
- Edges: cartão pela Orders API (`criar-pagamento`, `webhook-mercadopago`,
  `reconciliar-pagamentos`, `_shared/mercadopago.ts`), etiqueta reversa
  (`melhor-envio-etiqueta`, achados R1–R8 corrigidos em `09afde55`).
- Front: Início (perfil + números + assinatura), Dashboard CRM, Financeiro,
  cartão no checkout + ligar/desligar no painel + CSP, devoluções (cliente,
  painel, política nos ajustes).
- Runbook `docs/runbooks/assinatura-da-loja.md` (quem grava o card do plano).

## 2. O que NÃO pode ir para produção ainda (bloqueios de dinheiro)

Duas revisões de risco independentes deram **NÃO PASSA**. Correções estavam
em andamento em worktrees locais; o que ficou pronto está em `wip/` desta
pasta (ver §4).

**Migrations** (revisor, `20261175`/`20261177`):
- A — reembolso padrão da devolução ignora o cupom (ratear `discount` no
  retrato do item; limitar ao disponível).
- B — `payment_status NULL` passa (lista de bloqueio com `IN`); usar lista de
  permissão com NULL explícito na solicitação, elegibilidade e conclusão.
- H — `admin_devolucao_concluir` não revalida o pedido (saída em dobro com
  estorno manual); recusar se não `delivered`, se pagamento fora da lista, se
  `stock_returned_at` preenchido.
- C — reestoque em dobro (devolução + cancelar entregue → `devolver_estoque`);
  `devolver_estoque` deve descontar `devolucao_itens.reestocado_em`.
- D — esperado do caixa ≠ saldo da conta Caixa (tirar `estornado` do filtro do
  caixa, subtrair estorno externo pela data real).
- E — troco da abertura vira lucro na DRE (categoria `fora_dre`).
- F — `estorno_externo` datado por `updated_at` (usar carimbo real).
- G — reembolso recusado pelo executor (>180 dias) deixa devolução sem saída
  (rota manual + RPC de reemissão).
- K — CMV conta venda cancelada com estoque devolvido.
- R — ordem dos rollbacks (DO que recusa se dependentes existem).
- L — anon lê `updated_by` (grant por coluna; o front do cartão lê colunas
  explícitas `credito,debito,parcelas_max`).
- M — data de entrega cai em `updated_at` (sem fallback).
- Mutantes sem prova: item repetido em `p_itens`, 2ª devolução do mesmo item,
  `- v_devolucoes` do caixa, validação de período da DRE.

**Edges do cartão** (revisor; cartão sai DESLIGADO, mas não pode ser ligado
antes disto):
- A1 — cobrança dupla/órfã: chave por tentativa SEM hash do token
  (`<pedido>:c<n>`); gravar a vaga mesmo com pedido recém-expirado (cai em
  P1); UPDATE perdido → cancelar order `action_required/created` ou logar
  "cartão órfão". Ajustar o teste `criar-pagamento/index_test.ts:~2941`.
- A2 — 3DS não abandonável e não segura a reserva (cancelar order
  `action_required` como no PIX; estender `expires_at` com teto).
- A3 — rota `payment` do webhook troca id para pago/estornado (consultar a
  order gravada antes).
- A4 — todo 400 do MP vira "confira os dados do cartão".
- Endurecimento: sem `payment_method.type`, usar `metodo_online` do banco.
- Harness do revisor (fora do repo, pode ter sumido): reproduzir com banco
  de UPDATE condicional atômico + MP com idempotência por chave.

## 3. CI do PR #666

- **Build e tamanho**: vermelho. Base já em 799,55 kB de 800; o PR soma ~78 kB
  (quase tudo lazy do painel). **Decisão do Gabriel (26/09): dividir o
  portão** — JS que a cliente pode baixar ≤ 800 kB; JS só do painel ≤ 350 kB;
  CSS 100; zxing 400. Classificar pelo grafo real do Rollup (plugin no
  `generateBundle`: raízes = entradas; fronteira = entradas dinâmicas do
  painel — `src/views/admin/**`/AdminArea; BFS sem entrar na fronteira =
  cliente; resto = painel), JSON fora de `dist*`, `.size-limit.cjs` falha
  fechado. Em andamento em `tooling/portao-dividido` (ver `wip/`).
  Medições locais (fixture, brotli por arquivo): base 799,6 kB; head 877,2 kB.
  Build local exige `IKCOUS_CODE_SHA` com o SHA de 40 caracteres.
- **Código x banco (objetos usados)**: vermelho ESPERADO — compara com o
  catálogo de produção; faltam só os objetos das 4 migrations novas (todas as
  anteriores já estão em produção). Fica verde depois de aplicar.
- Resto verde (lint ratchet, Deno edge/unit, front shards, tipos, migrations
  do zero, invariantes, links, segredo).
- Teto de warnings do eslint pode baixar (medido 454 < 457) — abaixar em
  `.lint-baseline.json` no fim.

## 4. Trabalho parcial salvo (`wip/`)

Cada worktree local foi salvo como patch (commits sobre a base +
alterações não commitadas). Para retomar:

```bash
git switch -c fix/migrations-achados claude/pensive-mendel-b1fnuu   # ou a base indicada
git am   docs/superpowers/passagem/2026-09-26-painel-cartao-devolucoes/wip/<nome>-commits.patch
git apply docs/superpowers/passagem/2026-09-26-painel-cartao-devolucoes/wip/<nome>-wip.patch
```

| nome | base | o quê |
|---|---|---|
| `migrations-achados` | `b3a26fbc` | correções A–M das migrations |
| `cartao-edge-achados` | `b3a26fbc` | correções A1–A4 das edges do cartão |
| `portao-dividido` | `03f3eb76` | portão de tamanho dividido |

O estado de cada um (o que ficou pronto e provado) está em
`wip/STATUS.md`.

## 5. Publicação (o Gabriel pediu: "faça tudo isso você")

Só depois de §2 corrigido, revisado de novo e CI verde:
1. Aplicar as 4 migrations pelo workflow `aplicar-migrations.yml`
   (`workflow_dispatch`) — **nunca** `supabase db push`.
2. Depois publicar as functions (`publicar-functions.yml`): `criar-pagamento`,
   `webhook-mercadopago`, `reconciliar-pagamentos`, `melhor-envio-etiqueta`
   e as que usam `_shared/comprovante.ts`. Function antes da migration =
   todo PIX responde 503 (lê `tentativas_de_pagamento`).
3. O cartão continua desligado até o pedido de teste no preview com cartões
   de teste do MP. Risco conhecido: `COEP: credentialless` (vercel.json) pode
   bloquear os iframes do Brick — verificar no preview antes de ligar.

## 6. Pendências menores anotadas

- `AdminLayout` (ponto do sino) não conta devoluções; texto "Tudo em dia" das
  notificações não cita devoluções.
- Abrir devolução a partir do pedido passa o id por variável de módulo (perde
  no reload).
- Foto de devolução órfã se a solicitação for recusada depois do upload.
- Teste `checkout-chave-de-idempotencia-muda-com-o-eixo-do-pagamento` pode
  passar sem exercitar o 2º envio (rejeição 23505 trava o botão) — conferir.
- `AGENTS.md` ainda descreve partes do cartão como código morto — atualizar
  no fim.
- Descrição do PR #666: completar "Como testar", DoD, ordem de deploy, risco
  COEP e o contrato da assinatura.
