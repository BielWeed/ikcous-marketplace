import { useRegisterSW } from "virtual:pwa-register/react";
import { useStore } from "@/contexts/StoreContext";
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { marcarRecargaPendente } from "@/lib/atualizacao/recarga-pendente";
import { redeVerificadaParaPurga } from "@/lib/atualizacao/rede-para-purga";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import {
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
  gravaVersaoEsperadaDaAtualizacao,
} from "@/lib/motivo-de-recarga";
import {
  PRAZO_APLICACAO_UPDATE_MS,
  apagarCachesDoApp,
  apagarIndexedDBAguardando,
  aplicarAtualizacaoPendenteERecarregar,
  navegarPreservandoEndereco,
} from "@/lib/recuperacao-chunk";
import {
  partesDoNucleoSemver,
  versaoLegivelDeResposta,
} from "@/lib/versao-do-servidor";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

declare const __APP_VERSION__: string;
const SAFE_APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

// A versão do build sempre carrega sufixo ("1.0.0-sha.ef7b099", "1.0.0-build.36692"),
// então comparar com !== contra um min_app_version limpo ("1.0.0") nunca converge
// e gera loop infinito de purge + reload. Comparar só o núcleo semver — o MESMO
// parse de @/lib/versao-do-servidor que a tela usa para exibir (lição #53: uma
// definição só; era o parseSemverCore privado daqui).
const parseSemverCore = partesDoNucleoSemver;

// true apenas quando `local` é comprovadamente MAIS ANTIGA que `required`.
// Formato desconhecido ou núcleo igual => false (nunca forçar purge por dúvida).
const isOlderThan = (local: string, required: string): boolean => {
  const a = parseSemverCore(local);
  const b = parseSemverCore(required);
  if (!a || !b) return false;
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor < bMajor;
  if (aMinor !== bMinor) return aMinor < bMinor;
  return aPatch < bPatch;
};

// Trava anti-loop: se o purge já rodou para a mesma versão exigida e o app
// continua "desatualizado", purgar de novo não resolve — só trava o cliente.
// A chave começa com "pwa_" de propósito: está na whitelist do purge e sobrevive a ele.
const MANDATORY_PURGE_GUARD_KEY = "pwa_mandatory_purge_guard";
const MAX_MANDATORY_PURGES = 2;

const readPurgeGuard = (): { required: string; count: number } => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(MANDATORY_PURGE_GUARD_KEY) || "null",
    );
    if (parsed && typeof parsed.required === "string") {
      return { required: parsed.required, count: Number(parsed.count) || 0 };
    }
  } catch {
    // Valor corrompido: tratar como primeira tentativa.
  }
  return { required: "", count: 0 };
};

export function useUpdateCheck() {
  const { config } = useStore();
  // A versão mínima exigida que este aparelho ainda NÃO tem, JÁ com a rede
  // provada (null = nada obrigatório pendente). É daqui que sai `isMandatory`
  // e o `updateAvailable` da versão obrigatória: quem decide QUANDO instalar é
  // o PWAUpdateGate (ponto de parada, abas, trava) — este hook não purga mais
  // sozinho no boot.
  const [obrigatoria, setObrigatoria] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  // Última leitura BEM-SUCEDIDA de /version.json feita por este hook: é a
  // prova de rede da purga (e, por ser estado, reavalia a regra ao mudar).
  const [leituraDeVersaoEm, setLeituraDeVersaoEm] = useState<number | null>(
    null,
  );
  const buscandoParaPurgaRef = useRef(false);

  // ==============================
  // CORE: Vite PWA Native Events
  // ==============================
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  const lerVersaoDoServidor = useCallback(async () => {
    if (import.meta.env.DEV) return SAFE_APP_VERSION;
    try {
      // SEM carimbo de tempo: cada URL diferente virava uma entrada nova no
      // cache do Service Worker (20 polls = 20 entradas, medido em
      // 08/09/2026). O sw.ts agora ignora /version.json — ela é sonda de
      // frescor —, então quem fura o cache HTTP do navegador é o "no-store",
      // que não inventa URL nova a cada busca.
      //
      // FAIL-OPEN (peça de 14/09): a leitura é o contrato único de
      // @/lib/versao-do-servidor — em dev/prévia o dev server responde esta
      // rota com o index.html (200 text/html, medido em 5174/5175/5176) e na
      // produção vem JSON real. Resposta que não é uma versão legível
      // (HTML, 404, corpo mentido, campo ausente) devolve NULL = "sem
      // informação de versão = sem atualização": nunca overlay, nunca versão
      // inventada na tela.
      const response = await fetch("/version.json", { cache: "no-store" });
      return await versaoLegivelDeResposta(response);
    } catch (e) {
      console.error("[Update] Failed to fetch server version:", e);
    }
    return null;
  }, []);

  // A leitura que o resto do hook usa: a de cima + o registro da PROVA DE REDE
  // da purga obrigatória (uma leitura de conteúdo bem-sucedida). Em dev não há
  // leitura de verdade (devolve a versão local), então não prova nada.
  const fetchServerVersion = useCallback(async () => {
    const lida = await lerVersaoDoServidor();
    if (lida !== null && !import.meta.env.DEV) {
      setLeituraDeVersaoEm(Date.now());
    }
    return lida;
  }, [lerVersaoDoServidor]);

  // As opções ficam numa VARIÁVEL (e não num literal direto na chamada) de
  // propósito: `onNeedReload` existe no vite-plugin-pwa 2.0.0 (o do
  // package-lock e do CI), mas o `node_modules` de quem ainda não reinstalou
  // pode ter a 1.x, cujos tipos não conhecem a propriedade — e literal direto
  // faz o tsc local recusar "propriedade em excesso". Variável não passa pela
  // checagem de excesso e o 2.0.0 recebe a opção normalmente.
  //
  // `onNeedReload` SUBSTITUI o reload automático que o plugin faz em TODAS as
  // abas quando o service worker novo assume (ouvinte `controlling`, sem
  // consultar ninguém). Aqui a aba só ANOTA o pedido; o PWAUpdateGate recarrega
  // no próximo ponto de parada seguro (nunca no meio de pagamento, venda,
  // formulário sujo ou operação sensível). É o veto local de cada aba.
  const opcoesDoRegistro = {
    onRegisteredSW(swUrl: string, r: ServiceWorkerRegistration | undefined) {
      console.log(`[PWA] Service Worker registered: ${swUrl}`);
      if (r) {
        setRegistration(r);
      }
    },
    onRegisterError(error: any) {
      console.error("[PWA] Service Worker registration error:", error);
    },
    onNeedReload: marcarRecargaPendente,
  };

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, _setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW(opcoesDoRegistro);

  useEffect(() => {
    if (!registration) return;

    const checkUpdateNow = async () => {
      console.log("[PWA] Checking for updates...");
      const ver = await fetchServerVersion();
      if (ver && ver !== SAFE_APP_VERSION) {
        console.log(
          `[PWA] Server version (${ver}) differs from local (${SAFE_APP_VERSION}). Updating SW.`,
        );
        setNewVersion(ver);
      }
      registration.update().catch((err) => {
        console.error("[PWA] Failed to check for SW update:", err);
      });
    };

    const intervalId = setInterval(checkUpdateNow, 3 * 60 * 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[PWA] App became visible. Checking SW update...");
        checkUpdateNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      console.log(
        "[PWA] Clearing SW update check interval & visibility listener...",
      );
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [registration, fetchServerVersion, SAFE_APP_VERSION]);

  // ==============================
  // CORE: purga de VERSÃO OBRIGATÓRIA (minAppVersion)
  // ==============================
  // Issue #92: este é o purge de VERSÃO OBRIGATÓRIA (minAppVersion) — o
  // ÚNICO caminho que apaga IndexedDB de propósito, agora com o delete
  // AGUARDADO (prazo + onblocked). O disparado por ERRO DE CHUNK não passa
  // mais por aqui: é a escada de @/lib/recuperacao-chunk, que preserva o
  // IndexedDB e nunca roda sem rede verificada.
  //
  // ATUALIZAÇÃO ÚNICA (16/10/2026): esta função NÃO é mais chamada sozinha no
  // boot. Quem a aciona é o PWAUpdateGate, no ponto de parada, com as abas
  // livres e a trava liberada — via `performNuclearPurge` (o export abaixo,
  // que é o apply normal e escolhe a purga quando há versão obrigatória
  // pendente). As proteções de pagamento/venda valem aqui também: nenhuma
  // versão, nem a mínima obrigatória, corta pagamento ou venda no meio.
  const purgaDeVersaoObrigatoria = useCallback(async (requerida: string) => {
    // Defesa em profundidade: o Gate já vetou, mas aqui é o ponto de não
    // retorno (apaga SW, caches e IndexedDB), e o mundo pode ter mudado.
    // Lançar faz o instalador soltar a fase e reavaliar no próximo ponto.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("[Update] Purge obrigatório adiado: sem rede.");
    }
    if (haOperacaoSensivel()) {
      throw new Error("[Update] Purge obrigatório adiado: operação sensível.");
    }

    // A trava existente (máx. 2) é gasta AQUI, no instante da purga real, e
    // CONFIRMADA lendo de volta: sem como contar, não purga (lado seguro).
    const guard = readPurgeGuard();
    const tentativas = guard.required === requerida ? guard.count : 0;
    if (tentativas >= MAX_MANDATORY_PURGES) {
      throw new Error(
        `[Update] Purge obrigatório já tentado ${tentativas}x para ${requerida}.`,
      );
    }
    try {
      localStorage.setItem(
        MANDATORY_PURGE_GUARD_KEY,
        JSON.stringify({ required: requerida, count: tentativas + 1 }),
      );
      // Log para o próximo boot saber o que aconteceu.
      localStorage.setItem(
        "pwa_update_log",
        `Version Mismatch: ${SAFE_APP_VERSION} -> ${requerida}`,
      );
    } catch {
      throw new Error("[Update] Purge obrigatório adiado: storage não grava.");
    }
    const confirmada = readPurgeGuard();
    if (
      confirmada.required !== requerida ||
      confirmada.count !== tentativas + 1
    ) {
      throw new Error(
        "[Update] Purge obrigatório adiado: trava não confirmou.",
      );
    }

    console.warn("[Update] 🔴 NUCLEAR_PURGE_START: Initiating full cleanup...");

    // 1. Service Worker cleanup
    if ("serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          await r.unregister();
        }
      } catch (e) {
        console.error("[Purge] SW error:", e);
      }
    }

    // 2. Cache storage cleanup — SELETIVO via módulo único: só os caches
    // `app-cache-*` morrem. `ikcous-identidade` e `supabase-images-cache`
    // sobrevivem (o activate do SW preserva num update normal; sem a
    // ficha, o fallback offline devolveria 503 "Loja em manutenção" para
    // a base instalada).
    await apagarCachesDoApp();

    // 2.5 IndexedDB cleanup (DataVault deletion) — AGUARDADO (aceite 5):
    // fire-and-forget corria com a navegação; await literal travaria com
    // conexão aberta. O módulo faz os dois com prazo + onblocked laudado.
    await apagarIndexedDBAguardando();

    // 3. Selective localStorage purge
    // Keep auth tokens, user data, brand specific keys and PENDING writes
    // — mesma lista branca de GlobalErrorBoundary.tsx
    // (@/lib/localStoragePurgeWhitelist): esta purga apaga sem ninguém decidir
    // nada na hora, então uma lista desatualizada aqui apaga fila de escrita
    // offline — ver o comentário do arquivo compartilhado. As chaves `pwa_*`
    // (inclusive as travas) sobrevivem de propósito.
    try {
      for (const key of Object.keys(localStorage)) {
        if (!chaveSobreviveAPurga(key)) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error("[Purge] LocalStorage error:", e);
    }

    // 4. Set reload reason for next boot
    // Peça 22/09: a origem do build permite o boot PROVAR que a recarga
    // trouxe outro build antes de anunciar "Sistema Atualizado" — no
    // purge que não curou (a guarda anti-loop), o boot mostra o neutro. A
    // versão ESPERADA é a mínima exigida: chegar abaixo dela também é neutro.
    gravaOrigemDeAtualizacao(SAFE_APP_VERSION);
    gravaVersaoEsperadaDaAtualizacao(requerida);
    gravaMotivoDeRecarga("atualizacao-aplicada");

    // 5. Navegação honesta (aceite 6): location.replace não empilha
    // histórico; pathname+search preservados (?source=pwa da base
    // instalada sobrevive). A query de força da era antiga morreu sem
    // consumidor nenhum; recarregar de verdade vem do SW desregistrado,
    // não de parâmetro de URL que ninguém lê.
    navegarPreservandoEndereco();
  }, []);

  // Helper to trigger the update process. É o que o Gate chama (export
  // `performNuclearPurge`, nome mantido porque dezenas de testes mockam este
  // módulo): com versão obrigatória pendente, faz a purga; do contrário, o
  // apply normal do service worker.
  const handleUpdate = useCallback(
    async (_immediate?: boolean) => {
      if (obrigatoria) {
        await purgaDeVersaoObrigatoria(obrigatoria);
        return;
      }
      console.log("[Update] Triggering SW update and reload...");
      // A mecânica do apply mora no módulo único desde a peça de 14/09:
      // controllerchange recarrega UMA vez, e o prazo de segurança garante o
      // pior caso — SW preso/nunca assumindo recarrega do mesmo jeito em
      // ~1,2 s (antes, era isso que pendurava o instalador).
      aplicarAtualizacaoPendenteERecarregar({
        acionar: (forcar) => updateServiceWorker(forcar),
        motivo: "atualizacao-aplicada",
        prazoMs: PRAZO_APLICACAO_UPDATE_MS,
      });
    },
    [updateServiceWorker, obrigatoria, purgaDeVersaoObrigatoria],
  );

  // ==============================
  // CORE: Mandatory Version Check (DB)
  // ==============================
  // Só DETECTA e marca `obrigatoria` — não purga. A purga é decisão do Gate
  // (ponto de parada, abas, trava) e só depois de a rede estar provada: a
  // leitura bem-sucedida de /version.json feita por este hook + navigator
  // online. Sem a prova, dispara uma leitura e aguarda (o resultado muda
  // `leituraDeVersaoEm` e esta função é reavaliada).
  const checkMandatoryUpdate = useCallback(() => {
    const isDev = import.meta.env.DEV;
    if (isDev) return false;

    // Skip check if SAFE_APP_VERSION is a dev timestamp (optional logic)
    const isTimestampVersion =
      SAFE_APP_VERSION.length > 10 && !Number.isNaN(Number(SAFE_APP_VERSION));

    // Versão local é anterior à mínima exigida (e não é timestamp de dev)
    if (
      config.minAppVersion &&
      !isTimestampVersion &&
      isOlderThan(SAFE_APP_VERSION, config.minAppVersion)
    ) {
      const guard = readPurgeGuard();
      const attempts =
        guard.required === config.minAppVersion ? guard.count : 0;

      if (attempts >= MAX_MANDATORY_PURGES) {
        console.error(
          `[Update] Purge obrigatório já tentado ${attempts}x para a versão ${config.minAppVersion} e o app continua em ${SAFE_APP_VERSION}. Abortando para não travar o cliente em loop.`,
        );
        setObrigatoria(null);
        return false;
      }

      const redeProvada = redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: leituraDeVersaoEm,
        agora: Date.now(),
        online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      });
      if (!redeProvada) {
        // Aguarda: uma leitura agora (uma de cada vez); se der certo, o
        // estado de leitura muda e esta checagem roda de novo.
        if (!buscandoParaPurgaRef.current) {
          buscandoParaPurgaRef.current = true;
          void fetchServerVersion().finally(() => {
            buscandoParaPurgaRef.current = false;
          });
        }
        return false;
      }

      console.log("[Update] 🚨 Mandatory version mismatch detected!");
      console.log(
        `[Update] Local: ${SAFE_APP_VERSION} | Required: ${config.minAppVersion}`,
      );
      setObrigatoria(config.minAppVersion);
      return true;
    }

    // Versão local em dia: zerar a trava para não bloquear um update futuro legítimo.
    setObrigatoria(null);
    try {
      if (config.minAppVersion && readPurgeGuard().count > 0) {
        localStorage.removeItem(MANDATORY_PURGE_GUARD_KEY);
      }
    } catch {
      // Storage indisponível: a trava fica como está (nunca derruba o boot).
    }
    return false;
  }, [config.minAppVersion, fetchServerVersion, leituraDeVersaoEm]);

  useEffect(() => {
    checkMandatoryUpdate();
  }, [checkMandatoryUpdate]);

  // ==============================
  // UI Sync: Refresh Notifications
  // ==============================
  useEffect(() => {
    if (needRefresh) {
      console.log("[PWA] New content available! User prompt should appear.");
      // Só versão LEGÍVEL entra em newVersion (peça de 14/09): sem
      // informação no servidor, o selo de→para nem nasce — o valor
      // inventado "Nova Versão" aqui virava texto na tela (e com o
      // slice(-6) antigo, um fragmento sem sentido). Recarrega a busca
      // enquanto a versão não chega; sem núcleo novo que difira do local,
      // nada é exibido.
      if (!newVersion) {
        fetchServerVersion().then((ver) => {
          if (ver && ver !== SAFE_APP_VERSION) {
            setNewVersion(ver);
          }
        });
      }
    }
    // SAFE_APP_VERSION é constante de módulo (define de build): fora do
    // array de propósito — listá-la é warning do exhaustive-deps.
  }, [needRefresh, newVersion, fetchServerVersion]);

  useEffect(() => {
    if (offlineReady) {
      console.log("[PWA] App ready for offline use.");
      toast.success("App pronto para uso offline!", {
        duration: 3000,
      });
      setOfflineReady(false); // Reset to avoid re-triggering
    }
  }, [offlineReady, setOfflineReady]);

  // ==============================
  // ChunkLoadError auto-recovery
  // ==============================
  // Issue #92: REMOVIDO daqui. Este hook vive num chunk LAZY
  // (PWAUpdateGate via React.lazy) — no boot inicial ele não existe, e se o
  // chunk que falhasse fosse o dele próprio, o mecanismo nem acordava. Os
  // canais 'error' e 'unhandledrejection' agora são instalados UMA vez no
  // main.tsx (chunk inicial) e decidem pela MESMA chave de
  // @/lib/recuperacao-chunk que o GlobalErrorBoundary — sem corrida entre
  // chaves, sem purge nuclear sem rede verificada.

  return {
    // Versão mínima exigida pendente (rede já provada): o Gate trata o ponto
    // de parada como já satisfeito, mas os vetos de pagamento/venda valem.
    isMandatory: obrigatoria !== null,
    // Há o que instalar: SW novo esperando OU versão obrigatória pendente.
    updateAvailable: needRefresh || obrigatoria !== null,
    newVersion,
    checkUpdate: useCallback(
      async (realtimeVersion?: string) => {
        let targetVer = realtimeVersion;
        if (!targetVer) {
          targetVer = (await fetchServerVersion()) || undefined;
        }

        if (targetVer && targetVer !== SAFE_APP_VERSION) {
          console.log(
            `[Update] Server version (${targetVer}) differs from local (${SAFE_APP_VERSION})`,
          );
          setNewVersion(targetVer);
        }

        if (registration) {
          console.log(
            "[Update] Triggering manual service worker update check...",
          );
          try {
            await registration.update();
          } catch (err) {
            console.error("[PWA] Manual SW update check failed:", err);
          }
        }

        checkMandatoryUpdate();
      },
      [
        registration,
        fetchServerVersion,
        SAFE_APP_VERSION,
        checkMandatoryUpdate,
      ],
    ),
    // NOME HISTÓRICO, MANTIDO DE PROPÓSITO (dezenas de testes mockam este
    // módulo por ele): isto NÃO é a purga nuclear. É o APPLY da atualização —
    // o apply normal do service worker (aplicarAtualizacaoPendenteERecarregar)
    // ou, só quando há versão obrigatória pendente, a purga de versão
    // obrigatória. Quem o chama é o PWAUpdateGate, no ponto de parada.
    performNuclearPurge: handleUpdate,
  };
}
