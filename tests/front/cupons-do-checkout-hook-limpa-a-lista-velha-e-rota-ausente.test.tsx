// @vitest-environment jsdom
//
// `useCuponsDoCheckout` nos limites que o caminho feliz não mostra:
//  - a lista de cupons é de UM subtotal e UMA conta: falha (exceção), loja que
//    desliga os cupons e troca de conta esvaziam a lista na hora, nunca deixam
//    o "faltam R$ X" velho na tela;
//  - rota 404 é banco antigo ("indisponível"); outro status é falha ("erro");
//  - "Tentar de novo" não consulta com os cupons desligados nem com a RPC ausente.
import { useCuponsDoCheckout } from "@/hooks/useCuponsDoCheckout";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn<(nome: string, args: unknown) => unknown>());
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (nome: string, args: unknown) => rpc(nome, args) },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Props {
  subtotal: number;
  userId: string | null;
  ligado: boolean;
}
type Visto = ReturnType<typeof useCuponsDoCheckout>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: Visto;

function Sonda(props: Props) {
  const valor = useCuponsDoCheckout(props);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}
async function renderizar(props: Props) {
  await act(async () => {
    raiz.render(<Sonda {...props} />);
  });
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const PAUSA = 450;
const codigos = () => ultimo.cupons.map((c) => c.codigo);

const linha = (codigo: string) => ({
  codigo,
  tipo: "fixed",
  valor: 10,
  minimo: 100,
  valido_ate: null,
  exclusivo: false,
  aplica: false,
  falta: 30,
  desconto: 0,
});

/** Monta com a lista "A" já na tela (conta u1, subtotal 70). */
async function comListaNaTela(ligado = true) {
  rpc.mockResolvedValueOnce({ data: [linha("A")], error: null });
  await renderizar({ subtotal: 70, userId: "u1", ligado });
  await passar(PAUSA);
  expect(ultimo.situacao).toBe("pronto");
  expect(codigos()).toEqual(["A"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useCuponsDoCheckout — lista velha, rota ausente e tentar de novo", () => {
  it("a nova busca LANÇA exceção: a lista de antes sai da tela e a seção cai no campo de digitar", async () => {
    await comListaNaTela();
    rpc.mockImplementationOnce(() => {
      throw new Error("cliente quebrado");
    });
    await renderizar({ subtotal: 90, userId: "u1", ligado: true });
    await passar(PAUSA);
    expect(codigos()).toEqual([]);
    expect(ultimo.situacao).toBe("indisponivel");
  });

  it("a nova busca ESTOURA o prazo de rede: lista de antes sai e aparece 'erro' (tentar de novo)", async () => {
    await comListaNaTela();
    rpc.mockReturnValueOnce(new Promise(() => {}));
    await renderizar({ subtotal: 90, userId: "u1", ligado: true });
    await passar(PAUSA);
    await passar(60_000);
    expect(codigos()).toEqual([]);
    expect(ultimo.situacao).toBe("erro");
  });

  it("a loja desliga os cupons: a lista some e vira 'indisponivel'", async () => {
    await comListaNaTela();
    await renderizar({ subtotal: 70, userId: "u1", ligado: false });
    expect(codigos()).toEqual([]);
    expect(ultimo.situacao).toBe("indisponivel");
  });

  it("troca de conta: some a lista da conta anterior e fica 'carregando' ANTES da pausa da nova busca", async () => {
    await comListaNaTela();
    rpc.mockResolvedValueOnce({ data: [linha("DA-OUTRA")], error: null });
    await renderizar({ subtotal: 70, userId: "u2", ligado: true });
    expect(codigos()).toEqual([]);
    expect(ultimo.situacao).toBe("carregando");
    expect(rpc).toHaveBeenCalledTimes(1);
    await passar(PAUSA);
    expect(codigos()).toEqual(["DA-OUTRA"]);
    expect(ultimo.situacao).toBe("pronto");
  });

  it("status 404 (rota ausente) é banco antigo: 'indisponivel', sem erro e sem nova busca", async () => {
    rpc.mockResolvedValue({ data: null, error: { status: 404 } });
    await renderizar({ subtotal: 50, userId: null, ligado: true });
    await passar(PAUSA);
    expect(ultimo.situacao).toBe("indisponivel");
    await renderizar({ subtotal: 80, userId: null, ligado: true });
    await passar(PAUSA);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("outro status de falha (405) NÃO é banco antigo: vira 'erro' e continua tentando", async () => {
    rpc.mockResolvedValue({ data: null, error: { status: 405 } });
    await renderizar({ subtotal: 50, userId: null, ligado: true });
    await passar(PAUSA);
    expect(ultimo.situacao).toBe("erro");
    await renderizar({ subtotal: 80, userId: null, ligado: true });
    await passar(PAUSA);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("tentarDeNovo com os cupons desligados não consulta nada", async () => {
    await renderizar({ subtotal: 70, userId: "u1", ligado: false });
    await passar(PAUSA);
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    await passar(PAUSA);
    expect(rpc).not.toHaveBeenCalled();
    expect(ultimo.situacao).toBe("indisponivel");
  });

  it("tentarDeNovo com a RPC ausente no banco não consulta de novo", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await renderizar({ subtotal: 70, userId: "u1", ligado: true });
    await passar(PAUSA);
    expect(ultimo.situacao).toBe("indisponivel");
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    await passar(PAUSA);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(ultimo.situacao).toBe("indisponivel");
  });

  it("tentarDeNovo depois de erro: volta a 'carregando', busca com o subtotal de agora e entrega a lista", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await renderizar({ subtotal: 70, userId: "u1", ligado: true });
    await passar(PAUSA);
    expect(ultimo.situacao).toBe("erro");
    rpc.mockResolvedValueOnce({ data: [linha("B")], error: null });
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    expect(rpc).toHaveBeenLastCalledWith("cupons_do_checkout", {
      p_subtotal: 70,
    });
    expect(codigos()).toEqual(["B"]);
    expect(ultimo.situacao).toBe("pronto");
  });
});
