# Como o app funciona — resumo navegável

> Condensado em 18/09/2026 a partir do `AGENTS.md` (reescrito em 12/09/2026) e
> do `README.md`. Este arquivo é um **índice comentado**: o detalhe normativo
> mora no `AGENTS.md`; se este texto divergir dele, o `AGENTS.md` manda.

## O produto

Marketplace PWA (instalável, offline-first, Web Push) da loja do Gabriel em
Monte Carmelo/MG: catálogo com estoque imediato, checkout com **PIX via Mercado
Pago**, painel admin do lojista, Q&A e avaliações. Versão em 18/09/2026: 1.35.0.

## Papéis e acesso (RLS)

- O papel mora em `profiles.role` (CHECK `admin | gerente | vendedor | customer`).
  **Lojista = staff**; `admin` manda (`is_admin()`, SECURITY DEFINER, porta do
  painel — o front espelha via RPC com cache).
- `public_profiles` é a projeção pública de perfil.
- Pedidos: RLS `auth.uid() = user_id` — **convidado não vê pedido nenhum sem OTP**.
- OTP de convidado: por e-mail, amarrado a **UM pedido** (e-mail + whatsapp +
  fragmento do id), 15 min, 1 envio por pedido a cada 60s (protege a cota SMTP).

## Dinheiro (BRL, numeric 10,2)

- `payment_status` tem 7 valores: `aguardando | pago | recusado | expirado |
  estornado | pago_apos_expirar | recebido_na_entrega`.
- **PIX é o único método ligado**; cartão é código morto ("Fase 3.5").
- Fluxo: checkout **exige conta** (P6) → `criar-pagamento` (Orders API do
  Mercado Pago, PIX PT30M alinhado à reserva de estoque de 30 min) →
  `webhook-mercadopago` (sem JWT; autentica por HMAC, reconsulta o MP e confere
  valor ±R$ 0,05) → RPC **`confirmar_pagamento`** (SECURITY DEFINER, FOR UPDATE,
  idempotente — a ÚNICA escrita de pagamento) → `reconciliar-pagamentos`
  (pg_cron 10 min) varre a fila de 24 h pela mesma RPC.
- Venda presencial (PDV): `recebido_na_entrega` só via RPC
  `registrar_pagamento_recebido` (só admin) — nunca UPDATE direto.
- Políticas do dono (P1–P7 no `AGENTS.md`): destacar P1 (pagamento após expirar
  se **honra**), P2 (valor divergente → recusa e novo pagamento), P6 (convidado
  não paga online — permanente). Cupom, frete e reembolso têm políticas próprias
  (P3, P4, P5).

## Estoque e auditoria

- Reserva de estoque de **30 minutos**, expirada por pg_cron (devolve estoque).
- `vor_receipts`: recibos de operação com hash SHA-256 encadeado
  (`proof_hash`/`previous_hash`), consumidos por `src/hooks/useVOR.ts`.
- Voto útil em review: deduplicação por constraint `UNIQUE (review_id, user_id)`
  em `review_votes` — mora no banco, não no cliente.

## Integrações

Mercado Pago (Orders + Payments) · ViaCEP · Melhor Envio e Frenet (frete) ·
SMTP da loja (OTP e comprovante) · Web Push (VAPID) · wa.me (deep links) ·
linkrastreio. Sem axios — tudo `fetch`.

## Verificação e deploy (o que realmente cobra)

- Ordem do CI: `npm ci` → `typecheck` → `test` (3 suítes: `test:edge` Deno nas
  functions, `test:unit` Deno em `tests/`, `test:front` Vitest) → `build` →
  `lint:links` → `lint:ratchet` → `size`. Quem reprova é o CI.
- Armadilhas documentadas no `AGENTS.md`: eslint tem **ratchet** (teto de
  warnings em `.lint-baseline.json` — warning novo reprova como erro) e o
  `lint:ratchet` acusa Biome acima do teto no Windows por CRLF (só é cobrado no
  CI Linux).
- Deploy na Vercel; `version.json` e service worker nascem no build; atualização
  do PWA é com consentimento (`registerType: "prompt"`); `robots.txt`/`sitemap.xml`
  por loja nascem no build (`scripts/sitemap.mjs`).

## Regras de banco que não se negociam (resumo — detalhe no AGENTS.md)

RLS em toda tabela de dado de usuário · SECURITY DEFINER com `search_path =
public` explícito · regenerar tipos quando o schema muda · **nunca `supabase db
push`** (ADR 0002) · migration sem `BEGIN`/`COMMIT` · backup diário sem PITR ·
nunca `--no-verify` no commit.

## Arquiteturas agênticas da Galeria ZCode (18/09/2026)

Instalação decidida pelo dono em 18/09/2026, modo **somente-instalar**:
`feature-dev`, `superpowers`, `bmad-method` e `github-spec-kit`, para uso puro
e limpo. O registro formal da galeria está em `relatorio-instalacao.json` na
raiz e a conversão em estado é feita pelo software da galeria. O projeto já
operava um fluxo tipo Superpowers à mão (`docs/superpowers/` — plans, specs,
passagem de bastão); a instalação formaliza o suporte.
