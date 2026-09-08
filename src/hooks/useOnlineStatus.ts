// Importa do módulo PURO (sem portão de boot), não de `@/lib/env`: este hook
// roda em teste sem `.env`, e o portão lançaria `throw` na avaliação do
// módulo antes do teste começar. A guarda `if (!url)` logo abaixo é quem
// resolve a ausência da chave neste caminho.
//
// São FUNÇÕES, chamadas dentro de `verifyConnection` — não `const` lidas
// aqui no topo. Este hook é importado estaticamente no topo de arquivo de
// teste que faz `vi.stubEnv(...)` dentro de `beforeEach`; se o valor fosse
// capturado na avaliação do módulo (como uma `const` importada faz), o
// `beforeEach` nunca alcançaria mais o valor. Lendo dentro da função, cada
// chamada de `verifyConnection` relê o ambiente corrente.
//
// FONTE ÚNICA POR ABA (perf/pwa, 08/09/2026): antes, cada instância deste
// hook tinha o SEU PRÓPRIO relógio de 15s e a SUA PRÓPRIA consulta ao banco
// — com 22 consumidores no app, o painel do lojista chegava a ter 2-4
// instâncias montadas ao mesmo tempo (8-16 consultas/min, o dia inteiro), e
// duas partes da mesma tela podiam discordar sobre estar online. Agora o
// estado (`currentDiagnostics`), o relógio (`heartbeatId`) e os ouvintes de
// `online`/`offline`/`visibilitychange` vivem no MÓDULO, com contagem de
// assinantes (`listeners`): o primeiro assinante (0→1) liga tudo; um
// assinante que chega com a fonte já rodando recebe o instantâneo corrente
// SEM disparar nova consulta — mudança de comportamento observável: o
// estado pode ter até ~15s de idade para quem chega depois do primeiro. O
// último assinante a sair (1→0) desliga o relógio e os ouvintes, e cancela
// qualquer `setTimeout` de re-sonda (502/503/504 ou erro de rede) pendente,
// via `retryTimeoutId` guardado E um contador de geração (`generation`) que
// invalida qualquer callback assíncrono (fetch ou timeout) que resolva
// depois da parada. Uma montagem nova depois de tudo parado (0→1 de novo)
// recomputa o instantâneo inicial e volta a consultar.
import { lerChaveSupabase, lerSupabaseUrl } from "@/lib/env-valores";
import { useSyncExternalStore } from "react";

export interface Diagnostics {
  isOffline: boolean;
  latency: number;
  quality: "excellent" | "good" | "slow" | "offline";
}

function computeInitialDiagnostics(): Diagnostics {
  const temNavigator = typeof navigator !== "undefined";
  const online = temNavigator ? navigator.onLine : true;
  return {
    isOffline: temNavigator ? !online : false,
    latency: 0,
    quality: temNavigator && online ? "excellent" : "offline",
  };
}

let currentDiagnostics: Diagnostics = computeInitialDiagnostics();
const listeners = new Set<() => void>();
let generation = 0;
// Mutex de "sonda em andamento", amarrado a QUEM tomou (a própria geração),
// não um `boolean` solto. Antes (`isChecking = false`) o `finally` de
// QUALQUER chamada liberava o mutex, inclusive o de uma sonda de geração já
// morta que resolve depois da parada — liberando, sem querer, o mutex da
// geração viva enquanto o fetch dela ainda estava em voo (laudo Opus,
// ressalva 2: abria duas sondas simultâneas ao banco). `releaseChecking` só
// libera se quem pede for o mesmo dono que tomou.
let checkingGen: number | null = null;
let heartbeatId: ReturnType<typeof setInterval> | null = null;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

function publish(next: Diagnostics): void {
  currentDiagnostics = next;
  for (const listener of listeners) listener();
}

function releaseChecking(gen: number): void {
  if (checkingGen === gen) checkingGen = null;
}

async function verifyConnection(gen: number, isRetry = false): Promise<void> {
  if (gen !== generation) return;
  if (checkingGen !== null) return;
  checkingGen = gen;

  if (!navigator.onLine) {
    publish({ isOffline: true, latency: 0, quality: "offline" });
    releaseChecking(gen);
    return;
  }

  try {
    const url = lerSupabaseUrl();
    const anonKey = lerChaveSupabase();
    if (!url) {
      publish({ isOffline: false, latency: 0, quality: "excellent" });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const startTime = Date.now();
    const res = await fetch(`${url}/rest/v1/banners?select=id&limit=1`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (gen !== generation) return;

    const isGatewayError = res.status >= 502 && res.status <= 504;

    // Um 502/503/504 isolado é o SERVIDOR com problema, não a internet da
    // cliente — ela pode estar perfeitamente online. Antes de virar
    // veredito, confirma com uma segunda sonda (mesmo padrão de retry do
    // `catch` abaixo, para erro de rede de verdade). Só marca offline se a
    // falha persistir na confirmação.
    if (isGatewayError && !isRetry) {
      releaseChecking(gen);
      retryTimeoutId = setTimeout(() => {
        retryTimeoutId = null;
        verifyConnection(gen, true);
      }, 1500);
      return;
    }

    const isOffline = isGatewayError;

    let quality: Diagnostics["quality"] = "excellent";
    if (isOffline) {
      quality = "offline";
    } else if (latency > 350) {
      quality = "slow";
    } else if (latency > 150) {
      quality = "good";
    }

    publish({ isOffline, latency, quality });
  } catch {
    if (gen !== generation) return;
    if (!isRetry) {
      releaseChecking(gen);
      retryTimeoutId = setTimeout(() => {
        retryTimeoutId = null;
        verifyConnection(gen, true);
      }, 1500);
      return;
    }
    publish({ isOffline: true, latency: 0, quality: "offline" });
  } finally {
    releaseChecking(gen);
  }
}

function handleOnline(): void {
  verifyConnection(generation);
}

function handleOffline(): void {
  publish({ isOffline: true, latency: 0, quality: "offline" });
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") {
    verifyConnection(generation);
  }
}

function start(): void {
  if (typeof window === "undefined") return;

  // Recomputa o instantâneo inicial: a fonte pode estar reiniciando depois
  // de um período parado, e o estado guardado do módulo pode estar velho
  // (por exemplo "offline" de uma sessão anterior) enquanto o navegador já
  // está online de novo.
  currentDiagnostics = computeInitialDiagnostics();

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const gen = generation;
  verifyConnection(gen);

  heartbeatId = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      verifyConnection(generation);
    }
  }, 15000);
}

function stop(): void {
  // Invalida qualquer fetch ou retry em voo desta geração: se resolverem
  // depois da parada, `verifyConnection` vira no-op. Reset incondicional do
  // mutex (não passa por `releaseChecking`): `stop()` é quem manda, e o
  // dono que porventura estivesse com o mutex já não tem geração viva.
  generation++;
  checkingGen = null;

  if (typeof window !== "undefined") {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  }
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
  if (heartbeatId !== null) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    start();
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      stop();
    }
  };
}

function getSnapshot(): Diagnostics {
  return currentDiagnostics;
}

function getServerSnapshot(): Diagnostics {
  return { isOffline: false, latency: 0, quality: "excellent" };
}

/**
 * useConnectionDiagnostics - Hook para obter dados detalhados da qualidade de conexão.
 * Mede latência (RTT) real contra a API do Supabase e retorna métricas detalhadas.
 *
 * Fonte única por aba: todas as instâncias montadas compartilham o mesmo
 * relógio de 15s e a mesma consulta — ver comentário de topo do arquivo.
 */
export function useConnectionDiagnostics(): Diagnostics {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * useOnlineStatus - Hook legado para detectar reativamente se a conexão caiu.
 * Mantido para compatibilidade total com os componentes existentes.
 */
export function useOnlineStatus(): boolean {
  const { isOffline } = useConnectionDiagnostics();
  return isOffline;
}
