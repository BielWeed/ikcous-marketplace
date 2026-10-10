# Mapa do código — onde cada coisa mora

> Gerado em 18/09/2026 a partir de listagem real das pastas + leitura do
> `AGENTS.md` e do `README.md`. Para o desenho de arquitetura detalhado, veja
> [`docs/onboarding/02-ARQUITETURA.md`](../onboarding/02-ARQUITETURA.md).

## Raiz

| Caminho | O que é |
| --- | --- |
| `AGENTS.md` | **fonte única de instruções do repo** — regras de escopo, dinheiro, risco, verificação, mural |
| `src/` | aplicação React 19 + TypeScript (Vite, PWA) |
| `supabase/` | `migrations/` (155 `.sql`) e `functions/` (12 edge functions Deno + `_shared/`) |
| `scripts/` | build (`buildStore.mjs`, `sitemap.mjs`), CI (`ci/`), prova e inspeção de banco (`db-*.cjs`), ratchet de lint (`lint-ratchet.mjs`), hooks (`hooks-prova.mjs`, `commitlint-mensagem.mjs`) |
| `tests/` | suítes Deno (`tests/`) e Vitest (`tests/front/`) |
| `e2e/` | testes ponta a ponta |
| `docs/` | documentação viva (onboarding, superpowers, decisões, backlog, processo, runbooks, auditoria, mapa) |
| `middleware.ts` | middleware de borda (Vercel) |
| `lefthook.yml` | hooks de git (secretlint, commitlint, typecheck no push) |
| `version.json` | regenerado no build |
| `public/` | sementes de `robots.txt`/`sitemap.xml` por loja (a fonte fresca é o build) |

## `src/` — a aplicação

| Caminho | O que tem |
| --- | --- |
| `src/views/` | telas, divididas por papel: `admin/` (painel do lojista), `customer/` (loja do cliente), `shared/` |
| `src/components/` | componentes: `ui/` (design system shadcn/Radix), `admin/`, `checkout/`, `layouts/`, `pwa/`, `icons/`, `debug/`, `LazyImage.tsx` |
| `src/contexts/` | estado global: `AuthContext`, `CartContext`, `FavoritesContext`, `NotificationContext(+Core)`, `StoreContext` — mudança estrutural aqui se testa isolada antes (regra do repo) |
| `src/hooks/` | 45 hooks de domínio e de plataforma (ex.: `useOrders`, `useCoupons`, `useVOR`, `useDataVault`, `useCacheWarmer`, `useNetworkAdaptive`, `useLeitorDeCodigo`) |
| `src/lib/` | regras e helpers (ex.: `auto-selecao-de-frete.ts`, `economia-do-frete.ts`, `cep-local.ts`, `dataVault.ts`, `destinoPosLogin.ts`, `env.ts`) |
| `src/sw/sw.ts` | service worker (fonte; o build gera o pacote final) |
| `src/state-worker.ts`, `src/shared-brain.ts`, `src/pwa-sentinel.ts` | infraestrutura offline/PWA na raiz de `src/` |
| `src/config/`, `src/types/`, `src/utils/`, `src/hospedagem/` | configuração, tipos (gerados do schema quando muda), utilitários, hospedagem |

## `supabase/` — backend

| Caminho | O que tem |
| --- | --- |
| `supabase/migrations/` | histórico de migrations (regra: nunca `db push`; ver ADR 0002) |
| `supabase/functions/` | edge functions Deno: pagamento (`criar-pagamento`, `webhook-mercadopago`, `reconciliar-pagamentos`, `estornar-pagamento`, `credenciais-mercado-pago`), frete (`calculate-shipping`, `melhor-envio-etiqueta`), comunicação (`send-otp-email`, `send-order-confirmation`, `send-order-whatsapp`, `send-push`, `notify-new-order`) |
| `supabase/functions/_shared/` | código compartilhado entre functions |

## Onde procurar o quê (atalhos)

- **Fluxo do dinheiro**: `AGENTS.md` seção "Fluxo do dinheiro" + função
  [`03-funcionamento.md`](03-funcionamento.md) desta pasta.
- **Estado do trabalho em andamento**: bastão de 17/09/2026 em
  `docs/superpowers/passagem/2026-09-17-super-atualizacao/`.
- **O que falta no produto**: `docs/backlog/` e a fila no bastão (`03-fila-do-que-falta.md`).
- **Decisões fechadas**: `docs/decisoes/` (ADRs) e `04-decisoes-e-follow-ups.md` no bastão.
