// @vitest-environment jsdom
//
// Financeiro — "Novo lançamento": a chave de idempotência da tentativa (20261246).

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherNaLista } from "./helpers/lista-de-escolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

const HOJE = "2026-10-16";
const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id) => ({
    id,
    nome: id,
    tipo: "banco" as const,
    saldoInicial: 0,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 0,
  }),
);
const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
  {
    id: "cat-outra",
    nome: "Internet",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
  {
    id: "cat-receita",
    nome: "Sucata",
    natureza: "receita",
    grupoDre: "receita",
    ativa: true,
    sistema: false,
  },
];
const DONA = "8a1f0c2e-2222-4222-8222-000000000002";
const FUNCIONARIA = "8a1f0c2e-1111-4111-8111-000000000001";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("lançamento: a tentativa sobrevive ao prazo, só muda com o conteúdo", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let salvo: Mock<(mensagem: string) => void>;
  let fechado: Mock<() => void>;

  async function abrir(autorId: string | null = DONA) {
    await act(async () => {
      raiz.render(
        <NovoLancamentoFolha
          autorId={autorId}
          hoje={HOJE}
          contas={CONTAS}
          categorias={CATEGORIAS}
          inicial={{
            valor: "120.00",
            descricao: "Aluguel",
            categoriaId: "cat",
          }}
          aoFechar={fechado}
          aoMudarSujo={vi.fn()}
          aoSalvar={salvo}
        />,
      );
    });
  }
  async function enviar() {
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[form="fin-novo-lancamento"]')
        ?.click();
    });
  }
  async function vencerPrazo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
  }
  const payload = (i: number) => {
    const chamada = rpcFalso.mock.calls.at(i);
    if (!chamada) throw new Error(`Envio ${i} não ocorreu.`);
    return chamada[1].p;
  };
  async function mudar(id: string, valor: string) {
    const el = document.getElementById(id);
    // Lista de escolha (o lugar do `<select>`): toca no campo e na opção.
    if (el?.getAttribute("aria-haspopup") === "listbox") {
      await act(async () => {
        escolherNaLista(id, valor);
      });
      return;
    }
    const campo = el as HTMLInputElement | HTMLTextAreaElement;
    const proto =
      campo instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }
  beforeEach(async () => {
    sessionStorage.removeItem("fin-lancamento-tentativas-em-aberto");
    vi.useFakeTimers();
    rpcFalso.mockReset().mockImplementation(() => new Promise(() => {}));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    fechado = vi.fn<() => void>();
    salvo = vi.fn<(mensagem: string) => void>(() => {
      raiz.render(null);
    });
    await abrir();
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("RPC pendente: prazo solta Salvar e o segundo envio usa a mesma chave; sucesso fecha", async () => {
    await enviar();
    expect(payload(0).chave_idempotencia).toMatch(UUID);
    await enviar(); // bloqueado enquanto enviando
    expect(rpcFalso).toHaveBeenCalledTimes(1);
    await vencerPrazo();
    expect(document.body.textContent).toContain("pode ter sido salvo");
    expect(document.body.textContent).toContain("não duplica");
    expect(salvo).not.toHaveBeenCalled();
    // Um blur sem alteração também NÃO troca a chave.
    await mudar("fin-lanc-descricao", "Aluguel");
    rpcFalso.mockResolvedValueOnce({
      data: { ids: ["original"] },
      error: null,
    });
    await enviar();
    expect(rpcFalso).toHaveBeenCalledTimes(2);
    expect(payload(1)).toEqual(payload(0));
    expect(salvo).toHaveBeenCalledWith("Lançamento salvo.");
    expect(document.getElementById("fin-novo-lancamento")).toBeNull();
  });

  it.each([
    ["fin-lanc-valor", "13000"],
    ["fin-lanc-descricao", "Internet"],
    ["fin-lanc-conta", CONTA_CAIXA_DA_LOJA],
    ["fin-lanc-competencia", "2026-10-01"],
    ["fin-lanc-categoria", "cat-outra"],
    ["fin-lanc-realizacao", "2026-10-15"],
    ["fin-lanc-forma", "pix"],
    ["fin-lanc-observacao", "Conferido"],
  ])("mudar %s regenera a chave, reenviar mantém a nova", async (id, valor) => {
    await enviar();
    await vencerPrazo();
    await mudar(id, valor);
    await enviar();
    expect(payload(1).chave_idempotencia).toMatch(UUID);
    expect(payload(1).chave_idempotencia).not.toBe(
      payload(0).chave_idempotencia,
    );
    await vencerPrazo();
    await enviar();
    expect(payload(2)).toEqual(payload(1));
  });

  it("tipo, situação, destino, vencimento e parcelas também mudam a tentativa", async () => {
    const clicarRotulo = async (rotulo: string) => {
      const b = [...document.querySelectorAll("button")].find(
        (el) => el.textContent?.trim() === rotulo,
      );
      expect(b).toBeDefined();
      await act(async () => {
        b?.click();
      });
    };
    await enviar();
    await vencerPrazo();
    await clicarRotulo("A pagar");
    await enviar();
    expect(payload(1).chave_idempotencia).not.toBe(
      payload(0).chave_idempotencia,
    );
    await vencerPrazo();
    await mudar("fin-lanc-vencimento", "2026-10-20");
    await enviar();
    expect(payload(2).chave_idempotencia).not.toBe(
      payload(1).chave_idempotencia,
    );
    await vencerPrazo();
    await mudar("fin-lanc-parcelas", "3");
    await enviar();
    expect(payload(3).chave_idempotencia).not.toBe(
      payload(2).chave_idempotencia,
    );
    await vencerPrazo();
    await clicarRotulo("Receita");
    await mudar("fin-lanc-categoria", "cat-receita");
    await enviar();
    expect(payload(4).chave_idempotencia).not.toBe(
      payload(3).chave_idempotencia,
    );
    await vencerPrazo();
    await clicarRotulo("Transferência");
    await mudar("fin-lanc-conta-destino", CONTA_CAIXA_DA_LOJA);
    await enviar();
    expect(payload(5).chave_idempotencia).not.toBe(
      payload(4).chave_idempotencia,
    );
    expect(payload(5).tipo).toBe("transferencia");
  });

  it("reabrir depois de um envio que não respondeu reaproveita a chave; depois de sucesso, não", async () => {
    await enviar();
    await vencerPrazo(); // prazo estourou, a gravação original pode estar viva
    const primeira = payload(0).chave_idempotencia;
    await act(async () => {
      raiz.render(null);
    });
    await abrir();
    rpcFalso.mockResolvedValueOnce({
      data: { ids: ["original"] },
      error: null,
    });
    await enviar();
    expect(payload(1).chave_idempotencia).toBe(primeira);
    expect(salvo).toHaveBeenCalled();
    // Já houve sucesso: um lançamento igual de propósito agora é outro.
    await abrir();
    await enviar();
    expect(payload(2).chave_idempotencia).not.toBe(primeira);
  });

  it("reabrir com o conteúdo mudado gera outra chave mesmo depois de um prazo estourado", async () => {
    await enviar();
    await vencerPrazo();
    const primeira = payload(0).chave_idempotencia;
    await act(async () => {
      raiz.render(null);
    });
    await abrir();
    await mudar("fin-lanc-valor", "13000");
    await enviar();
    expect(payload(1).chave_idempotencia).not.toBe(primeira);
  });

  it("funcionária fica sem resposta, sai, a dona entra e lança igual: grava com chave nova", async () => {
    await act(async () => {
      raiz.render(null);
    });
    await abrir(FUNCIONARIA);
    await enviar();
    await vencerPrazo(); // "pode ter sido salvo": a chave dela fica em aberto
    const daFuncionaria = payload(0).chave_idempotencia;
    await act(async () => {
      raiz.render(null); // saiu da conta
    });
    await abrir(DONA);
    rpcFalso.mockResolvedValueOnce({ data: { ids: ["da-dona"] }, error: null });
    await enviar();
    expect(payload(1)).toEqual({
      ...payload(0),
      chave_idempotencia: payload(1).chave_idempotencia,
    });
    expect(payload(1).chave_idempotencia).toMatch(UUID);
    expect(payload(1).chave_idempotencia).not.toBe(daFuncionaria);
    expect(salvo).toHaveBeenCalledWith("Lançamento salvo.");
    // A chave dela continua dela: se voltar e reenviar, não duplica o seu.
    await abrir(FUNCIONARIA);
    await enviar();
    expect(payload(2).chave_idempotencia).toBe(daFuncionaria);
  });

  it("a conta da aba muda com a folha aberta: o envio seguinte não leva a chave de quem saiu", async () => {
    await enviar();
    await vencerPrazo(); // "pode ter sido salvo": a chave da dona fica em aberto
    const daDona = payload(0).chave_idempotencia;
    // Outra aba entrou com a conta da funcionária; a folha é a MESMA (sem
    // remontar), com o conteúdo igual.
    await abrir(FUNCIONARIA);
    await enviar();
    expect(payload(1)).toEqual({
      ...payload(0),
      chave_idempotencia: payload(1).chave_idempotencia,
    });
    expect(payload(1).chave_idempotencia).toMatch(UUID);
    expect(payload(1).chave_idempotencia).not.toBe(daDona);
    // A dona volta na mesma folha: a chave dela continua dela.
    await vencerPrazo();
    await abrir(DONA);
    await enviar();
    expect(payload(2).chave_idempotencia).toBe(daDona);
    // Sem conta conhecida, nem a chave em memória da dona vai junto.
    await vencerPrazo();
    await abrir(null);
    await enviar();
    expect(payload(3).chave_idempotencia).not.toBe(daDona);
    expect(payload(3).chave_idempotencia).not.toBe(
      payload(1).chave_idempotencia,
    );
  });

  it("sem usuário conhecido, reabrir não reaproveita chave de ninguém", async () => {
    await enviar();
    await vencerPrazo();
    const primeira = payload(0).chave_idempotencia;
    await act(async () => {
      raiz.render(null);
    });
    await abrir(null);
    await enviar();
    expect(payload(1).chave_idempotencia).not.toBe(primeira);
  });

  it("sem randomUUID usa getRandomValues e envia UUID v4", async () => {
    await act(async () => {
      raiz.render(null);
    });
    vi.spyOn(globalThis.crypto, "randomUUID");
    // Simula ausência, não função que retorna undefined.
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    const aleatorio = vi.spyOn(globalThis.crypto, "getRandomValues");
    await abrir();
    await enviar();
    expect(aleatorio).toHaveBeenCalled();
    expect(payload(0).chave_idempotencia).toMatch(UUID);
  });
});
