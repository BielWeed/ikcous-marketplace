/**
 * Atalho do ícone (Carrinho, Favoritos) com o app instalado JÁ ABERTO.
 *
 * O manifesto declara `launch_handler: focus-existing` (de propósito: tocar no
 * ícone não pode fazer a lojista perder o estado da tela). Nesse modo o
 * navegador NÃO abre a URL do atalho: só traz a janela para a frente e entrega
 * o destino pela fila `launchQueue`. Sem consumidor, o atalho escolhido não
 * fazia nada. Com o app fechado a URL abre direto, o que escondia o defeito.
 *
 * Aqui o app consome a fila uma vez, no boot, e decide:
 * - sem `launchQueue` (Safari, Firefox): nada;
 * - destino malformado, de outra origem ou que o roteador não conhece: ignora;
 * - abertura normal pelo ícone (`start_url`): ignora, a página não muda;
 * - o app já está nessa tela: ignora (abertura a frio já caiu no endereço);
 * - o resto: navega pelo roteador do app (`navegar`), sem recarregar a página.
 *
 * O nome da tela sai do caminho do mesmo jeito que o `syncWithUrl` do App.tsx
 * lê o endereço (minúsculas, sem barra final, `admin/x` vira `admin-x`).
 */
import { TELAS_DE_ENTRADA } from "@/config/rotas";
import type { View } from "@/types";

/**
 * Mesmo valor de `start_url` em `src/config/manifestoBase.ts`
 * (tests/front/atalho-do-icone-com-o-app-ja-aberto.test.ts prende os dois).
 * Não importamos o manifesto: ele carregaria os atalhos inteiros no bundle.
 */
export const START_URL_DO_ICONE = "/?source=pwa";

interface ParametrosDeAbertura {
  targetURL?: string;
}

interface FilaDeAbertura {
  setConsumer: (consumidor: (params: ParametrosDeAbertura) => void) => void;
}

interface OpcoesDoConsumidor {
  navegar: (view: View) => void;
}

function telaDoCaminho(pathname: string): View | null {
  let caminho = (pathname.slice(1) || "home").toLowerCase();
  caminho = caminho.replace(/\/$/, "");
  if (caminho.startsWith("admin/"))
    caminho = caminho.replace("admin/", "admin-");
  if (!caminho) caminho = "home";
  return (TELAS_DE_ENTRADA as readonly string[]).includes(caminho)
    ? (caminho as View)
    : null;
}

/** Tela para onde o atalho aponta, ou `null` quando não há o que fazer. */
function telaDoDestino(targetURL: unknown): View | null {
  if (typeof targetURL !== "string" || targetURL === "") return null;
  let destino: URL;
  try {
    destino = new URL(targetURL, globalThis.location.origin);
  } catch {
    return null;
  }
  if (destino.origin !== globalThis.location.origin) return null;
  if (destino.pathname + destino.search === START_URL_DO_ICONE) return null;

  const tela = telaDoCaminho(destino.pathname);
  if (tela === null) return null;
  if (tela === telaDoCaminho(globalThis.location.pathname)) return null;
  return tela;
}

/** Devolve a função que desliga o consumidor (a fila não tem "remover"). */
export function instalarConsumidorDoAtalhoDoIcone({
  navegar,
}: OpcoesDoConsumidor): () => void {
  const fila = (globalThis as { launchQueue?: FilaDeAbertura }).launchQueue;
  if (typeof fila?.setConsumer !== "function") return () => {};

  let ativo = true;
  fila.setConsumer((params) => {
    if (!ativo) return;
    const tela = telaDoDestino(params?.targetURL);
    if (tela === null) return;
    try {
      navegar(tela);
    } catch (err) {
      console.error("[AtalhoDoIcone] Falha ao abrir a tela do atalho:", err);
    }
  });
  return () => {
    ativo = false;
  };
}
