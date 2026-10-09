// @vitest-environment jsdom
//
// Decisão do dono (08/10/2026, spec do balcão 28/09, defeito D1): no PIX
// combinado (chave da loja) e no cartão da maquininha, o botão "Registrar
// venda" só habilita DEPOIS da caixinha "Conferi o pagamento no app do
// banco". Antes, os dois gravavam a venda como paga no clique, sem ninguém
// olhar se o dinheiro tinha entrado. Dinheiro não tem a caixinha.
//
// Montado em isolamento, com a máquina REAL de `useVendaPresencial` (mesmo
// hospedeiro fininho de `admin-pdv-fechamento-e-recibo.test.tsx`). Sem
// `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { isOfflineRef } = vi.hoisted(() => ({
  isOfflineRef: { atual: false },
}));

// `useOnlineStatus` devolve `true` quando está OFFLINE (armadilha de nome).
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => isOfflineRef.atual,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type {
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

const ROTULO_DA_CAIXINHA = "Conferi o pagamento no app do banco";

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

function botaoPorTexto(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado as HTMLButtonElement;
}

function caixinha(raizDom: ParentNode): HTMLInputElement | null {
  const rotulo = [...raizDom.querySelectorAll("label")].find((l) =>
    l.textContent?.includes(ROTULO_DA_CAIXINHA),
  );
  return (rotulo?.control as HTMLInputElement | null) ?? null;
}

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

describe('FechamentoDaVenda — passo "Conferi o pagamento no app do banco" (D1)', () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    isOfflineRef.atual = false;
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

  async function marcarCaixinha(): Promise<void> {
    await act(async () => {
      (caixinha(hospedeiro) as HTMLInputElement).click();
    });
    await avancar();
  }

  async function escolherForma(rotulo: string): Promise<void> {
    await act(async () => {
      botaoPorTexto(hospedeiro, rotulo).click();
    });
    await avancar();
  }

  it.each(["pix", "card"] as const)(
    "%s — sem a caixinha o botão fica desabilitado e o clique NÃO registra; marcada, registra uma vez",
    async (forma) => {
      const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
      await montar(forma, aoRegistrarVenda);

      const caixa = caixinha(hospedeiro);
      expect(caixa).not.toBeNull();
      expect(caixa?.type).toBe("checkbox");
      expect(caixa?.checked).toBe(false);
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);

      await act(async () => {
        botaoPorTexto(hospedeiro, "Registrar venda").click();
      });
      await avancar();
      expect(aoRegistrarVenda).not.toHaveBeenCalled();

      await marcarCaixinha();
      expect(caixinha(hospedeiro)?.checked).toBe(true);
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);

      await act(async () => {
        botaoPorTexto(hospedeiro, "Registrar venda").click();
      });
      await avancar();
      expect(aoRegistrarVenda).toHaveBeenCalledTimes(1);
    },
  );

  it("dinheiro NÃO tem a caixinha e registra direto", async () => {
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await montar("cash", aoRegistrarVenda);

    expect(caixinha(hospedeiro)).toBeNull();
    expect(hospedeiro.textContent).not.toContain(ROTULO_DA_CAIXINHA);
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);

    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda").click();
    });
    await avancar();
    expect(aoRegistrarVenda).toHaveBeenCalledTimes(1);
  });

  it("trocar de forma desmarca: PIX marcado -> cartão volta desmarcado e travado", async () => {
    await montar("pix");
    await marcarCaixinha();
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);

    await escolherForma("Cartão na maquininha");
    expect(caixinha(hospedeiro)?.checked).toBe(false);
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("voltar à MESMA forma depois de passar pelo dinheiro não ressuscita a marca", async () => {
    await montar("pix");
    await marcarCaixinha();

    await escolherForma("Dinheiro");
    expect(caixinha(hospedeiro)).toBeNull();
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);

    await escolherForma("PIX na hora");
    expect(caixinha(hospedeiro)?.checked).toBe(false);
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("mudar o total (desconto) depois de conferir desmarca: a conferência foi de outro valor", async () => {
    await montar("pix");
    await marcarCaixinha();
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);

    await act(async () => {
      digitarInput("desconto-da-venda", "500"); // R$ 5,00
    });
    await avancar(300);
    await act(async () => {
      digitarInput("motivo-do-desconto", "cliente fidelidade");
    });
    await avancar(300);

    expect(caixinha(hospedeiro)?.checked).toBe(false);
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("desmarcar de novo trava de novo (a caixinha liga e desliga)", async () => {
    await montar("pix");
    await marcarCaixinha();
    await marcarCaixinha();
    expect(caixinha(hospedeiro)?.checked).toBe(false);
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("marcada, mas SEM internet: continua desabilitado (a caixinha não destrava o offline)", async () => {
    isOfflineRef.atual = true;
    await montar("pix");
    await marcarCaixinha();
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("acessível: rótulo de verdade ligado ao campo, explicação ligada por aria-describedby e dica de por que está travado", async () => {
    await montar("pix");

    const caixa = caixinha(hospedeiro) as HTMLInputElement;
    expect(caixa.id).not.toBe("");
    const descricao = caixa.getAttribute("aria-describedby");
    expect(descricao).toBeTruthy();
    const texto = document.getElementById(descricao as string);
    expect(texto?.textContent ?? "").toContain("app do banco");
    expect(caixa.disabled).toBe(false);

    // O botão travado diz POR QUÊ (antes só ficava cinza, sem frase).
    expect(hospedeiro.textContent).toContain(`Marque "${ROTULO_DA_CAIXINHA}"`);
    await marcarCaixinha();
    expect(hospedeiro.textContent).not.toContain(
      `Marque "${ROTULO_DA_CAIXINHA}"`,
    );
  });
});
