// @vitest-environment jsdom
//
// Recibo do balcão — "Anular venda" depois da meia-noite. O recibo fica na
// tela até a lojista tocar "Nova venda"; se ela tenta anular já no dia
// seguinte, o banco recusa com "... Para outro dia, registre uma devolução."
// O lojista NÃO tem como abrir devolução de venda do balcão no painel
// (`solicitar_devolucao` exige o cliente logado), e venda sem cliente nem tem
// quem peça. A ficha do pedido já trocava essa frase pela verdadeira; o
// recibo repassava a do banco. Agora os dois dizem a mesma coisa, porque a
// tradução mora em `mensagemDaFalhaDaAnulacao`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type { ReciboDaVendaRegistrada } from "@/hooks/useVendaPresencial";

const FRASE_DO_BANCO =
  "Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.";

function recibo(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm: "2026-10-13T23:50:00.000Z",
    total: 79.8,
    subtotal: 79.8,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens: [],
    jaExistia: false,
    ...parcial,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Recibo do balcão — anular depois do dia da venda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function anularComRecusaDoDia(
    r: ReciboDaVendaRegistrada,
  ): Promise<string> {
    const aoAnular = vi.fn().mockRejectedValue({
      code: "22023",
      message: FRASE_DO_BANCO,
    });
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={r}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
          aoAnular={aoAnular}
        />,
      );
    });
    await act(async () => {
      botao(hospedeiro, "Anular venda")!.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")!.click();
    });
    return hospedeiro.querySelector('[role="alert"]')?.textContent ?? "";
  }

  it("venda sem cliente: não manda registrar devolução; diz que o app não abre devolução para ela", async () => {
    const alerta = await anularComRecusaDoDia(recibo());

    expect(alerta).toContain("Só dá para anular no mesmo dia da venda.");
    expect(alerta).not.toMatch(/registre uma devolu/i);
    expect(alerta).toContain(
      "Esta venda não está na conta de nenhum cliente: o app não abre devolução para ela.",
    );
  });

  it("venda de cliente com conta: diz que troca e reparo são pedidos pelo cliente, no app", async () => {
    const alerta = await anularComRecusaDoDia(
      recibo({
        cliente: {
          tipo: "cadastrado",
          userId: "cliente-1",
          nome: "Maria",
          whatsapp: null,
        },
      }),
    );

    expect(alerta).not.toMatch(/registre uma devolu/i);
    expect(alerta).toContain(
      "a troca ou o reparo de defeito só podem ser pedidos pelo cliente, no app",
    );
  });

  it("cliente avulso (sem conta no app) cai na frase de quem não tem conta", async () => {
    const alerta = await anularComRecusaDoDia(
      recibo({
        cliente: { tipo: "avulso", nome: "Fulano", whatsapp: "11999998888" },
      }),
    );

    expect(alerta).not.toMatch(/registre uma devolu/i);
    expect(alerta).toContain("nenhum cliente");
  });
});
