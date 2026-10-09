// @vitest-environment jsdom
//
// Frente B (28/09/2026): o hook que busca a lista de cupons do checkout.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Retorno = ReturnType<
  typeof import("@/hooks/useCuponsDoCheckout").useCuponsDoCheckout
>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: Retorno | null = null;

async function montar(props: {
  subtotal: number;
  userId: string | null;
  ligado: boolean;
}) {
  const { useCuponsDoCheckout } = await import("@/hooks/useCuponsDoCheckout");
  function Sonda(p: typeof props) {
    const valor = useCuponsDoCheckout(p);
    // Escrita fora do render (regra do React Compiler): o efeito sem deps
    // roda a cada render e publica o último valor para o teste.
    useEffect(() => {
      ultimo = valor;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda {...props} />);
  });
  return async (novas: typeof props) => {
    await act(async () => {
      raiz.render(<Sonda {...novas} />);
    });
  };
}

const esperarPausa = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
};

const linha = (codigo: string) => ({
  codigo,
  tipo: "fixed",
  valor: 10,
  minimo: 0,
  valido_ate: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 10,
});

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  ultimo = null;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useCuponsDoCheckout", () => {
  it("busca com o subtotal depois da pausa e lê a lista", async () => {
    rpc.mockResolvedValue({ data: [linha("A")], error: null });
    await montar({ subtotal: 120, userId: null, ligado: true });
    expect(ultimo?.situacao).toBe("carregando");
    expect(rpc).not.toHaveBeenCalled();
    await esperarPausa();
    expect(rpc).toHaveBeenCalledWith("cupons_do_checkout", {
      p_subtotal: 120,
    });
    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["A"]);
  });

  it("loja com cupons desligados: não busca", async () => {
    await montar({ subtotal: 120, userId: null, ligado: false });
    await esperarPausa();
    expect(rpc).not.toHaveBeenCalled();
    expect(ultimo?.situacao).toBe("indisponivel");
  });

  it("banco sem a RPC (PGRST202): indisponível e não tenta mais", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const trocar = await montar({ subtotal: 50, userId: null, ligado: true });
    await esperarPausa();
    expect(ultimo?.situacao).toBe("indisponivel");
    await trocar({ subtotal: 80, userId: null, ligado: true });
    await esperarPausa();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falha de rede: erro, e 'tentar de novo' busca de novo", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Failed to fetch" },
    });
    await montar({ subtotal: 50, userId: null, ligado: true });
    await esperarPausa();
    expect(ultimo?.situacao).toBe("erro");
    rpc.mockResolvedValueOnce({ data: [linha("B")], error: null });
    await act(async () => {
      ultimo?.tentarDeNovo();
    });
    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["B"]);
  });

  it("falha depois de mudar o subtotal tira a lista velha da tela", async () => {
    // Revisão, M3: os "faltam R$ X" eram do subtotal anterior.
    rpc.mockResolvedValueOnce({ data: [linha("A")], error: null });
    const trocar = await montar({ subtotal: 50, userId: null, ligado: true });
    await esperarPausa();
    expect(ultimo?.cupons).toHaveLength(1);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Failed to fetch" },
    });
    await trocar({ subtotal: 90, userId: null, ligado: true });
    await esperarPausa();
    expect(ultimo?.situacao).toBe("erro");
    expect(ultimo?.cupons).toEqual([]);
  });

  it("resposta atrasada de um subtotal velho é descartada", async () => {
    let soltarVelha: (v: unknown) => void = () => {};
    rpc
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            soltarVelha = r;
          }),
      )
      .mockResolvedValueOnce({ data: [linha("NOVA")], error: null });
    const trocar = await montar({ subtotal: 50, userId: null, ligado: true });
    await esperarPausa();
    await trocar({ subtotal: 90, userId: null, ligado: true });
    await esperarPausa();
    await act(async () => {
      soltarVelha({ data: [linha("VELHA")], error: null });
    });
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["NOVA"]);
  });

  it("troca de conta apaga a lista da conta anterior NA HORA", async () => {
    rpc.mockResolvedValueOnce({ data: [linha("DAANA")], error: null });
    const trocar = await montar({ subtotal: 50, userId: "ana", ligado: true });
    await esperarPausa();
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["DAANA"]);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await trocar({ subtotal: 50, userId: "bia", ligado: true });
    // Antes de a nova busca responder, a lista da Ana já sumiu.
    expect(ultimo?.cupons).toEqual([]);
    await esperarPausa();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("resposta da conta anterior que chega DEPOIS da troca é descartada", async () => {
    // O pior caso de vazamento: o exclusivo da Ana ainda em voo quando a Bia
    // entra na mesma aba — a resposta da Ana não pode aparecer para a Bia.
    let soltarDaAna: (v: unknown) => void = () => {};
    rpc
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            soltarDaAna = r;
          }),
      )
      .mockResolvedValueOnce({ data: [linha("DABIA")], error: null });
    const trocar = await montar({ subtotal: 50, userId: "ana", ligado: true });
    await esperarPausa();
    await trocar({ subtotal: 50, userId: "bia", ligado: true });
    // Antes da pausa da Bia terminar, a resposta da Ana chega.
    await act(async () => {
      soltarDaAna({ data: [linha("DAANA")], error: null });
    });
    expect(ultimo?.cupons).toEqual([]);
    await esperarPausa();
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["DABIA"]);
  });

  it("lista vazia do servidor é 'pronto' sem cartões (não erro)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await montar({ subtotal: 0, userId: null, ligado: true });
    await esperarPausa();
    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("cupons_do_checkout", { p_subtotal: 0 });
  });
});
