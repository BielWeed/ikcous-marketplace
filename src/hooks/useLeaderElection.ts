import { useCallback, useEffect, useRef, useState } from "react";

const LEADER_KEY = "pwa_leader_tab";
const LEADER_TTL = 5000; // 5s heartbeat
const TAB_ID = Math.random().toString(36).slice(2, 8);
// Sem armazenamento utilizável a eleição se faz só pelo canal entre abas: a
// líder é dada por morta depois de tantos batimentos (LEADER_TTL / 2 cada) sem
// resposta ao PING — o mesmo prazo, em batimentos, do TTL do armazenamento.
const BATIMENTOS_SEM_SINAL_PARA_REIVINDICAR = 2;

/**
 * O batimento guardado vale? `0 <= idade <= TTL`. Idade NEGATIVA é batimento
 * "do futuro": o relógio da máquina recuou (ajuste de hora, sincronização) e o
 * valor gravado antes do recuo não prova mais nada — contá-lo como válido
 * preservava por horas uma líder morta (aba fechada sem `beforeunload`).
 * A líder viva não é prejudicada: ela regrava o batimento com a hora nova a
 * cada LEADER_TTL / 2.
 */
function batimentoVigente(
  existente: { ts?: unknown } | null,
  agora: number,
): boolean {
  if (!existente) return false;
  const idade = agora - (existente.ts as number);
  return idade >= 0 && idade <= LEADER_TTL;
}

// Shared BroadcastChannel singleton to prevent multiple instances and closure errors on HMR/re-renders
const bc =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("ikcous_leader_coordination");

// localStorage has no compare-and-swap, so mutual exclusion can't come from
// "locking" the read-check-write in claimLeadership — the best a tab can do
// is defer the write and re-check right before doing it, so a competitor
// that wrote in the meantime is seen instead of declaring victory on a read
// that's gone stale. That deferral is what turns "two tabs read null and
// both write in the same tick" (the original bug) into "the second tab to
// have its re-check callback run sees the first tab's write" — but it does
// NOT make the claim race-free: it's still an unlocked read-check-write, so
// two tabs whose re-check callbacks land on the exact same instant can still
// both write.
//
// The re-check is delayed by a fresh Math.random() draw, uniform and
// continuous over [0, CLAIM_DELAY_WINDOW_MS), taken again on every claim
// attempt. But that continuous draw is passed straight to setTimeout, and
// setTimeout's delay argument is a WebIDL `long` — the fractional part is
// truncated before the timer is armed (setTimeout(cb, 42.31) and
// setTimeout(cb, 42.88) become the same 42). So the delay that actually
// fires is uniform over the INTEGERS {0, 1, ..., CLAIM_DELAY_WINDOW_MS - 1},
// not over the continuum, and an exact collision between two tabs' timers
// is NOT a measure-zero event. Measured over 2,000,000 draw pairs: two
// simultaneous claims land within 1ms of each other about 2% of the time
// (that "1ms" is a window picked for the measurement, not a measured cost
// of the actual read-check-write) and land on the exact same truncated
// integer — the real collision, one setTimeout callback racing another —
// about 1% of the time PER DRAW, i.e. roughly 1 in CLAIM_DELAY_WINDOW_MS
// contested vacancies IF each tab drew exactly once.
//
// ⚠️ Item 4 da revisão de 27/08/2026: that "1%" assumes one draw per tab,
// but `claimTimeoutRef` is a `useRef` — one per hook INSTANCE, not one per
// tab. There are 10 CALL SITES (measured 27/08/2026 with
// `grep -rn "useLeaderElection(" src/`, minus the definition): StoreContext,
// CartContext, FavoritesContext, NotificationContext, AdminLayout, useOrders,
// useRealtimeUpdate, useQuestions, useReviews, AdminDashboardView.
//
// ⚠️ CALL SITES IS A FLOOR, NOT A CEILING. Instances per tab is what matters,
// and it can exceed 10: `useOrders` alone has 9 consumers, `useReviews` 3,
// `useQuestions` 2 — a screen mounting several of those mounts this hook once
// per consumer. Each instance has its OWN draw, and the tab's effective delay
// is the MINIMUM of all of them, never a single draw.
//
// Collision probability by instances-per-tab (min of N uniform draws in
// {0..99} colliding across two tabs) — arithmetic, re-derived, not measured:
//   1  -> 1.00%   (what this comment claimed before, and it was wrong)
//   5  -> 2.78%
//   7  -> 3.77%
//   10 -> 5.26%
// So a tab collides roughly 3 to 5 times more often than "1%" suggests.
//
// 🔴 Do NOT use a number from this comment to justify shrinking
// CLAIM_DELAY_WINDOW_MS without measuring instances on the actual screen
// first. The exponent here is instances-per-tab, and nobody has measured it
// on a real page — the range above is arithmetic over an unmeasured N.
// The FIX for this — hoisting `claimTimeoutRef` to module scope so all
// instances in a tab share one timer/draw — is a real improvement, but it's
// a behavior change in concurrency code with 11 consumers, and it is NOT
// done in this pass; it's the next fix to make, not this one.
//
// Shrinking CLAIM_DELAY_WINDOW_MS raises the per-draw collision rate in the
// same proportion. When a collision does happen, it self-corrects within
// one heartbeat (LEADER_TTL / 2). It is race-reducing, not race-free. A
// genuinely race-free claim needs a primitive with real mutual exclusion —
// the Web Locks API — instead of localStorage's read-check-write; that's a
// bigger change than this fix and isn't done here.
export const CLAIM_DELAY_WINDOW_MS = 100;

/** Exported so tests can assert the delay is re-drawn on every call, and so
 * they don't have to hardcode the window's width as a magic number. */
export function computeClaimDelayMs(): number {
  return Math.random() * CLAIM_DELAY_WINDOW_MS;
}

/**
 * useLeaderElection v17.1
 * Prevents N tabs from all triggering SW updates or Supabase connections simultaneously.
 * Only the "leader" tab performs SW update/reload operations and holds database sockets.
 *
 * Uses localStorage + BroadcastChannel for coordination.
 * Leader expires after LEADER_TTL without heartbeat.
 */
export function useLeaderElection() {
  // Sem coordenação entre abas, esta aba mantém a própria conexão.
  const [isLeader, setIsLeader] = useState(bc === null);
  const isLeaderRef = useRef(bc === null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Armazenamento do site bloqueado/cheio (leitura ou gravação lançou): a
  // liderança passa a valer só pelo canal entre abas. Sai do modo quando a
  // líder consegue guardar o batimento de novo.
  const modoCanalRef = useRef(false);
  // Quantas respostas LEADER_ALIVE de OUTRA aba já chegaram, e quantos
  // batimentos seguidos esta aba passou sem nenhuma (só no modo canal).
  const alivesRecebidosRef = useRef(0);
  const batimentosSemSinalRef = useRef(0);

  const updateLeadership = useCallback((val: boolean) => {
    if (isLeaderRef.current !== val) {
      isLeaderRef.current = val;
      setIsLeader(val);
      console.log(
        "[LeaderElection] Tab %s leadership state changed to:",
        TAB_ID,
        val,
      );
    }
  }, []);

  const anunciarVida = useCallback(() => {
    bc?.postMessage({ type: "LEADER_ALIVE", tabId: TAB_ID });
  }, []);

  // Reivindicação SEM armazenamento: só o canal decide. `imediato` = já se sabe
  // que ninguém serve (PING do mount sem resposta, ou LEADER_RESIGNED); sem ele
  // (batimento de seguidora) a aba pergunta de novo (PING) e só reivindica
  // depois de BATIMENTOS_SEM_SINAL_PARA_REIVINDICAR batimentos sem resposta.
  // O sorteio de atraso e a checagem "ninguém respondeu nesse meio-tempo" são
  // os mesmos da reivindicação pelo armazenamento; duas que ainda assim cheguem
  // juntas se resolvem no desempate por tabId (ver handleMessage). Melhor duas
  // líderes por um instante que nenhuma: sem líder o painel não recebe pedido
  // novo sozinho.
  const reivindicarPeloCanal = useCallback(
    (imediato: boolean) => {
      if (isLeaderRef.current) return true;
      if (!imediato) {
        bc?.postMessage({ type: "LEADER_PING", tabId: TAB_ID });
        batimentosSemSinalRef.current += 1;
        if (
          batimentosSemSinalRef.current < BATIMENTOS_SEM_SINAL_PARA_REIVINDICAR
        ) {
          return false;
        }
      }
      if (claimTimeoutRef.current === null) {
        const vistos = alivesRecebidosRef.current;
        claimTimeoutRef.current = setTimeout(() => {
          claimTimeoutRef.current = null;
          // Alguém se anunciou durante a espera: essa aba serve.
          if (alivesRecebidosRef.current !== vistos) return;
          updateLeadership(true);
          anunciarVida();
        }, computeClaimDelayMs());
      }
      return false;
    },
    [updateLeadership, anunciarVida],
  );

  const claimLeadership = useCallback(
    (imediato = true) => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        if (!isLeaderRef.current) {
          updateLeadership(false);
          return false;
        }
      }
      try {
        const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || "null");
        const now = Date.now();
        if (batimentoVigente(existing, now)) {
          const active = existing.tabId === TAB_ID;
          updateLeadership(active);
          return active;
        }
        // O armazenamento já falhou antes (não grava): reivindicar por ele de
        // novo só repetiria a falha — vale o canal.
        if (modoCanalRef.current) return reivindicarPeloCanal(imediato);
        // Vacant or TTL expired: don't write immediately. That immediate
        // write is exactly the unlocked read-check-write that let two
        // follower tabs both read "no leader" and both declare themselves
        // leader. Instead, wait a fresh random delay (see computeClaimDelayMs
        // above) and only then re-check-and-write — see the comment on
        // CLAIM_DELAY_WINDOW_MS for what this does and does not guarantee
        // (it's race-reducing, not race-free). A claim already scheduled is
        // left alone: it will re-read the current state when it fires — this
        // guard is also what stops a second claimLeadership() call from
        // overwriting the ref and orphaning the first timer's handle.
        if (claimTimeoutRef.current === null) {
          claimTimeoutRef.current = setTimeout(() => {
            claimTimeoutRef.current = null;
            try {
              const stillExisting = JSON.parse(
                localStorage.getItem(LEADER_KEY) || "null",
              );
              const stillNow = Date.now();
              if (batimentoVigente(stillExisting, stillNow)) {
                updateLeadership(stillExisting.tabId === TAB_ID);
                return;
              }
              localStorage.setItem(
                LEADER_KEY,
                JSON.stringify({ tabId: TAB_ID, ts: Date.now() }),
              );
              updateLeadership(true);
            } catch {
              // Não grava (cheio/bloqueado): sem líder nenhuma aba traria
              // pedido novo, então o canal decide.
              modoCanalRef.current = true;
              reivindicarPeloCanal(imediato);
            }
          }, computeClaimDelayMs());
        }
        return isLeaderRef.current;
      } catch {
        // Não lê (bloqueado) ou valor ilegível: o canal decide.
        modoCanalRef.current = true;
        return reivindicarPeloCanal(imediato);
      }
    },
    [updateLeadership, reivindicarPeloCanal],
  );

  const refreshLeadership = useCallback(() => {
    if (!isLeaderRef.current) return;
    try {
      const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || "null");
      const minha = existing && existing.tabId === TAB_ID;
      // Líder pelo canal e o armazenamento voltou a responder: se nenhuma
      // outra aba o ocupa, ela volta a guardar o batimento nele.
      const deOutra =
        existing &&
        existing.tabId !== TAB_ID &&
        batimentoVigente(existing, Date.now());
      if (minha || (modoCanalRef.current && !deOutra)) {
        localStorage.setItem(
          LEADER_KEY,
          JSON.stringify({ tabId: TAB_ID, ts: Date.now() }),
        );
        modoCanalRef.current = false;
      } else {
        updateLeadership(false);
      }
    } catch {
      // Não lê/grava o batimento: segue líder e prova que está viva pelo
      // canal (falha do armazenamento nunca demove a líder).
      modoCanalRef.current = true;
      anunciarVida();
    }
  }, [updateLeadership, anunciarVida]);

  const resignLeadership = useCallback(() => {
    if (!isLeaderRef.current) return;
    try {
      localStorage.removeItem(LEADER_KEY);
      updateLeadership(false);
    } catch {
      /* silent */
    }
  }, [updateLeadership]);

  useEffect(() => {
    if (!bc) return;
    let leaderAliveReceived = false;

    const handleMessage = (e: MessageEvent) => {
      const { type, tabId } = e.data || {};
      if (type === "LEADER_PING") {
        if (isLeaderRef.current) {
          bc.postMessage({ type: "LEADER_ALIVE", tabId: TAB_ID });
        }
      } else if (type === "LEADER_ALIVE") {
        if (tabId !== TAB_ID) {
          leaderAliveReceived = true;
          alivesRecebidosRef.current += 1;
          batimentosSemSinalRef.current = 0;
          if (modoCanalRef.current && isLeaderRef.current && TAB_ID < tabId) {
            // Duas líderes pelo canal (sem armazenamento para arbitrar): a de
            // tabId MENOR fica e reafirma, para a outra ceder já. Sem regra
            // simétrica as duas se demoveriam e ficaria zero líderes.
            anunciarVida();
          } else {
            updateLeadership(false);
          }
        }
      } else if (type === "LEADER_RESIGNED") {
        if (tabId !== TAB_ID) {
          // Try to claim immediately
          claimLeadership();
        }
      }
    };

    bc.addEventListener("message", handleMessage);

    // Ping on mount
    bc.postMessage({ type: "LEADER_PING", tabId: TAB_ID });

    // Wait 120ms to see if an active leader responds
    const pingTimeout = setTimeout(() => {
      if (!leaderAliveReceived) {
        claimLeadership();
      }
    }, 120);

    // Heartbeat: refresh leadership every 2.5s if leader
    heartbeatRef.current = setInterval(() => {
      if (isLeaderRef.current) {
        refreshLeadership();
      } else {
        // Try to claim leadership if it expired
        claimLeadership(false);
      }
    }, LEADER_TTL / 2);

    // Release on tab unload
    const onUnload = () => {
      if (isLeaderRef.current) {
        bc.postMessage({ type: "LEADER_RESIGNED", tabId: TAB_ID });
      }
      resignLeadership();
    };
    window.addEventListener("beforeunload", onUnload);

    // realtimeSyncEngine-317: NÃO há mais renúncia/reivindicação por
    // VISIBILIDADE. Antes, 3s de aba escondida renunciavam à liderança — e o
    // efeito que sobe o RealtimeSyncEngine depende de `isLeader`, então cada
    // ida ao WhatsApp derrubava e reabria o websocket do app; a volta
    // reivindicava de novo (PING + 120ms + sorteio). Quem entrega a vaga de
    // verdade é o beforeunload (aba fechada); quem reclama vaga expirada é o
    // heartbeat (a instância escondida continua com o coração batendo), e a
    // guarda de `claimLeadership` para aba escondida continua valendo para
    // quem NÃO é líder — aba em segundo plano não começa a liderar, só deixa
    // de abandonar o posto.
    return () => {
      bc.removeEventListener("message", handleMessage);
      clearTimeout(pingTimeout);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (claimTimeoutRef.current) {
        clearTimeout(claimTimeoutRef.current);
        claimTimeoutRef.current = null;
      }
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [
    claimLeadership,
    refreshLeadership,
    resignLeadership,
    updateLeadership,
    anunciarVida,
  ]);

  return {
    isLeader,
    tabId: TAB_ID,
  };
}
