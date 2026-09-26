// @vitest-environment jsdom
//
// PEÇA 22/09 — FIM DOS AVISOS PARALELOS: o useRealtimeUpdate emitia toast.info
// PRÓPRIO ("Nova atualização disponível (Realtime)", no líder e na aba
// secundária) com a versão CRUA do payload ("1.5.1-sha.abc1234..."). Eram
// avisos concorrentes do gate único (UpdateNotification) — e ignoravam
// "Depois"/soneca, telas de compra e admin dirty, que só o gate respeita.
//
// Contrato preso aqui: o ping ACIONA (deep checkUpdate via callback) e o
// líder PROPAGA às abas secundárias — mas NENHUM dos dois caminhos emite
// toast. Se o toast voltar, a chamada aparece no espião de sonner e a suíte
// reprova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Espião de sonner: o hook NÃO DEVE mais chamar; o mock garante que uma
// recaída do toast apareça aqui e reprove.
const toastEspiao = {
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};
vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastEspiao.info(...args),
    success: (...args: unknown[]) => toastEspiao.success(...args),
    error: (...args: unknown[]) => toastEspiao.error(...args),
    warning: (...args: unknown[]) => toastEspiao.warning(...args),
  },
}));

const canalMock = {
  on: vi.fn(),
  subscribe: vi.fn(),
};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => canalMock,
    removeChannel: () => Promise.resolve(),
  },
}));

let lider = true;
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: lider }),
}));

// O BroadcastChannel não existe no runner (jsdom): dublê que captura as
// instâncias para provar a propagação líder → secundárias. Campos de classe
// explícitos: `erasableSyntaxOnly` do tsconfig proíbe parâmetro-propriedade.
class CanalDeTeste {
  static instancias: CanalDeTeste[] = [];
  nome: string;
  onmessage: ((evento: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(nome: string) {
    this.nome = nome;
    CanalDeTeste.instancias.push(this);
  }
}

function Prova({ aoPing }: { aoPing: (versao?: string) => void }) {
  useRealtimeUpdate(aoPing, "usuario-1");
  return null;
}

describe("useRealtimeUpdate — o ping aciona e propaga, mas NUNCA avisa por conta própria", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let aoPing: Mock<(versao?: string) => void>;

  beforeEach(() => {
    lider = true;
    CanalDeTeste.instancias = [];
    canalMock.on.mockReset();
    canalMock.on.mockImplementation(() => canalMock);
    canalMock.subscribe.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    aoPing = vi.fn<(versao?: string) => void>();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("LÍDER: deploy-ping aciona o callback, propaga às abas secundárias e NÃO emite toast", async () => {
    vi.stubGlobal("BroadcastChannel", CanalDeTeste);
    vi.useFakeTimers();
    await act(async () => {
      raiz.render(<Prova aoPing={aoPing} />);
    });
    // A assinatura do canal Realtime é adiada em 400ms dentro do hook.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(canalMock.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "deploy-ping" },
      expect.any(Function),
    );

    const chamadaBroadcast = canalMock.on.mock.calls.find(
      (argumentos) => argumentos[0] === "broadcast",
    )!;
    const aoReceber = chamadaBroadcast[2] as (payload: unknown) => void;
    await act(async () => {
      aoReceber({ payload: { version: "1.5.1-sha.abc1234" } });
    });

    // O callback (deep checkUpdate no gate) continua sendo chamado...
    expect(aoPing).toHaveBeenCalledTimes(1);
    expect(aoPing).toHaveBeenCalledWith("1.5.1-sha.abc1234");
    // ...a propagação para as outras abas continua...
    const canalLocal = CanalDeTeste.instancias.at(-1)!;
    expect(canalLocal.postMessage).toHaveBeenCalledWith({
      type: "deploy-ping",
      payload: { version: "1.5.1-sha.abc1234" },
    });
    // ...e o aviso paralelo NÃO existe: quem avisa é o gate único.
    expect(toastEspiao.info).not.toHaveBeenCalled();
  });

  it("ABA SECUNDÁRIA: ping via BroadcastChannel aciona o callback, sem toast e sem repropagar", async () => {
    vi.stubGlobal("BroadcastChannel", CanalDeTeste);
    lider = false;
    await act(async () => {
      raiz.render(<Prova aoPing={aoPing} />);
    });

    const canalLocal = CanalDeTeste.instancias.at(-1)!;
    expect(canalLocal.onmessage).toBeTypeOf("function");

    await act(async () => {
      canalLocal.onmessage!({
        data: {
          type: "deploy-ping",
          payload: { version: "1.5.1-sha.abc1234" },
        },
      });
    });

    expect(aoPing).toHaveBeenCalledTimes(1);
    expect(aoPing).toHaveBeenCalledWith("1.5.1-sha.abc1234");
    expect(toastEspiao.info).not.toHaveBeenCalled();
    // A propagação é papel do LÍDER; a secundária não retransmite.
    expect(canalLocal.postMessage).not.toHaveBeenCalled();
  });
});
