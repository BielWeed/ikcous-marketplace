/**
 * Recuperação de erro de chunk — O MECANISMO ÚNICO (issue #92, PWA-010).
 *
 * Até 13/09/2026 havia DOIS mecanismos concorrentes com chaves divergentes:
 * o GlobalErrorBoundary (`pwa_chunk_reload_done`, booleana em sessionStorage)
 * e o useUpdateCheck (`pwa_chunk_error_reload`, janela de 15s) chamando um
 * purge nuclear SEM checagem de rede, numa corrida de 1500ms contra o reload
 * do boundary. O purge apagava SW, TODOS os caches e o IndexedDB — podendo
 * deixar a base instalada sem app offline.
 *
 * Este módulo é o único dono da decisão. Três canais consomem a MESMA chave:
 *   · componentDidCatch do GlobalErrorBoundary (erro de render — a porta de
 *     UI e primeiro capturador);
 *   · listener 'error' instalado no main.tsx (chunk inicial, nunca lazy);
 *   · listener 'unhandledrejection' no main.tsx — a forma canônica do Vite
 *     para import() dinâmico fora do render, que ninguém escutava.
 * O pwa-sentinel pede recarga pela MESMA chave (subordinado). O
 * silent-guardian.js NUNCA é dono (é estático e sem hash na URL: seria a
 * peça mais velha do navegador decidindo sobre código mais novo).
 *
 * A DECISÃO É SÍNCRONA (check-and-set antes de qualquer await): localStorage
 * é sequencial, então o primeiro canal a chegar engaja e é o dono; o segundo
 * lê o estado já gravado e vira espectador (boundary mostra UI) ou no-op
 * (listeners). Fim da corrida boundary-vs-listener.
 *
 * A ESCADA (o purge é o ÚLTIMO degrau, não o primeiro):
 *   1º engajamento por versão · ciclo NATURAL do service worker
 *      (update + SKIP_WAITING + reload no controllerchange) — quem cura
 *      mismatch de versão é o SW novo assumindo, não o cache vazio; sem SW,
 *      reload seco uma vez.
 *   2º engajamento por versão · purge SELETIVO, só com rede verificada por
 *      CONTEÚDO (portal cativo mente com 200): desregistrar SWs + apagar
 *      SÓ caches `app-cache-*` + location.replace.
 *   Depois · recusa: quem decide é o usuário, pelo botão.
 *
 * O que o caminho de chunk NUNCA toca: IndexedDB (catálogo offline —
 * aceite 4), `ikcous-identidade` e `supabase-images-cache` (sem elas o
 * fallback offline do sw.ts vira 503 "Loja em manutenção" — violação do
 * aceite 7), localStorage (a lista branca já protege o que importa).
 */
import {
  type MotivoDeRecarga,
  gravaMotivoDeRecarga,
} from "@/lib/motivo-de-recarga";

declare const __APP_VERSION__: string;

// Mesma forma de useUpdateCheck: a versão vem do define compile-time do
// Vite — NUNCA da global que o silent-guardian.js assina (ela é ponto de
// sincronização da build, substituído pelo identityBuildConfig; o runtime
// não a usa para decidir).
const VERSAO_DO_APP =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

// Prefixo `pwa_` de propósito: está na whitelist do purge
// (localStoragePurgeWhitelist.ts) e sobrevive a ele e ao handleReset.
export const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";

/** Segundo evento dentro desta janela é espectador, não novo engajamento.
 * Mesma janela que a guarda antiga do hook (`pwa_chunk_error_reload`). */
export const JANELA_RECUPERACAO_CHUNK_MS = 15000;

/** Engajamentos automáticos por versão: 1 = ciclo do SW, 2 = purge seletivo.
 * A partir daí, recusa — até a versão mudar (deploy novo zera). */
export const MAX_ENGAJAMENTOS_POR_VERSAO = 2;

/** Prazo da sonda de rede: rede meia-aberta pendurada não pode virar o
 * novo spinner infinito, agora dentro do probe. */
export const PRAZO_SONDA_DE_REDE_MS = 5000;

/** Prazo do ciclo do SW antes de cair no reload seco. */
export const PRAZO_CICLO_DO_SW_MS = 2500;

/** Prazo do deleteDatabase aguardado: `blocked` com conexão aberta (o
 * dataVault mantém uma; Safari/iOS é pior) não pode travar a navegação. */
export const PRAZO_DELETE_DATABASE_MS = 4000;

export type AcaoDeRecuperacao = "ciclo-sw" | "purge" | "offline" | "recusar";

export interface DecisaoDeRecuperacao {
  /** `true` = este canal engajou e executa; `false` = só acompanha. */
  dono: boolean;
  acao: AcaoDeRecuperacao;
}

export type ResultadoDaRecuperacao =
  | "recarregou"
  | "purgou"
  | "sem-rede-verificada"
  | "recusado";

interface EstadoRecuperacao {
  versao: string;
  count: number;
  lastAt: number;
}

// ─── Reconhecimento do erro ──────────────────────────────────────────────────

const PADROES_DE_ERRO_DE_CHUNK = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "loading chunk",
  "chunkloaderror",
  "importing a module script failed",
  "css chunk load failed",
  "unexpected token '<'",
] as const;

/** A lista que os DOIS mecanismos antigos mantinham separada, unificada
 * (o boundary era a mais restrita — é ela que vale, para não transformar
 * erro de parse genérico em recuperação de chunk). */
export function ehErroDeChunk(mensagem: string | null | undefined): boolean {
  if (!mensagem) return false;
  const msg = mensagem.toLowerCase();
  return PADROES_DE_ERRO_DE_CHUNK.some((padrao) => msg.includes(padrao));
}

// ─── A chave única ───────────────────────────────────────────────────────────

function lerEstado(): EstadoRecuperacao | null {
  const cru = localStorage.getItem(CHAVE_RECUPERACAO_CHUNK);
  if (!cru) return null;
  try {
    const parsed = JSON.parse(cru) as Partial<EstadoRecuperacao> | null;
    if (
      parsed &&
      typeof parsed.versao === "string" &&
      typeof parsed.count === "number" &&
      typeof parsed.lastAt === "number"
    ) {
      return {
        versao: parsed.versao,
        count: parsed.count,
        lastAt: parsed.lastAt,
      };
    }
  } catch {
    // JSON corrompido: tratar como primeira tentativa (mesma decisão do
    // readPurgeGuard do useUpdateCheck).
  }
  return null;
}

function gravarEstado(estado: EstadoRecuperacao): void {
  localStorage.setItem(CHAVE_RECUPERACAO_CHUNK, JSON.stringify(estado));
}

function leOnLine(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

/** A decisão sincrona. Chamada por CADA canal ao capturar um erro de chunk;
 * o primeiro a chegar engaja (e é o dono da execução), o segundo recebe
 * "recusar" com dono=false e só acompanha. SEM internet não há recuperação
 * automática nenhuma — e a guarda não é consumida. */
export function reportarErroChunk(
  agora: number = Date.now(),
  estaOnline: boolean = leOnLine(),
): DecisaoDeRecuperacao {
  if (!estaOnline) {
    // Rede caída não é versão nova: nenhuma recarga/purga conserta, e a
    // tela honesta de offline é da UI (boundary).
    return { dono: true, acao: "offline" };
  }

  try {
    const estado = lerEstado();
    const vigente =
      estado?.versao === VERSAO_DO_APP
        ? estado
        : { versao: VERSAO_DO_APP, count: 0, lastAt: 0 };

    // Alguém já está cuidando (mesma janela): espectador.
    if (
      vigente.count > 0 &&
      agora - vigente.lastAt < JANELA_RECUPERACAO_CHUNK_MS
    ) {
      return { dono: false, acao: "recusar" };
    }

    const count = vigente.count + 1;
    if (count > MAX_ENGAJAMENTOS_POR_VERSAO) {
      // A versão atual já gastou os dois degraus automáticos: recarregar de
      // novo não conserta — daqui em diante quem decide é o usuário.
      return { dono: false, acao: "recusar" };
    }

    gravarEstado({ versao: VERSAO_DO_APP, count, lastAt: agora });

    return count === 1
      ? { dono: true, acao: "ciclo-sw" }
      : { dono: true, acao: "purge" };
  } catch {
    // Storage indisponível: não dá para saber o que já foi tentado — falha
    // fechado, sem recarga automática (mesma decisão do boundary antigo).
    return { dono: false, acao: "recusar" };
  }
}

/** A mesma chave para os OUTROS pedidores de recarga (sentinela): recusa
 * dentro da janela de uma recuperação já engajada (uma recuperação por vez)
 * e não estoura o contador de degraus do chunk — quem purga é só a escada. */
export function pedirRecargaSubordinada(agora: number = Date.now()): boolean {
  try {
    const estado = lerEstado();
    const vigente =
      estado?.versao === VERSAO_DO_APP
        ? estado
        : { versao: VERSAO_DO_APP, count: 0, lastAt: 0 };
    if (
      vigente.count > 0 &&
      agora - vigente.lastAt < JANELA_RECUPERACAO_CHUNK_MS
    ) {
      return false;
    }
    gravarEstado({ ...vigente, lastAt: agora });
    return true;
  } catch {
    return false;
  }
}

// ─── Sonda de rede por conteúdo ──────────────────────────────────────────────

/** "Rede verificada" é CONTEÚDO de /version.json — status ok + content-type
 * json + corpo com `version` string. Portal cativo e DNS sequestrado
 * respondem 200 com HTML: falha fechado aqui. Falso negativo (não purga) é
 * aceitável — a UI mostra a tela honesta de offline. */
export async function verificarRedeDeVerdade(
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), PRAZO_SONDA_DE_REDE_MS);
    try {
      const resposta = await buscar("/version.json", {
        cache: "no-store",
        signal: controle.signal,
      });
      if (!resposta.ok) return false;
      const tipo = resposta.headers.get("content-type") ?? "";
      if (!tipo.includes("json")) return false;
      const corpo = (await resposta.json()) as { version?: unknown };
      return typeof corpo?.version === "string";
    } finally {
      clearTimeout(prazo);
    }
  } catch {
    return false;
  }
}

// ─── Degraus da escada ───────────────────────────────────────────────────────

/** Faz o service worker NOVO (waiting) assumir e recarrega no
 * controllerchange. Resolve `true` se assumiu (a recarga já disparou) e
 * `false` se não havia waiting ou o prazo estourou — sem desregistrar
 * NUNCA. Usado pelo ciclo do chunk e pelo sentinela (motivos distintos). */
export async function assumirServiceWorkerNovoERecarregar(opcoes: {
  motivo: MotivoDeRecarga;
  prazoMs: number;
}): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  let registro: ServiceWorkerRegistration | undefined = undefined;
  try {
    registro = await navigator.serviceWorker.getRegistration();
  } catch {
    return false;
  }
  const esperando = registro?.waiting;
  if (!esperando) return false;

  return new Promise<boolean>((resolve) => {
    let prazo: ReturnType<typeof setTimeout> | null = null;
    let encerrado = false;
    const encerrar = (assumiu: boolean) => {
      if (encerrado) return;
      encerrado = true;
      if (prazo !== null) clearTimeout(prazo);
      try {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          aoAssumir,
        );
      } catch {
        // ambiente sem removeEventListener: a promessa já resolveu
      }
      resolve(assumiu);
    };
    const aoAssumir = () => {
      gravaMotivoDeRecarga(opcoes.motivo);
      window.location.reload();
      encerrar(true);
    };
    prazo = setTimeout(() => encerrar(false), opcoes.prazoMs);
    try {
      navigator.serviceWorker.addEventListener("controllerchange", aoAssumir);
    } catch {
      encerrar(false);
      return;
    }
    try {
      esperando.postMessage({ type: "SKIP_WAITING" });
    } catch {
      encerrar(false);
    }
  });
}

/** Degraus 1+2 da escada: ciclo NATURAL do SW — `update()` para o waiting
 * nascer (se ainda não existe), SKIP_WAITING, reload no controllerchange. */
export async function recuperarPorCicloDoSW(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  let registro: ServiceWorkerRegistration | undefined = undefined;
  try {
    registro = await navigator.serviceWorker.getRegistration();
  } catch {
    return false;
  }
  if (!registro) return false;
  if (!registro.waiting) {
    try {
      await registro.update();
    } catch {
      // Sem update não há waiting novo: o prazo do assumir cobra e cai no
      // reload seco.
    }
  }
  return assumirServiceWorkerNovoERecarregar({
    motivo: "recuperacao-erro-modulo",
    prazoMs: PRAZO_CICLO_DO_SW_MS,
  });
}

async function derrubarServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registros = await navigator.serviceWorker.getRegistrations();
    for (const registro of registros) {
      try {
        await registro.unregister();
      } catch {
        // um registro teimoso não bloqueia os outros
      }
    }
  } catch {
    // Sem lista de registros: segue para os caches.
  }
}

/** Apaga SOMENTE os caches `app-cache-<versao>` — as versões antigas do
 * precache. Preserva `ikcous-identidade` (a ficha da loja) e
 * `supabase-images-cache`, exatamente como o `activate` do sw.ts preserva
 * num update normal. Compartilhado com o purge de versão obrigatória do
 * useUpdateCheck: uma definição, dois consumidores. */
export async function apagarCachesDoApp(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const nomes = await caches.keys();
    let apagados = 0;
    for (const nome of nomes) {
      if (!nome.startsWith("app-cache-")) continue;
      if (await caches.delete(nome)) apagados += 1;
    }
    return apagados;
  } catch {
    return 0;
  }
}

function registraLaudoForense(m: string, d: Record<string, unknown>): void {
  try {
    const logs = JSON.parse(localStorage.getItem("pwa_forensics") || "[]");
    localStorage.setItem(
      "pwa_forensics",
      JSON.stringify(
        [{ t: new Date().toISOString(), m, d }, ...logs].slice(0, 10),
      ),
    );
  } catch {
    // Laudo é melhor esforço: nunca bloqueia o fluxo de recuperação.
  }
}

/** O deleteDatabase AGUARDADO (aceite 5) — para o purge de versão
 * obrigatória, o único caminho que apaga IndexedDB de propósito. Promessifica
 * o request com prazo + onblocked que lauda em pwa_forensics e segue:
 * conexão aberta do dataVault transforma "await" literal no novo spinner
 * infinito. O caminho de chunk NÃO usa isto (não apaga IndexedDB). */
export function apagarIndexedDBAguardando(
  nome = "ikcous-datavault",
  prazoMs: number = PRAZO_DELETE_DATABASE_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let terminado = false;
    let prazo: ReturnType<typeof setTimeout> | null = null;
    const terminar = (apagou: boolean) => {
      if (terminado) return;
      terminado = true;
      if (prazo !== null) clearTimeout(prazo);
      resolve(apagou);
    };
    prazo = setTimeout(() => terminar(false), prazoMs);
    try {
      const pedido = indexedDB.deleteDatabase(nome);
      pedido.onsuccess = () => terminar(true);
      pedido.onerror = () => terminar(false);
      pedido.onblocked = () => {
        registraLaudoForense("DATAVAULT_DELETE_BLOQUEADO", { nome });
        // segue: o prazo resolve — travar aqui é o spinner sem fim novo.
      };
    } catch {
      terminar(false);
    }
  });
}

/** Navegação do purge (aceite 6): location.replace não empilha histórico;
 * pathname+search preservados (o `?source=pwa` da base instalada sobrevive);
 * SEM `?forceUpdate=` — zero consumidores, e a força de recarregar vem do
 * SW desregistrado/SW novo, não de query que ninguém lê. */
export function navegarPreservandoEndereco(): void {
  try {
    window.location.replace(window.location.pathname + window.location.search);
  } catch {
    window.location.reload();
  }
}

/** Executa o que a decisão sincrona nomeou. Quem não é dono não executa
 * NADA — é aqui que a corrida entre canais termina. */
export async function executarRecuperacaoChunk(
  decisao: DecisaoDeRecuperacao,
): Promise<ResultadoDaRecuperacao> {
  if (
    !decisao.dono ||
    decisao.acao === "offline" ||
    decisao.acao === "recusar"
  ) {
    return "recusado";
  }

  if (decisao.acao === "ciclo-sw") {
    // Degraus 1+2: o ciclo natural primeiro — no caso clássico pós-deploy
    // (aba antiga pedindo chunk velho já deletado) o reload seco sozinho faz
    // LAÇO: o SW velho re-serva o HTML velho do cache e o mesmo chunk 404
    // volta. Quem cura é o SW novo assumindo.
    const assumiu = await recuperarPorCicloDoSW();
    if (assumiu) return "recarregou";
    // Degrau 1 na terra: sem SW para assumir, um reload seco, uma vez.
    gravaMotivoDeRecarga("recuperacao-erro-modulo");
    window.location.reload();
    return "recarregou";
  }

  // Degrau 3, o ÚLTIMO: purge seletivo. Só com rede provada por conteúdo.
  if (!(await verificarRedeDeVerdade())) {
    return "sem-rede-verificada";
  }
  await derrubarServiceWorkers();
  await apagarCachesDoApp();
  gravaMotivoDeRecarga("recuperacao-erro-modulo");
  navegarPreservandoEndereco();
  return "purgou";
}

// ─── Os canais globais (main.tsx) ────────────────────────────────────────────

/** Registra UMA vez — no main.tsx, chunk inicial, nunca lazy: se o chunk que
 * falhar for o do próprio mecanismo, ninguém o recupera. Cobre 'error'
 * (script/resource) e 'unhandledrejection' (import() dinâmico fora do
 * render — a forma canônica do Vite, que ninguém escutava). Devolve o
 * desinstalador. */
export function instalarCanaisDeErroChunk(): () => void {
  const aoErro = (evento: ErrorEvent) => {
    if (!ehErroDeChunk(evento.message)) return;
    void executarRecuperacaoChunk(reportarErroChunk());
  };
  const naRejeicao = (evento: PromiseRejectionEvent) => {
    const motivo: unknown = evento.reason;
    const mensagem =
      motivo instanceof Error
        ? motivo.message
        : typeof motivo === "string"
          ? motivo
          : "";
    if (!ehErroDeChunk(mensagem)) return;
    void executarRecuperacaoChunk(reportarErroChunk());
  };
  window.addEventListener("error", aoErro);
  window.addEventListener("unhandledrejection", naRejeicao);
  return () => {
    window.removeEventListener("error", aoErro);
    window.removeEventListener("unhandledrejection", naRejeicao);
  };
}
