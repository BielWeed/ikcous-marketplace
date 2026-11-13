// @vitest-environment jsdom
//
// A bolinha de devoluções do botão da tela de Pedidos lia a contagem UMA vez
// (quando a tela abria). A lojista deixa Pedidos aberto, bloqueia o celular,
// chega uma solicitação, e ao voltar o número era o antigo. Agora o hook relê
// quando a página volta a ficar visível e quando o painel pede recontagem
// (`admin:recontar-avisos`), sempre mantendo o número anterior enquanto relê.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucoesAbertas } from "@/hooks/useDevolucoesAdmin";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

/** Resposta da RPC só com a contagem por status que o botão lê. */
function comSolicitadas(n: number): Resposta {
  return {
    data: { total: n, contagem: { solicitada: n }, itens: [] },
    error: null,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let lido: ReturnType<typeof useDevolucoesAbertas>;

function Sonda({ ativo }: { ativo: boolean }) {
  const resultado = useDevolucoesAbertas(ativo);
  useEffect(() => {
    lido = resultado;
  });
  return null;
}

async function montar(ativo: boolean) {
  await act(async () => {
    raiz.render(<Sonda ativo={ativo} />);
  });
}

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

async function voltarAoApp() {
  await act(async () => {
    definirVisibilidade("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function pedirRecontagem() {
  await act(async () => {
    window.dispatchEvent(new Event("admin:recontar-avisos"));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpc.mockReset();
  definirVisibilidade("visible");
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("bolinha de devoluções: relê a contagem", () => {
  it("ao voltar a ficar visível, passa a mostrar o número novo", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);
    expect(lido).toEqual({ abertas: 2, solicitadas: 2 });

    rpc.mockResolvedValueOnce(comSolicitadas(5));
    await voltarAoApp();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(lido).toEqual({ abertas: 5, solicitadas: 5 });
  });

  it("zerada na abertura, a bolinha acende quando chega solicitação", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(0));
    await montar(true);
    expect(lido).toEqual({ abertas: 0, solicitadas: 0 });

    rpc.mockResolvedValueOnce(comSolicitadas(1));
    await voltarAoApp();

    expect(lido).toEqual({ abertas: 1, solicitadas: 1 });
  });

  it("quando o painel pede recontagem, passa a mostrar o número novo", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(3));
    await montar(true);
    expect(lido.abertas).toBe(3);

    rpc.mockResolvedValueOnce(comSolicitadas(4));
    await pedirRecontagem();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(lido).toEqual({ abertas: 4, solicitadas: 4 });
  });

  it("com a página escondida não consulta", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);

    await act(async () => {
      definirVisibilidade("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("enquanto relê, mantém o número anterior", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);

    const lenta = pendente();
    rpc.mockReturnValueOnce(lenta.promessa);
    await voltarAoApp();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(lido).toEqual({ abertas: 2, solicitadas: 2 });

    await act(async () => {
      lenta.resolver(comSolicitadas(6));
      await Promise.resolve();
    });
    expect(lido).toEqual({ abertas: 6, solicitadas: 6 });
  });

  it("resposta atrasada de uma leitura antiga não sobrescreve a mais nova", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);

    const antiga = pendente();
    rpc.mockReturnValueOnce(antiga.promessa);
    await voltarAoApp();

    rpc.mockResolvedValueOnce(comSolicitadas(7));
    await pedirRecontagem();
    expect(lido).toEqual({ abertas: 7, solicitadas: 7 });

    await act(async () => {
      antiga.resolver(comSolicitadas(3));
      await Promise.resolve();
    });
    expect(lido).toEqual({ abertas: 7, solicitadas: 7 });
  });

  it("erro do servidor na releitura mantém o número anterior", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(4));
    await montar(true);

    rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
    await voltarAoApp();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(lido).toEqual({ abertas: 4, solicitadas: 4 });
  });

  it("rede que cai (promessa rejeitada) na releitura mantém o número anterior", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(4));
    await montar(true);

    rpc.mockRejectedValueOnce(new Error("sem rede"));
    await pedirRecontagem();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(lido).toEqual({ abertas: 4, solicitadas: 4 });
  });
});

describe("bolinha de devoluções: só relê quando está ativa", () => {
  it("inativa não consulta nem escuta", async () => {
    await montar(false);
    await voltarAoApp();
    await pedirRecontagem();

    expect(rpc).not.toHaveBeenCalled();
    expect(lido).toEqual({ abertas: null, solicitadas: 0 });
  });

  it("ao ficar inativa, para de escutar", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);
    await montar(false);

    await voltarAoApp();
    await pedirRecontagem();

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("depois de desmontar, não consulta mais", async () => {
    rpc.mockResolvedValueOnce(comSolicitadas(2));
    await montar(true);
    await act(async () => raiz.unmount());

    await voltarAoApp();
    await pedirRecontagem();

    expect(rpc).toHaveBeenCalledTimes(1);
    raiz = createRoot(hospedeiro);
  });
});
