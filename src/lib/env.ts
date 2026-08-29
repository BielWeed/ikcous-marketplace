/**
 * Portão de ambiente do app.
 *
 * Este módulo é avaliado ANTES de qualquer outro (é dependência de `supabase.ts`,
 * que por sua vez é dependência transitiva de `main.tsx`). Isso importa: imports ES
 * são hoisted, então uma validação escrita no corpo do `main.tsx` nunca chega a rodar
 * quando um módulo importado explode primeiro — era exatamente o que deixava o app
 * preso no loader eterno, sem nenhuma mensagem, quando as chaves do Supabase faltavam.
 *
 * Aqui a falha é tratada onde ela realmente acontece: pinta a tela de erro com DOM
 * puro (sem React, que ainda não montou) e só então interrompe o boot.
 *
 * O CÁLCULO dos valores (puro, sem `throw`) mora em `@/lib/env-valores` — este
 * arquivo importa de lá e reexporta, e fica só com o PORTÃO: a validação, a tela
 * de erro e o `throw`. Quem já importava `@/lib/env` não nota diferença nenhuma;
 * quem só precisa do valor (como `useOnlineStatus.ts`) agora pode importar o
 * módulo puro e não herdar o portão.
 *
 * `env-valores.ts` expõe FUNÇÕES de leitura viva, não mais `const`. Aqui elas
 * são chamadas UMA vez, no topo — o resultado vira `const` deste módulo, e o
 * portão abaixo continua avaliando na carga do módulo, como sempre avaliou.
 */
import {
  lerChaveSupabase,
  lerOrigemChaveSupabase,
  lerSupabaseUrl,
} from "@/lib/env-valores";

export const SUPABASE_URL = lerSupabaseUrl();
export const SUPABASE_PUBLISHABLE_KEY = lerChaveSupabase();
// Alias de compatibilidade SEM CONSUMIDOR — dívida conhecida, mantida de
// propósito e com prazo de validade. Ele nasceu como "ponto de pouso" para a
// migração do `useOnlineStatus.ts`; essa migração já aconteceu e, com razão,
// NÃO usou este nome (o hook importa `@/lib/env-valores`, que é puro). Fica
// só para não quebrar quem porventura importasse o nome antigo, e aponta para
// o MESMO valor resolvido — nunca para a legada crua. Quando ninguém mais
// depender dele, apagar junto com a asserção que o cobre em
// `tests/front/env-publishable-key-com-fallback-para-legada.test.ts`.
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

/**
 * Substitui o loader inicial por uma tela de erro legível.
 * Usa DOM puro de propósito: é chamada em cenários onde o React não subiu.
 */
function renderBootFailure(title: string, detail: string): void {
  if (typeof document === "undefined") return;

  // O loader do silent-guardian fica por cima de tudo e tem fallback próprio de 20s.
  // Sem removê-lo aqui, a mensagem de erro ficaria escondida atrás dele.
  document.getElementById("silent-guardian-loader")?.remove();

  const host = document.getElementById("root") || document.body;
  host.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;background:#dc2626;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;";

  const heading = document.createElement("h1");
  heading.style.cssText = "margin:0;font-size:28px;font-weight:900;";
  heading.textContent = title;

  const message = document.createElement("p");
  message.style.cssText =
    "margin:0;max-width:420px;font-size:16px;line-height:1.6;";
  message.textContent = detail;

  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText =
    "margin-top:12px;padding:16px 32px;border:none;border-radius:12px;background:#fff;color:#dc2626;font-size:16px;font-weight:700;cursor:pointer;";
  button.textContent = "LIMPAR E TENTAR DE NOVO";
  button.addEventListener("click", () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Storage bloqueado (modo privado/iframe): recarregar mesmo assim.
    }
    globalThis.location.reload();
  });

  wrapper.append(heading, message, button);
  host.append(wrapper);
}

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  const faltando = [
    !SUPABASE_URL && "VITE_SUPABASE_URL",
    // Nenhuma das DUAS chegou — nomear as duas, senão quem depura procura
    // só a variável antiga e não acha o motivo real.
    !SUPABASE_PUBLISHABLE_KEY &&
      "VITE_SUPABASE_PUBLISHABLE_KEY (ou VITE_SUPABASE_ANON_KEY)",
  ]
    .filter(Boolean)
    .join(" e ");

  renderBootFailure(
    "🚨 ERRO DE AMBIENTE",
    `As chaves do banco de dados não foram detectadas neste build (${faltando}). Isso acontece quando o build saiu sem as variáveis de ambiente — verifique .env.production.local, que tem precedência sobre .env.production e pode estar com os valores vazios.`,
  );

  throw new Error(
    `[EnvGuard] Variáveis de ambiente ausentes: ${faltando}. Verifique .env.production.local e .env.production.`,
  );
}

// Rastro de uma linha para o dia em que a `anon` legada for desligada: se o
// portão acima passou mas a chave resolvida for a errada (ex.: publishable
// truncada por colagem, mas não-vazia), um 401 em massa aponta direto para
// qual variável venceu — sem precisar de sessão de depuração. Nunca o VALOR
// da chave, só o NOME da variável de origem.
const ORIGEM_DA_CHAVE = lerOrigemChaveSupabase();
console.info(
  `[EnvGuard] Chave do Supabase resolvida a partir de ${ORIGEM_DA_CHAVE}.`,
);
