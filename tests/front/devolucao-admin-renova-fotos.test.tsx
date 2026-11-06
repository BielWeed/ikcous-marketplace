// @vitest-environment jsdom
// As fotos da cliente na ficha do painel vêm por endereço assinado de 10 min
// (600 s, política da casa). Sem renovar, o link e a miniatura morrem com a
// ficha ainda aberta. O hook renova SÓ as fotos (sem reler a ficha) a cada
// ~8 min e quando a aba volta ao primeiro plano.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ createSignedUrl }) } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const OITO_MIN = 8 * 60 * 1000;

const COM_FOTOS = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "recebida",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: ["a.jpg", "b.jpg"],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: null,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-10-16T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};
const SEM_FOTOS = { ...COM_FOTOS, fotos: [] };
const OUTRA_FICHA = { ...COM_FOTOS, id: "dev-b", fotos: ["c.jpg"] };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucaoAdmin>;
let geracao = 0;

function Sonda({ id }: { id: string | null }) {
  const lida = useDevolucaoAdmin(id);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

/** Cada assinatura devolve um endereço novo: `<caminho>?v=<n-da-chamada>`. */
function assinaturasNumeradas() {
  createSignedUrl.mockImplementation((caminho: string) =>
    Promise.resolve({
      data: { signedUrl: `https://foto.test/${caminho}?v=${++geracao}` },
      error: null,
    }),
  );
}

function mostrarAba(visivel: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visivel ? "visible" : "hidden"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function abrir(ficha: unknown, id = "dev-a") {
  rpc.mockResolvedValue({ data: ficha, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda id={id} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  geracao = 0;
  assinaturasNumeradas();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  // o jsdom é compartilhado entre testes: volta a aba para "visível"
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  vi.useRealTimers();
});

describe("ficha do painel renova as fotos da cliente antes de expirarem", () => {
  it("depois de 8 min assina de novo e as fotos trocam de endereço, sem reler a ficha", async () => {
    await abrir(COM_FOTOS);
    const antes = leitura.fotos.get("a.jpg");
    expect(antes).toBe("https://foto.test/a.jpg?v=1");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    await passar(OITO_MIN - 1000);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    await passar(1000);
    expect(createSignedUrl).toHaveBeenCalledTimes(4);
    expect(createSignedUrl).toHaveBeenLastCalledWith(expect.any(String), 600);
    expect(leitura.fotos.get("a.jpg")).not.toBe(antes);
    expect(leitura.fotos.get("a.jpg")).toBe("https://foto.test/a.jpg?v=3");
    expect(leitura.fotos.get("b.jpg")).toBe("https://foto.test/b.jpg?v=4");
    // só as fotos: a ficha não é relida
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("segue renovando a cada 8 min, não só uma vez", async () => {
    await abrir(COM_FOTOS);
    await passar(OITO_MIN);
    await passar(OITO_MIN);
    expect(createSignedUrl).toHaveBeenCalledTimes(6);
    expect(leitura.fotos.get("a.jpg")).toBe("https://foto.test/a.jpg?v=5");
  });

  it("a aba voltando ao primeiro plano renova na hora; aba escondida não", async () => {
    await abrir(COM_FOTOS);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    await act(async () => mostrarAba(false));
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    await act(async () => mostrarAba(true));
    expect(createSignedUrl).toHaveBeenCalledTimes(4);
    expect(leitura.fotos.get("a.jpg")).toBe("https://foto.test/a.jpg?v=3");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("ficha sem fotos não renova nada", async () => {
    await abrir(SEM_FOTOS);
    await passar(OITO_MIN * 2);
    await act(async () => mostrarAba(true));
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falha na renovação mantém as fotos já mostradas e tenta de novo na próxima", async () => {
    await abrir(COM_FOTOS);
    const a = leitura.fotos.get("a.jpg");
    const b = leitura.fotos.get("b.jpg");

    createSignedUrl.mockImplementation((caminho: string) =>
      caminho === "a.jpg"
        ? Promise.resolve({ data: null, error: { message: "falhou" } })
        : Promise.reject(new Error("rede")),
    );
    await passar(OITO_MIN);
    expect(createSignedUrl).toHaveBeenCalledTimes(4);
    expect(leitura.fotos.get("a.jpg")).toBe(a);
    expect(leitura.fotos.get("b.jpg")).toBe(b);

    assinaturasNumeradas();
    await passar(OITO_MIN);
    expect(leitura.fotos.get("a.jpg")).toMatch(/\?v=\d+$/);
    expect(leitura.fotos.get("a.jpg")).not.toBe(a);
    expect(leitura.fotos.get("b.jpg")).not.toBe(b);
  });

  it("desmontar a ficha limpa o intervalo e o ouvinte da aba", async () => {
    await abrir(COM_FOTOS);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const chamadas = createSignedUrl.mock.calls.length;

    act(() => raiz.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await passar(OITO_MIN * 2);
    await act(async () => mostrarAba(true));
    expect(createSignedUrl).toHaveBeenCalledTimes(chamadas);

    // o afterEach desmonta de novo: recria a raiz para não desmontar duas vezes
    raiz = createRoot(hospedeiro);
  });

  it("renovação lenta da ficha anterior não troca as fotos da ficha nova", async () => {
    await abrir(COM_FOTOS);

    let soltar!: () => void;
    const lenta = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    createSignedUrl.mockImplementation(async (caminho: string) => {
      await lenta;
      return {
        data: { signedUrl: `https://foto.test/velha/${caminho}` },
        error: null,
      };
    });
    await passar(OITO_MIN);

    assinaturasNumeradas();
    rpc.mockResolvedValue({ data: OUTRA_FICHA, error: null });
    await act(async () => raiz.render(<Sonda id="dev-b" />));
    expect(leitura.detalhe?.id).toBe("dev-b");
    expect(leitura.fotos.get("c.jpg")).toMatch(/foto\.test\/c\.jpg\?v=/);

    await act(async () => {
      soltar();
      await Promise.resolve();
    });
    expect(leitura.fotos.has("a.jpg")).toBe(false);
    expect(leitura.fotos.get("c.jpg")).toMatch(/foto\.test\/c\.jpg\?v=/);
  });

  it("releitura da ficha no meio da renovação não é sobrescrita por assinatura velha", async () => {
    await abrir(COM_FOTOS);

    let soltar!: () => void;
    const lenta = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    createSignedUrl.mockImplementation(async (caminho: string) => {
      await lenta;
      return {
        data: { signedUrl: `https://foto.test/velha/${caminho}` },
        error: null,
      };
    });
    await passar(OITO_MIN);

    assinaturasNumeradas();
    await act(async () => leitura.recarregar());
    const nova = leitura.fotos.get("a.jpg");
    expect(nova).toMatch(/foto\.test\/a\.jpg\?v=/);

    await act(async () => {
      soltar();
      await Promise.resolve();
    });
    expect(leitura.fotos.get("a.jpg")).toBe(nova);
  });
});
