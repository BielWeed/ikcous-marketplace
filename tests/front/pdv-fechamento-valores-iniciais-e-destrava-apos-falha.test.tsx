// @vitest-environment jsdom
//
// `FechamentoDaVenda` — dois ramos que nenhum outro teste derruba:
//
//  1. VALORES INICIAIS do desconto e do motivo ao ABRIR o fechamento (volta à
//     tela com o cupom já descontado, ou F5 com o rascunho restaurado): os
//     campos nascem do `estado`, e mexer só no motivo não pode perder o
//     desconto (o texto do desconto que a tela guarda nasce junto).
//  2. DESTRAVA depois de uma falha que não convida a repetir (23505: chave já
//     queimada): o botão fica desabilitado, e mudar QUALQUER um dos três
//     fatos do cupom (forma de pagamento, desconto, motivo) o libera — é o
//     `useEffect` que apaga `ultimaFalha`. Cada fato tem o seu caso, porque a
//     lista de dependências é exatamente o que se quer travar: tirar um deles
//     deixa a lojista presa na tela até sair e voltar.
//
// O hospedeiro monta o reducer REAL (`reducerDaVenda`) JÁ com o estado
// semeado, para o `FechamentoDaVenda` nascer com desconto/motivo (o hospedeiro
// que semeia por efeito, dos testes mais antigos, monta a seção vazia e só
// depois preenche — e os valores iniciais ficariam sem teste).
//
// Dinheiro: `0.1 + 0.2` (= 0.30000000000000004) e `39.9 × 2` com desconto, para
// o float errar se a conta ou o texto não passarem por centavos.
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { act, useReducer } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import {
  type EstadoDaVenda,
  type FormaDePagamentoDoBalcao,
  type ItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";

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

function estadoSemeado(parcial: {
  pagamento?: FormaDePagamentoDoBalcao;
  desconto?: number;
  motivoDoDesconto?: string;
}): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-fixa"),
    itens: [ITEM],
    pagamento: parcial.pagamento ?? "cash",
    desconto: parcial.desconto ?? 0,
    motivoDoDesconto: parcial.motivoDoDesconto ?? "",
  };
}

function Hospedeiro({
  inicial,
  aoRegistrarVenda,
}: {
  inicial: EstadoDaVenda;
  aoRegistrarVenda: () => Promise<void>;
}) {
  const [estado, despachar] = useReducer(reducerDaVenda, inicial);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={vi.fn()}
    />
  );
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function campo(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

describe("FechamentoDaVenda — valores iniciais e destrava depois da falha", () => {
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
    inicial: EstadoDaVenda,
    aoRegistrarVenda: () => Promise<void> = vi
      .fn()
      .mockResolvedValue(undefined),
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro inicial={inicial} aoRegistrarVenda={aoRegistrarVenda} />,
      );
    });
    await avancar();
  }

  describe("valores iniciais ao abrir o fechamento", () => {
    it("com desconto e motivo no estado, os dois campos já nascem preenchidos (desconto em centavos, sem erro de float)", async () => {
      await montar(
        estadoSemeado({
          desconto: 0.1 + 0.2,
          motivoDoDesconto: "Cliente fidelidade",
        }),
      );

      expect(campo("desconto-da-venda").value).toBe("0,30");
      expect(campo("motivo-do-desconto").value).toBe("Cliente fidelidade");
      expect(hospedeiro.textContent).toContain("Privado · 18/2.000");
      // Subtotal ≠ total: 2 × 39,90 = 79,80; com 0,30 de desconto, 79,50.
      expect(hospedeiro.textContent).toContain("Total com desconto");
      expect(hospedeiro.textContent).toContain("R$ 79,50");
    });

    it("sem desconto no estado, o campo nasce VAZIO (placeholder), não '0,00', e não há campo de motivo", async () => {
      await montar(estadoSemeado({}));

      expect(campo("desconto-da-venda").value).toBe("");
      expect(campo("desconto-da-venda").placeholder).toBe("0,00");
      expect(document.getElementById("motivo-do-desconto")).toBeNull();
    });

    it("mexer SÓ no motivo mantém o desconto que já estava (o texto inicial do desconto vale)", async () => {
      await montar(
        estadoSemeado({
          desconto: 0.1 + 0.2,
          motivoDoDesconto: "Cliente fidelidade",
        }),
      );

      await act(async () => {
        digitarInput("motivo-do-desconto", "Mostruário");
      });
      await avancar(300);

      expect(campo("motivo-do-desconto").value).toBe("Mostruário");
      expect(hospedeiro.textContent).toContain("- R$ 0,30");
      expect(hospedeiro.textContent).toContain("R$ 79,50");
    });
  });

  describe("destrava depois de uma falha que não convida a repetir", () => {
    const CHAVE_QUEIMADA = { code: "23505", message: "duplicate key" };

    async function falharAoRegistrar(inicial: EstadoDaVenda): Promise<void> {
      const registrar = vi.fn().mockRejectedValue(CHAVE_QUEIMADA);
      await montar(inicial, registrar);
      expect(botao(hospedeiro, "Registrar venda")?.disabled).toBe(false);
      await act(async () => {
        botao(hospedeiro, "Registrar venda")?.click();
      });
      await avancar();
      expect(registrar).toHaveBeenCalledTimes(1);
      // Preso: a falha não convida a repetir, e a saída é a venda nova.
      expect(hospedeiro.textContent).toContain(
        "Esta venda não foi registrada. Toque em Começar uma venda nova e registre de novo.",
      );
      expect(botao(hospedeiro, "Registrar venda")?.disabled).toBe(true);
      expect(botao(hospedeiro, "Começar uma venda nova")).toBeDefined();
    }

    function expectDestravado(): void {
      expect(botao(hospedeiro, "Registrar venda")?.disabled).toBe(false);
      expect(botao(hospedeiro, "Começar uma venda nova")).toBeUndefined();
    }

    it("trocar a FORMA DE PAGAMENTO libera o botão", async () => {
      await falharAoRegistrar(estadoSemeado({ pagamento: "cash" }));

      await act(async () => {
        botao(hospedeiro, "Cartão na maquininha")?.click();
      });
      await avancar();
      // Cartão pede a conferência no app: marca, e só então o botão pode abrir.
      await act(async () => {
        campo("conferi-o-pagamento").click();
      });
      await avancar();

      expectDestravado();
    });

    it("mudar o VALOR do desconto libera o botão", async () => {
      // O motivo já está escrito: mexer no valor não toca no motivo.
      await falharAoRegistrar(
        estadoSemeado({ desconto: 0, motivoDoDesconto: "Fidelidade" }),
      );

      await act(async () => {
        digitarInput("desconto-da-venda", "500"); // vira R$ 5,00
      });
      await avancar(300);

      expect(hospedeiro.textContent).toContain("- R$ 5,00");
      expectDestravado();
    });

    it("mudar o MOTIVO do desconto libera o botão", async () => {
      // O desconto já existe: mexer no motivo não toca no valor.
      await falharAoRegistrar(
        estadoSemeado({ desconto: 5, motivoDoDesconto: "Fidelidade" }),
      );

      await act(async () => {
        digitarInput("motivo-do-desconto", "Mostruário");
      });
      await avancar(300);

      expect(campo("motivo-do-desconto").value).toBe("Mostruário");
      expectDestravado();
    });
  });
});
