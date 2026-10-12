// @vitest-environment jsdom
//
// O CEP de origem só conclui a "entrega" do cartão do Início com oito dígitos.
// Desde o cartão dos seis passos, o endereço (CEP + número) é um passo à
// parte; aqui a loja tem nome, logo, WhatsApp, PIX e produto, e só o CEP varia
// — o que se observa é a linha "Como você entrega" da lista dos seis.
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CEP de origem só conclui a entrega do cartão com oito dígitos", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each([
    { cep: "123", feito: false },
    { cep: "12345-678", feito: true },
    { cep: "12345678", feito: true },
    { cep: "   ", feito: false },
    { cep: "", feito: false },
    { cep: undefined, feito: false },
    { cep: "1234567", feito: false },
    { cep: "123456789", feito: false },
    { cep: "abcdefgh", feito: false },
    { cep: "abc12345678", feito: false },
    { cep: "12345--678", feito: false },
    { cep: "1234-5678", feito: false },
    { cep: " 12345-678 ", feito: true },
  ])("CEP $cep: feito=$feito", async ({ cep, feito }) => {
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <LojaProntaEEstoqueBaixo
          stats={{ inventoryAlerts: 0 }}
          config={{
            storeName: "Loja",
            logoUrl: "https://exemplo.test/logo.png",
            originCep: cep,
            storeAddress: null,
            whatsappNumber: "34999999999",
          }}
          ligado={true}
          chaveOk={true}
          formasNaEntrega={[]}
          produtos={[{ isActive: true }]}
          configCarregando={false}
          produtosCarregando={false}
          onNavigate={onNavigate}
          onTentarDeNovo={vi.fn()}
        />,
      );
    });

    // A lista dos seis nasce recolhida: abre para ler a linha da entrega.
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click();
    });
    const itemEntrega = Array.from(hospedeiro.querySelectorAll("ul > li")).find(
      (item) => /entrega/i.test(item.textContent ?? ""),
    );
    expect(itemEntrega).toBeDefined();
    if (feito) {
      expect(itemEntrega?.textContent).toContain("Entrega configurada");
      expect(itemEntrega?.querySelector("button")).toBeNull();
    } else {
      expect(itemEntrega?.textContent).toContain("Configurar a entrega");
      const botao = itemEntrega?.querySelector("button");
      expect(botao).toBeTruthy();
      await act(async () => botao?.click());
      expect(onNavigate).toHaveBeenCalledWith("admin-shipping");
    }
    // O endereço (CEP + número) é outro passo: sem texto montado, ele segue
    // pendente e a loja nunca aparece como pronta por causa do CEP sozinho.
    expect(hospedeiro.textContent).not.toContain("Loja pronta para vender");
  });
});
