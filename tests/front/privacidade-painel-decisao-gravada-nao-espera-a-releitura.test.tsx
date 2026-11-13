// @vitest-environment jsdom
//
// Decisão de pedido de privacidade já GRAVADA não pode ficar presa em
// "Salvando…". Depois do UPDATE confirmado, o hook relê a lista; as consultas
// dessa releitura não têm prazo, então com a rede travada logo depois do UPDATE
// a decisão nunca chegava ao `finally` que libera os botões — embora o banco já
// tivesse a resposta. A releitura corre em segundo plano (como já fazia no
// caminho do prazo estourado): a confirmação não espera por ela.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePedidosDePrivacidadeAdmin } from "@/hooks/usePedidosDePrivacidadeAdmin";

type Resposta = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  atualizacao: { data: [{ id: "ped-1" }], error: null } as Resposta,
  // Depois de ligado, toda leitura (select) fica pendurada para sempre.
  leituraTravada: false,
}));

vi.mock("@/lib/supabase", () => {
  function consulta() {
    const cadeia = {
      eq: () => cadeia,
      neq: () => cadeia,
      order: () => cadeia,
      limit: () => cadeia,
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos.
      then: (resolve: (v: Resposta) => unknown) =>
        banco.leituraTravada
          ? new Promise<never>(() => {})
          : Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return cadeia;
  }
  return {
    supabase: {
      from: () => ({
        select: () => consulta(),
        update: () => {
          const cadeia = {
            eq: () => cadeia,
            select: async () => banco.atualizacao,
          };
          return cadeia;
        },
      }),
    },
  };
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let painel: ReturnType<typeof usePedidosDePrivacidadeAdmin>;
const sino = vi.fn();

function Sonda() {
  const lido = usePedidosDePrivacidadeAdmin();
  useEffect(() => {
    painel = lido;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  banco.atualizacao = { data: [{ id: "ped-1" }], error: null };
  banco.leituraTravada = false;
  window.addEventListener("admin:recontar-avisos", sino);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  window.removeEventListener("admin:recontar-avisos", sino);
  act(() => raiz.unmount());
  hospedeiro.remove();
});

/** Roda `decidir` e devolve o resultado, ou "preso" se não resolver. */
async function decidirComPressa(
  situacao: "atendido" | "recusado" = "atendido",
): Promise<unknown> {
  let resultado: unknown = "preso";
  await act(async () => {
    void painel.decidir("ped-1", situacao, "").then((r) => {
      resultado = r;
    });
    // Dá a volta no laço de microtarefas: se a decisão dependesse da releitura
    // pendurada, ela continuaria presa aqui.
    await new Promise((r) => setTimeout(r, 50));
  });
  return resultado;
}

describe("decisão gravada com a releitura da lista pendurada", () => {
  it("UPDATE ok e releitura que nunca volta: resolve { ok: true } e solta os botões", async () => {
    banco.leituraTravada = true;
    expect(await decidirComPressa()).toEqual({ ok: true });
    expect(painel.decidindo).toBeNull();
    expect(sino).toHaveBeenCalledTimes(1);
  });

  it("nenhuma linha mudou (outra pessoa já decidiu) e releitura pendurada: resolve ja_decidido", async () => {
    banco.atualizacao = { data: [], error: null };
    banco.leituraTravada = true;
    expect(await decidirComPressa("recusado")).toEqual({
      ok: false,
      falha: "ja_decidido",
    });
    expect(painel.decidindo).toBeNull();
    expect(sino).toHaveBeenCalledTimes(1);
  });

  it("o banco recusar por já estar decidido (55000) e releitura pendurada: resolve ja_decidido", async () => {
    banco.atualizacao = { data: null, error: { code: "55000", message: "x" } };
    banco.leituraTravada = true;
    expect(await decidirComPressa()).toEqual({
      ok: false,
      falha: "ja_decidido",
    });
    expect(painel.decidindo).toBeNull();
    expect(sino).toHaveBeenCalledTimes(1);
  });
});
