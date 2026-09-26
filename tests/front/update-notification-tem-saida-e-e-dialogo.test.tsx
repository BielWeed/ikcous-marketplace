// @vitest-environment jsdom
//
// O AVISO DE ATUALIZAÇÃO GANHA SAÍDA E SEMÂNTICA DE DIÁLOGO — frente pwa,
// tarefa UpdateNotification-138 (o cartão era um modal SEM SAÍDA: único
// botão "Atualizar Agora", backdrop pointer-events-auto cobrindo inset-0,
// needRefresh que nunca volta a false — o lojista com formulário meio
// preenchido ficava com a tela coberta até recarregar).
//
// O que esta suíte trava:
//   1. A SAÍDA: o botão "Depois" existe e adia (soneca de 1h guardada em
//      storage — F5 no meio da hora não reabre o modal na cara do lojista).
//   2. O DIÁLOGO: role=dialog + aria-modal + título referenciado, foco
//      inicial no "Depois" (um Enter batido sem querer não pode disparar o
//      reload), foco preso nos dois botões e Escape == "Depois".
//   3. A CORTESIA COM O ADMIN: com formulário do admin sujo (o mesmo sinal
//      isAdminDirty que o App já mantém), o aviso fica ARMADO mas não cobre
//      a tela — volta assim que o trabalho terminar.
//
// Padrão da casa: sem @testing-library/react — os componentes se montam com
// createRoot e se leem pelo DOM (mesma técnica de admin-orders-alertas-
// compactos.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let host: HTMLDivElement;
let raiz: Root;

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const botaoDepois = () =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Depois",
  );
const botaoAtualizar = () =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Atualizar Agora",
  );

describe("UpdateNotification — o cartão tem saída e é diálogo de verdade", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  async function montarCartao(
    props: {
      show?: boolean;
      onSnooze?: () => void;
      onUpdate?: () => void;
    } = {},
  ) {
    const { UpdateNotification } = await import(
      "@/components/pwa/UpdateNotification"
    );
    const onSnooze = props.onSnooze ?? vi.fn();
    await act(async () => {
      raiz.render(
        <UpdateNotification
          show={props.show ?? true}
          onUpdate={props.onUpdate ?? vi.fn()}
          onSnooze={onSnooze}
          newVersion="1.36.0"
        />,
      );
    });
    return { onSnooze };
  }

  it("tem SAÍDA: o botão 'Depois' existe e chama onSnooze", async () => {
    const { onSnooze } = await montarCartao();

    expect(botaoDepois()).toBeTruthy();
    await act(async () => {
      botaoDepois()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSnooze).toHaveBeenCalledTimes(1);
  });

  it("é diálogo de verdade: role=dialog, aria-modal e o título referenciado", async () => {
    await montarCartao();

    const dialogo = host.querySelector('[role="dialog"]');
    expect(dialogo).toBeTruthy();
    expect(dialogo!.getAttribute("aria-modal")).toBe("true");
    const tituloId = dialogo!.getAttribute("aria-labelledby");
    expect(tituloId).toBeTruthy();
    expect(document.getElementById(tituloId!)?.textContent).toContain(
      "Nova Versão Disponível",
    );
  });

  it("Escape == 'Depois' — e ENQUANTO instala, Escape não faz nada (o reload já está a caminho)", async () => {
    const { onSnooze } = await montarCartao();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onSnooze).toHaveBeenCalledTimes(1);

    // Entrando em instalação: o Escape perde o poder de cancelar — o SW
    // ficaria em estado incerto no meio do reload.
    await act(async () => {
      botaoAtualizar()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onSnooze).toHaveBeenCalledTimes(1);
  });

  it("o foco inicial vai para 'Depois' — Enter batido sem querer não pode disparar o reload", async () => {
    await montarCartao();

    expect(document.activeElement).toBe(botaoDepois());
  });

  it("Tab/Shift+Tab não deixam o foco escapar do diálogo", async () => {
    // A DOM ordem é [Atualizar, Depois]: as transições NATIVAS do navegador
    // são Atualizar→Depois (Tab) e Depois→Atualizar (Shift+Tab). As que o
    // componente PRECISA segurar são as que FUGEM do cartão: Tab no último
    // (Depois) e Shift+Tab no primeiro (Atualizar). O jsdom não executa a
    // travessia nativa de foco, então só o par segurado é asserível aqui —
    // e é exatamente ele que prova a armadilha.
    await montarCartao();

    expect(document.activeElement).toBe(botaoDepois());
    await act(async () => {
      botaoDepois()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(botaoAtualizar());
    await act(async () => {
      botaoAtualizar()!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(botaoDepois());
  });

  it("ACIONAMENTO ÚNICO e imediato: 'Atualizar Agora' chama onUpdate UMA vez, sem atraso artificial", async () => {
    // RELÓGIO REAL de propósito (peça 22/09): fake timers falsificam também
    // o relógio que alimenta requestAnimationFrame/performance do driver de
    // animação (framer-motion) e contaminam os testes de soneca deste
    // arquivo. A prova de "sem atraso tardio" é uma espera delimitada MAIOR
    // que o antigo atraso artificial (1200ms) — as asserções não mudam.
    const onUpdate = vi.fn();
    await montarCartao({ onUpdate });

    await act(async () => {
      botaoAtualizar()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // O apply é acionado NO clique (o prazo de segurança mora no
    // aplicarAtualizacaoPendenteERecarregar, não aqui).
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Passado o instante em que o antigo `setTimeout(onUpdate, 1200)`
    // dispararia: nada de segunda chamada.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("espera HONESTA: anuncia 'Instalando atualização...' sem porcentagem e sem sucesso antecipado", async () => {
    await montarCartao();
    await act(async () => {
      botaoAtualizar()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const tela = host.textContent ?? "";
    expect(tela).toContain("Instalando atualização");
    // A barra de progresso simulada (0→100% inventados, com o número na
    // tela) morreu: nenhuma porcentagem, nenhum "Atualizado" antecipado.
    expect(/\d+%/.test(tela)).toBe(false);
    expect(tela).not.toContain("Atualizado");
    // O anúncio é acessível: região viva para o leitor de tela.
    const anuncio = host.querySelector('[aria-live="polite"]');
    expect(anuncio?.textContent).toContain("Instalando atualização");
  });
});

// O gate é quem decide QUANDO o cartão mostra — a soneca mora aqui (storage
// + estado), e a cortesia com o admin sujo também.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/hooks/useRealtimeUpdate", () => ({
  useRealtimeUpdate: vi.fn(),
}));

vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: vi.fn(),
    updateAvailable: true,
    newVersion: "1.36.0",
    performNuclearPurge: vi.fn(),
  }),
}));

vi.mock("@/lib/recuperacao-chunk", () => ({
  aplicarAtualizacaoPendenteERecarregar: vi.fn(),
}));

// A soneca é testada com o RELÓGIO REAL e prazos curtos semeados no
// storage: sob fake timers a animação de saída do framer-motion (AnimatePresence)
// não termina de forma confiável e o nó fica no DOM durante a transição,
// o que faria qualquer asserção de ausência mentir. O mecanismo é o mesmo
// para 150ms e para 1h — o que muda é só o instante gravado.
const CHAVE_SNOOZE = "pwa_update_snooze_until";

function esperar(ms: number) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function montarGate(adminDirty?: boolean) {
  const { PWAUpdateManager } = await import("@/components/pwa/PWAUpdateGate");
  await act(async () => {
    raiz.render(
      <PWAUpdateManager
        currentView="home"
        {...(adminDirty === undefined ? {} : { adminDirty })}
      />,
    );
  });
}

describe("PWAUpdateGate — a soneca de 1h e a cortesia com o admin", () => {
  // O globalThis.localStorage do runner é o experimental do Node (quebrado
  // sem --localstorage-file): os storages são dublês Map-based, o MESMO
  // padrão dos outros testes da casa.
  let armazem: Map<string, string>;
  let armazemDeSessao: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    armazemDeSessao = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => armazemDeSessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazemDeSessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazemDeSessao.delete(chave);
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("'Depois' esconde o aviso agora, grava ≈1h no storage e um F5 no meio do soneca NÃO reabre o modal", async () => {
    await montarGate();
    expect(botaoAtualizar()).toBeTruthy();

    await act(async () => {
      botaoDepois()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // A saída é animada (~300ms); esperado de verdade, não com timer falso.
    await esperar(900);
    expect(botaoAtualizar()).toBeUndefined();

    // O prazo gravado é ≈1h à frente (a fonte do F5 sobreviver).
    const gravado = Number(armazem.get(CHAVE_SNOOZE));
    const restanteMin = (gravado - Date.now()) / 60000;
    expect(restanteMin).toBeGreaterThan(55);
    expect(restanteMin).toBeLessThan(65);

    // "F5": desmonta e monta uma instância NOVA lendo o mesmo storage.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(host);
    await montarGate();
    await esperar(900);
    expect(botaoAtualizar()).toBeUndefined();
  });

  it("o soneca EXPIRA sozinho: o aviso volta sem troca de tela nem ping do realtime", async () => {
    // Semeia um prazo que vence em ~1,5s (mesmo mecanismo do default de 1h).
    armazem.set(CHAVE_SNOOZE, String(Date.now() + 1500));

    await montarGate();
    // Dentro do soneca: escondido (depois da animação de entrada/saída).
    await esperar(900);
    expect(botaoAtualizar()).toBeUndefined();

    // Passado o prazo: o efeito do soneca desarma sozinho e o aviso volta.
    await esperar(1400);
    expect(botaoAtualizar()).toBeTruthy();
  });

  it("cortesia com o admin: com formulário sujo o aviso fica ARMADO mas não cobre a tela; salvo, ele volta", async () => {
    await montarGate(true);
    // updateAvailable é true no mock — se o dirty não estivesse sendo
    // respeitado, o cartão já teria nascido cobrindo tudo.
    expect(botaoAtualizar()).toBeUndefined();

    // O lojista salva (dirty sai): o aviso armado aparece na tela segura.
    await esperar(600);
    await montarGate(false);
    expect(botaoAtualizar()).toBeTruthy();
  });
});
