// @vitest-environment jsdom
//
// Pedidos de privacidade no painel, rede "pendurada" (conecta e não responde):
// a primeira leitura esperava as duas consultas de pedidos, e depois as de
// nomes, SEM prazo. Se uma pendurasse, a lojista ficava em "Carregando…" para
// sempre e não via os pedidos nem os prazos da LGPD. Agora o estouro das
// consultas de pedidos vira o estado de erro (que a tela já trata com "Tentar
// de novo") e o estouro dos nomes só deixa a lista sem nomes ("Cliente").
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePedidosDePrivacidadeAdmin } from "@/hooks/usePedidosDePrivacidadeAdmin";
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

type Resposta = { data: unknown; error: unknown };

const pedido = (id: string, userId: string, situacao = "aberto") => ({
  id,
  user_id: userId,
  tipo: "excluir_conta",
  email_novo: null,
  situacao,
  criado_em: "2026-11-01T10:00:00Z",
  atendido_em: null,
  atendido_por: null,
  observacao: null,
});

const banco = vi.hoisted(() => ({
  abertos: [] as unknown[],
  respondidos: [] as unknown[],
  // Cada leitura pode ficar pendurada para sempre.
  abertosTravada: false,
  respondidosTravada: false,
  nomesTravada: false,
  consultasDeNomes: [] as unknown[][],
  consultasDePedidos: 0,
}));

vi.mock("@/lib/supabase", () => {
  const nunca = () => new Promise<never>(() => {});
  function consultaDePedidos(situacao: "abertos" | "respondidos") {
    const cadeia = {
      eq: () => cadeia,
      neq: () => cadeia,
      order: () => cadeia,
      limit: () => cadeia,
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos.
      then: (resolve: (v: Resposta) => unknown) =>
        (
          situacao === "abertos"
            ? banco.abertosTravada
            : banco.respondidosTravada
        )
          ? nunca()
          : Promise.resolve({
              data: situacao === "abertos" ? banco.abertos : banco.respondidos,
              error: null,
            }).then(resolve),
    };
    return cadeia;
  }
  function consultaDeNomes() {
    const cadeia = {
      in: (_coluna: string, ids: unknown[]) => {
        banco.consultasDeNomes.push(ids);
        return cadeia;
      },
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos.
      then: (resolve: (v: Resposta) => unknown) =>
        banco.nomesTravada
          ? nunca()
          : Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return cadeia;
  }
  return {
    supabase: {
      from: (tabela: string) => ({
        select: () => {
          if (tabela === "profiles") return consultaDeNomes();
          // O hook faz `.eq("situacao", "aberto")` nos abertos e `.neq(...)` nos
          // respondidos: a primeira consulta feita é a dos abertos.
          banco.consultasDePedidos += 1;
          return consultaDePedidos(
            banco.consultasDePedidos % 2 === 1 ? "abertos" : "respondidos",
          );
        },
      }),
    },
  };
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let painel: ReturnType<typeof usePedidosDePrivacidadeAdmin>;

function Sonda() {
  const lido = usePedidosDePrivacidadeAdmin();
  useEffect(() => {
    painel = lido;
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  banco.abertos = [pedido("ped-1", "cli-1")];
  banco.respondidos = [];
  banco.abertosTravada = false;
  banco.respondidosTravada = false;
  banco.nomesTravada = false;
  banco.consultasDeNomes = [];
  banco.consultasDePedidos = 0;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function montar() {
  await act(async () => raiz.render(<Sonda />));
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function tentarDeNovo() {
  await act(async () => {
    await painel.recarregar();
  });
}

describe("pedidos de privacidade com a rede conectada e sem resposta", () => {
  it.each([
    [
      "dos pedidos abertos",
      (travar: boolean) => {
        banco.abertosTravada = travar;
      },
    ],
    [
      "dos pedidos respondidos",
      (travar: boolean) => {
        banco.respondidosTravada = travar;
      },
    ],
  ])(
    "a consulta %s que nunca responde vira erro e 'tentar de novo' carrega",
    async (_nome, travar) => {
      travar(true);
      await montar();
      expect(painel.carga).toBe("carregando");

      await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

      expect(painel.carga).toBe("erro");
      expect(painel.pedidos).toEqual([]);

      // A rede voltou: "Tentar de novo" (o `recarregar` da tela) traz a lista.
      travar(false);
      banco.consultasDePedidos = 0;
      await tentarDeNovo();

      expect(painel.carga).toBe("pronta");
      expect(painel.pedidos.map((p) => p.id)).toEqual(["ped-1"]);
    },
  );

  it("a consulta de nomes que nunca responde deixa a lista sem nomes, sem prender", async () => {
    banco.nomesTravada = true;
    await montar();
    expect(painel.carga).toBe("carregando");

    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(painel.carga).toBe("pronta");
    expect(painel.pedidos.map((p) => p.id)).toEqual(["ped-1"]);
    expect(painel.nomes.size).toBe(0);
  });

  it("nomes pendurados: não espera um prazo para cada pedaço de ids", async () => {
    banco.abertos = Array.from({ length: 101 }, (_, i) =>
      pedido(`ped-${i}`, `cli-${i}`),
    );
    banco.nomesTravada = true;
    await montar();

    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(painel.carga).toBe("pronta");
    expect(painel.pedidos).toHaveLength(101);
    // Estourou no primeiro pedaço: o segundo (1 id) nem é tentado.
    expect(banco.consultasDeNomes).toHaveLength(1);
  });

  it("releitura com a lista já na tela e a rede pendurada mantém a lista", async () => {
    await montar();
    await avancar(0);
    expect(painel.carga).toBe("pronta");

    banco.abertosTravada = true;
    await act(async () => {
      void painel.recarregar();
    });
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(painel.carga).toBe("pronta");
    expect(painel.pedidos.map((p) => p.id)).toEqual(["ped-1"]);
  });
});
