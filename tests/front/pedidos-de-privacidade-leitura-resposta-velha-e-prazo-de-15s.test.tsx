// @vitest-environment jsdom
//
// `usePedidosDePrivacidade`: a leitura da lista da cliente.
//  - resposta boa vira lista (linha de forma estranha some) e carga "pronta";
//  - a resposta de uma leitura VELHA (outra conta, ou releitura) não passa por
//    cima da nova, nem quando é boa nem quando é erro;
//  - consulta que não responde vira "erro" em 15 s (nem antes, nem muito depois);
//  - o envio de um pedido sem resposta devolve falha de rede em 15 s, solta a
//    trava do botão e relê a lista.
// Dados inventados (*.invalid): nenhum dado real de cliente.
import { usePedidosDePrivacidade } from "@/hooks/usePedidosDePrivacidade";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  leituras: 0,
  // Cada leitura consome a próxima função daqui (ou resolve `padraoDaLista`).
  proximasLeituras: [] as Array<() => Promise<Resposta>>,
  padraoDaLista: { data: [], error: null } as Resposta,
  proximasInsercoes: [] as Array<() => Promise<Resposta>>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => {
            banco.leituras += 1;
            const proxima = banco.proximasLeituras.shift();
            return proxima ? proxima() : Promise.resolve(banco.padraoDaLista);
          },
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => {
            const proxima = banco.proximasInsercoes.shift();
            return proxima
              ? proxima()
              : Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  },
}));

function linha(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: "conta-a",
    tipo: "excluir_conta",
    email_novo: null,
    situacao: "aberto",
    criado_em: "2026-11-01T12:00:00Z",
    atendido_em: null,
    observacao: null,
    ...extra,
  };
}

function adiada() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

let atual: ReturnType<typeof usePedidosDePrivacidade>;
function Sonda({ userId }: { userId: string | null }) {
  const hook = usePedidosDePrivacidade(userId);
  useEffect(() => {
    atual = hook;
  }, [hook]);
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function renderizar(userId: string | null) {
  await act(async () => {
    raiz.render(<Sonda userId={userId} />);
  });
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const ids = () => atual.pedidos.map((p) => p.id);

beforeEach(() => {
  vi.useFakeTimers();
  banco.leituras = 0;
  banco.proximasLeituras = [];
  banco.padraoDaLista = { data: [], error: null };
  banco.proximasInsercoes = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("usePedidosDePrivacidade — leitura da lista", () => {
  it("resposta boa: carga 'pronta' com os pedidos, e linha de forma estranha some", async () => {
    banco.padraoDaLista = {
      data: [
        linha("ped-1"),
        linha("ped-torto", { tipo: "apagar_tudo" }),
        linha("ped-2", {
          tipo: "corrigir_email",
          email_novo: "x@exemplo.invalid",
        }),
      ],
      error: null,
    };
    await renderizar("conta-a");
    expect(atual.carga).toBe("pronta");
    expect(ids()).toEqual(["ped-1", "ped-2"]);
  });

  it("resposta com erro: carga 'erro' e nenhum pedido", async () => {
    banco.padraoDaLista = { data: null, error: { code: "42501" } };
    await renderizar("conta-a");
    expect(atual.carga).toBe("erro");
    expect(atual.pedidos).toEqual([]);
  });

  it("sem conta logada: não lê nada e fica em 'carregando'", async () => {
    await renderizar(null);
    expect(banco.leituras).toBe(0);
    expect(atual.carga).toBe("carregando");
  });

  it("troca de conta: a resposta BOA da conta antiga, chegando depois, não vence a da nova", async () => {
    const velha = adiada();
    banco.proximasLeituras.push(() => velha.promessa);
    banco.padraoDaLista = {
      data: [linha("ped-da-b", { user_id: "conta-b" })],
      error: null,
    };
    await renderizar("conta-a");
    await renderizar("conta-b");
    expect(ids()).toEqual(["ped-da-b"]);
    expect(atual.carga).toBe("pronta");

    await act(async () => {
      velha.resolver({ data: [linha("ped-da-a")], error: null });
      await velha.promessa;
    });
    expect(ids()).toEqual(["ped-da-b"]);
    expect(atual.carga).toBe("pronta");
  });

  it("troca de conta: o ERRO da conta antiga, chegando depois, não derruba a lista nova", async () => {
    const velha = adiada();
    banco.proximasLeituras.push(() => velha.promessa);
    banco.padraoDaLista = {
      data: [linha("ped-da-b", { user_id: "conta-b" })],
      error: null,
    };
    await renderizar("conta-a");
    await renderizar("conta-b");
    expect(atual.carga).toBe("pronta");

    await act(async () => {
      velha.resolver({ data: null, error: { code: "XX000" } });
      await velha.promessa;
    });
    expect(atual.carga).toBe("pronta");
    expect(ids()).toEqual(["ped-da-b"]);
  });

  it("troca de conta: a EXCEÇÃO da conta antiga (rede caiu), chegando depois, não derruba a lista nova", async () => {
    let estourar!: (motivo: Error) => void;
    const velha = new Promise<Resposta>((_, rejeitar) => {
      estourar = rejeitar;
    });
    banco.proximasLeituras.push(() => velha);
    banco.padraoDaLista = {
      data: [linha("ped-da-b", { user_id: "conta-b" })],
      error: null,
    };
    await renderizar("conta-a");
    await renderizar("conta-b");
    expect(atual.carga).toBe("pronta");

    await act(async () => {
      estourar(new Error("caiu tarde demais"));
      await velha.catch(() => undefined);
    });
    expect(atual.carga).toBe("pronta");
    expect(ids()).toEqual(["ped-da-b"]);
  });

  it("consulta sem resposta: segue 'carregando' até 15 s e então vira 'erro'", async () => {
    banco.proximasLeituras.push(() => new Promise<Resposta>(() => {}));
    await renderizar("conta-a");
    await avancar(14_999);
    expect(atual.carga).toBe("carregando");
    await avancar(1);
    expect(atual.carga).toBe("erro");
  });
});

describe("usePedidosDePrivacidade — envio sem resposta", () => {
  it("em 15 s devolve falha de rede, solta a trava e relê a lista", async () => {
    await renderizar("conta-a");
    expect(banco.leituras).toBe(1);
    banco.proximasInsercoes.push(() => new Promise<Resposta>(() => {}));

    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      void atual.pedir("excluir_conta").then((r) => {
        resultado = r;
      });
    });
    expect(atual.enviando).toBe("excluir_conta");

    await avancar(14_999);
    expect(resultado).toBeUndefined();
    expect(atual.enviando).toBe("excluir_conta");
    expect(banco.leituras).toBe(1);

    await avancar(1);
    expect(resultado).toEqual({ ok: false, falha: "sem_rede" });
    expect(atual.enviando).toBeNull();
    expect(banco.leituras).toBe(2);
  });
});
