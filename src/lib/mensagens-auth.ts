// A1-fix4 (lote VITRINE, correção da regressão medida na revisão de contexto
// limpo) — estas duas constantes moravam em `@/contexts/AuthContext.tsx`, que
// importa `@/lib/supabase.ts` no topo do módulo. `@/lib/supabase.ts` chama
// `createClient` em tempo de import, o que instancia um `RealtimeClient` de
// verdade — e no `jsdom` (testes) isso estoura "Web Worker is not supported"
// antes de qualquer teste rodar. Uma constante de TEXTO não deveria arrastar
// um cliente de banco de dados só para ser lida.
//
// Este módulo existe só para isolar as duas frases (e o tipo de audiência que
// escolhe entre elas) de qualquer dependência de runtime — sem nenhum import
// além do que o próprio TypeScript resolve em tempo de compilação. Qualquer
// import novo aqui reabre a mesma armadilha para o próximo teste que
// renderizar uma tela de login sem simular `@/contexts/AuthContext`.
//
// `AuthContext.tsx`, `AuthView.tsx` e `AdminLoginView.tsx` importam as duas
// constantes DAQUI. `AuthContext.tsx` continua sendo o dono da LÓGICA de
// login (chama `supabase.auth.signInWithPassword`, decide a audiência); este
// módulo só guarda o TEXTO.

// M1/M2 (revisão de contexto limpo do lote VITRINE) — frase ÚNICA para o
// ramo genérico do erro de login, consumida por `AuthContext.tsx` (login) e
// por `AuthView.tsx` (handleSubmit). Antes desta constante existiam DUAS
// frases diferentes para o mesmo erro — "Não foi possível entrar. Tente
// novamente." no toast global e "Ocorreu um erro ao entrar. Tente
// novamente." no banner inline —, violando a invariante de que o toast
// global e a mensagem inline da tela precisam concordar. Esta frase também
// corrige um segundo defeito: "Tente novamente" não é verdade para TODAS as
// causas que caem neste ramo. `user_banned` (HTTP 400 — não 403; conferido
// na fonte do GoTrue) e `email_provider_disabled` (HTTP 422) são
// permanentes — a pessoa digitou e-mail e senha corretos, e tentar de novo
// nunca vai funcionar. A frase não pode:
//   1. instruir uma ação que não conserta a causa permanente (por isso não
//      há mais imperativo de "tentar de novo" como única saída);
//   2. enumerar a causa — revelar "sua conta está banida" ou qualquer
//      status para quem ainda não está autenticado é divulgação de status
//      de conta, o mesmo vazamento que a #120 (recuperação de senha) e a
//      #200 (e-mail não confirmado) fecharam para os OUTROS ramos.
// "Fale com a loja" é a saída real para as causas permanentes, sem
// distinguir para quem lê qual delas é a sua.
//
// A1-fix5 (revisão de contexto limpo) — ressalva que faltava: `user_banned`
// é HTTP 400 **só no password grant** (o único caminho que estes três
// tradutores tratam) — em OUTROS endpoints do GoTrue (ex.: verify, admin)
// `user_banned` VOLTA como 403, via `NewForbiddenError` (fonte:
// internal/api/auth.go:38, internal/api/verify.go:670,727). "400, não 403"
// vale só aqui. E uma segunda nuance: no `token.go`, `IsBanned()` é checado
// ANTES de `Authenticate()` — uma conta banida devolve `user_banned` com a
// senha CERTA **ou** ERRADA; a senha nunca chega a ser conferida.
export const MENSAGEM_ERRO_LOGIN_GENERICA =
  "Não foi possível entrar agora. Tente novamente em instantes ou fale com a loja.";

// A1-fix2 (achado BLOQUEANTE da revisão de contexto limpo do lote VITRINE) —
// `login` também é chamado por AdminLoginView.tsx, a tela do LOJISTA, que é
// uma audiência diferente da que a constante acima foi escrita para. "Fale
// com a loja" é a saída real para um CLIENTE (a loja pode reverter o que
// causou a falha permanente); para o próprio lojista, que É a loja, essa
// instrução não aponta para ninguém.
//
// `login` (AuthContext.tsx) recebe qual audiência está chamando
// (`LoginAudience`) e escolhe a frase certa ANTES de disparar o toast — é o
// único jeito de manter o toast global e a mensagem inline da tela SEMPRE
// concordando, sem duplicar a decisão em cada tela que chama `login`.
// `audience` é OBRIGATÓRIO, sem default: um default silencioso ali é falha
// aberta. Cada chamador — AuthView.tsx (cliente) e AdminLoginView.tsx
// (lojista) — passa a sua audiência de forma explícita.
export type LoginAudience = "customer" | "admin";

export const MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA =
  "Não foi possível entrar agora. Tente novamente em instantes. Se o problema continuar, o acesso desta conta precisa ser verificado fora deste painel.";
