// @vitest-environment jsdom
//
// A conexão cai NO MEIO do envio do pedido de devolução ("Failed to fetch" no
// Chrome, "Load failed" no Safari, ou o `error` de rede que o Supabase devolve
// no lugar de lançar). O servidor pode ter gravado: a resposta é que não chegou.
// Antes a tela dizia "Sem conexão… tente de novo", e ao tentar de novo a
// cliente via "Já existe uma devolução em andamento". Agora a falha de rede é
// tratada como o tempo esgotado (envio incerto): relê o pedido; se a devolução
// nova apareceu, é sucesso com o protocolo; se não, a frase de incerteza.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DadosDaSolicitacao,
  type DevolucaoDoCliente,
  useDevolucaoCliente,
} from "@/hooks/useDevolucaoCliente";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: {
      from: () => ({
        upload: vi.fn(),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  },
}));

const DADOS: DadosDaSolicitacao = {
  itens: [{ order_item_id: "oi-1", quantidade: 1 }],
  motivo: "desisti",
  detalhe: "",
  resolucao: "reembolso",
  metodo: "envio_proprio",
  fotos: [],
};
const ELEGIBILIDADE = {
  pode: true,
  modalidade: "nacional",
  janelas: {},
  itens: [],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
  },
};
const NOVA = {
  id: "d-nova",
  protocolo: "DV261127-NOVA1",
  order_id: "o-1",
  tipo: "arrependimento",
  motivo: "desisti",
  resolucao_desejada: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "solicitada",
  valor_itens: 100,
  created_at: "2026-11-27T12:00:00Z",
  itens: [],
};
const ANTIGA = {
  ...NOVA,
  id: "d-antiga",
  protocolo: "DV261001-VELHA",
  status: "cancelada",
};

const SEM_CONEXAO = "Sem conexão com a internet";
const INCERTO = "Sem resposta da rede.";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: DevolucaoDoCliente;
// O que o "banco" tem: a lista que `devolucoes_do_pedido` devolve.
let banco: unknown[];
// Como a gravação responde: grava no banco e PERDE a resposta, ou nem grava.
let gravacao: "grava-e-cai" | "cai-sem-gravar" | "grava-e-lanca" | "recusa";
let releituraFalha: boolean;

function Sonda() {
  const lida = useDevolucaoCliente("o-1", true);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

const erroDeRede = { message: "TypeError: Failed to fetch", code: "" };
const chamadas = (nome: string) =>
  rpc.mock.calls.filter(([n]) => n === nome).length;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  banco = [];
  gravacao = "grava-e-cai";
  releituraFalha = false;
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "solicitar_devolucao") {
      if (gravacao === "recusa") {
        return {
          data: null,
          error: {
            message: "Já existe uma devolução em andamento para este pedido.",
            code: "23505",
          },
        };
      }
      if (gravacao !== "cai-sem-gravar") banco = [NOVA, ...banco];
      if (gravacao === "grava-e-lanca") throw new TypeError("Load failed");
      return { data: null, error: erroDeRede };
    }
    if (nome === "devolucoes_do_pedido" && releituraFalha) {
      return { data: null, error: erroDeRede };
    }
    return {
      data:
        nome === "devolucao_elegibilidade"
          ? ELEGIBILIDADE
          : nome === "devolucoes_do_pedido"
            ? banco
            : NOVA,
      error: null,
    };
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar() {
  await act(async () => raiz.render(<Sonda />));
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function enviar() {
  let desfecho: Awaited<ReturnType<DevolucaoDoCliente["solicitar"]>> | null =
    null;
  await act(async () => {
    desfecho = await leitura.solicitar(DADOS);
  });
  return desfecho!;
}

describe("devolução: a rede cai no meio do envio", () => {
  it("gravou e a resposta se perdeu ('Failed to fetch'): mostra o sucesso com o protocolo", async () => {
    await montar();

    const desfecho = await enviar();

    expect(desfecho).toEqual({
      ok: true,
      valor: {
        id: "d-nova",
        protocolo: "DV261127-NOVA1",
        tipo: "arrependimento",
        status: "solicitada",
      },
    });
    expect(chamadas("solicitar_devolucao")).toBe(1);
  });

  it("gravou e o fetch LANÇOU ('Load failed', Safari): também é sucesso com o protocolo", async () => {
    gravacao = "grava-e-lanca";
    await montar();

    const desfecho = await enviar();

    expect(desfecho).toMatchObject({
      ok: true,
      valor: { protocolo: "DV261127-NOVA1" },
    });
  });

  it("não gravou: a frase é a de incerteza (como o tempo esgotado), nunca 'sem conexão, tente de novo'", async () => {
    gravacao = "cai-sem-gravar";
    await montar();

    const desfecho = await enviar();

    expect(desfecho.ok).toBe(false);
    if (desfecho.ok) return;
    expect(desfecho.erro).toContain(INCERTO);
    expect(desfecho.erro).not.toContain(SEM_CONEXAO);
  });

  it("a releitura também falhou: incerto, e tentar de novo confere o pedido ANTES de reenviar", async () => {
    releituraFalha = true;
    await montar();
    releituraFalha = true;

    const primeira = await enviar();
    expect(primeira.ok).toBe(false);
    if (!primeira.ok) expect(primeira.erro).toContain(INCERTO);

    // A rede voltou e a devolução está lá: tentar de novo NÃO reenvia, e a
    // cliente não vê "Já existe uma devolução em andamento".
    releituraFalha = false;
    gravacao = "recusa";
    const inicio = rpc.mock.calls.length;
    const segunda = await enviar();

    expect(rpc.mock.calls.at(inicio)?.[0]).toBe("devolucoes_do_pedido");
    expect(chamadas("solicitar_devolucao")).toBe(1);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) {
      expect(segunda.erro).not.toContain("Já existe uma devolução");
    }
  });

  it("uma devolução ANTIGA (já encerrada) não é confundida com a nova", async () => {
    banco = [ANTIGA];
    gravacao = "cai-sem-gravar";
    await montar();

    const desfecho = await enviar();

    expect(desfecho.ok).toBe(false);
    if (!desfecho.ok) expect(desfecho.erro).toContain(INCERTO);
  });

  // O caso acima reprova pelas DUAS guardas ao mesmo tempo (já existia E está
  // encerrada). Os dois abaixo isolam cada uma: tirar só uma delas de
  // `conferirEnvioIncerto` deixa o caso correspondente vermelho.
  it("uma devolução que JÁ existia e segue em andamento não é confundida com a nova", async () => {
    banco = [{ ...NOVA, id: "d-aberta", protocolo: "DV261120-ABERTA" }];
    gravacao = "cai-sem-gravar";
    await montar();

    const desfecho = await enviar();

    expect(desfecho.ok).toBe(false);
    if (!desfecho.ok) expect(desfecho.erro).toContain(INCERTO);
  });

  it("uma devolução que não existia antes mas já está encerrada não é a nova", async () => {
    gravacao = "cai-sem-gravar";
    await montar();
    // Apareceu depois que a tela abriu, mas já encerrada: não é este pedido
    // (o que acabou de ser enviado nasce "solicitada").
    banco = [
      {
        ...NOVA,
        id: "d-fechada",
        protocolo: "DV261126-FECHADA",
        status: "cancelada",
      },
    ];

    const desfecho = await enviar();

    expect(desfecho.ok).toBe(false);
    if (!desfecho.ok) expect(desfecho.erro).toContain(INCERTO);
  });

  it("recusa de verdade do servidor continua aparecendo como veio", async () => {
    gravacao = "recusa";
    await montar();

    const desfecho = await enviar();

    expect(desfecho).toEqual({
      ok: false,
      erro: "Já existe uma devolução em andamento para este pedido.",
    });
  });
});
