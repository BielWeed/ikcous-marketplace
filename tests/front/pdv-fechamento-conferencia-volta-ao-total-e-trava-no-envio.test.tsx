// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), duas lacunas na tela de cobrança do balcão:
//
// 1. "Conferi o pagamento no app do banco" vale para UM valor. Se a lojista
//    marca em R$ 79,80, mexe no desconto (R$ 74,80) e DESFAZ o desconto, o
//    total volta a ser R$ 79,80 e a marca antiga NÃO pode reaparecer sozinha:
//    ela não conferiu de novo. Os testes existentes só olhavam o desconto
//    aplicado, nunca a volta.
// 2. Com a venda sendo registrada (resposta pendente), nenhum campo da cobrança
//    pode ser mexido: forma de pagamento, desconto, motivo, valor recebido.
//    O reducer ignora a edição, mas a tela mostraria um valor que o servidor
//    não recebeu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type {
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

// 2 × R$ 39,90 = R$ 79,80.
const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function Hospedeiro({
  pagamentoInicial,
  aoRegistrarVenda,
}: {
  pagamentoInicial: FormaDePagamentoDoBalcao;
  aoRegistrarVenda: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    despachar({
      tipo: "item_adicionado_manualmente",
      item: ITEM,
      em: Date.now(),
    });
    despachar({ tipo: "pagamento_escolhido", pagamento: pagamentoInicial });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={limparCupom}
    />
  );
}

describe("FechamentoDaVenda — conferência e trava durante o envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar(
    pagamentoInicial: FormaDePagamentoDoBalcao,
    aoRegistrarVenda: () => Promise<void> = vi
      .fn()
      .mockResolvedValue(undefined),
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro
          pagamentoInicial={pagamentoInicial}
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();
  }

  function caixinha(): HTMLInputElement {
    return document.getElementById("conferi-o-pagamento") as HTMLInputElement;
  }

  function botaoRegistrar(): HTMLButtonElement {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Registrar venda|Registrando/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
  }

  async function digitar(id: string, texto: string): Promise<void> {
    await act(async () => {
      digitarInput(id, texto);
    });
    await avancar(300);
  }

  it("marcou em R$ 79,80, deu desconto e DESFEZ o desconto: o total volta, a marca NÃO volta", async () => {
    await montar("pix");
    await act(async () => {
      caixinha().click();
    });
    await avancar();
    expect(caixinha().checked).toBe(true);
    expect(botaoRegistrar().disabled).toBe(false);

    await digitar("desconto-da-venda", "500"); // R$ 5,00 -> total R$ 74,80
    await digitar("motivo-do-desconto", "cliente fidelidade");
    expect(caixinha().checked).toBe(false);
    expect(botaoRegistrar().disabled).toBe(true);

    await digitar("desconto-da-venda", ""); // sem desconto: total R$ 79,80
    expect(hospedeiro.textContent).toContain("R$ 79,80");
    expect(hospedeiro.textContent).not.toContain("74,80");
    expect(caixinha().checked).toBe(false);
    expect(botaoRegistrar().disabled).toBe(true);

    // Conferir de novo destrava normalmente.
    await act(async () => {
      caixinha().click();
    });
    await avancar();
    expect(botaoRegistrar().disabled).toBe(false);
  });

  it("com a venda sendo registrada, forma de pagamento, desconto, motivo, valor recebido e notas ficam travados", async () => {
    const registrar = vi.fn(() => new Promise<void>(() => {}));
    await montar("cash", registrar);
    await digitar("desconto-da-venda", "500");
    await digitar("motivo-do-desconto", "cliente fidelidade");

    // Antes do envio tudo está livre.
    const formas = [
      ...hospedeiro.querySelectorAll(".pdv-payment"),
    ] as HTMLButtonElement[];
    expect(formas).toHaveLength(3);
    expect(formas.every((b) => !b.disabled)).toBe(true);
    expect(
      (document.getElementById("desconto-da-venda") as HTMLInputElement)
        .disabled,
    ).toBe(false);

    await act(async () => {
      botaoRegistrar().click();
    });
    await avancar();

    expect(registrar).toHaveBeenCalledTimes(1);
    expect(botaoRegistrar().textContent).toContain("Registrando");
    expect(botaoRegistrar().disabled).toBe(true);
    expect(formas.every((b) => b.disabled)).toBe(true);
    for (const id of [
      "desconto-da-venda",
      "motivo-do-desconto",
      "dinheiro-recebido",
    ]) {
      expect((document.getElementById(id) as HTMLInputElement).disabled).toBe(
        true,
      );
    }
    const notas = [
      ...hospedeiro.querySelectorAll(".pdv-change-notes button"),
    ] as HTMLButtonElement[];
    expect(notas.length).toBeGreaterThan(0);
    expect(notas.every((b) => b.disabled)).toBe(true);
  });
});
