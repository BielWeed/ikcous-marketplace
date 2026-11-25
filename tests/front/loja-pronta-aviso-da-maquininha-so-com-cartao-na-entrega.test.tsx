// @vitest-environment jsdom
//
// Cartão "Loja pronta" do Início, lista dos seis passos aberta: debaixo de
// "Recebe" (passo feito) aparecem as formas que a loja aceita na ENTREGA.
//   - a frase "Sem maquininha? Desligue Cartão..." só faz sentido quando o
//     Cartão está entre elas; com só Pix e Dinheiro ela mandaria a lojista
//     desligar algo que não está ligado;
//   - sem nenhuma forma na entrega, o bloco inteiro ("Ativos na entrega:")
//     nem aparece (nada de "Ativos na entrega: " vazio).
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof LojaProntaEEstoqueBaixo>;

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Exemplo",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  cidade: "São Paulo",
  uf: "SP",
});

// Loja toda pronta (6/6): o passo "recebe" fica feito com o Pix ligado.
const CONFIG_PRONTA: Props["config"] = {
  storeName: "Loja de Teste",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: ENDERECO_PRONTO.originCep,
  storeAddress: ENDERECO_PRONTO.storeAddress,
  whatsappNumber: "(11) 90000-0000",
  localCepRange: "01000-000, 05999-999",
};

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

async function montarComListaAberta(
  formasNaEntrega: Props["formasNaEntrega"],
): Promise<string> {
  await act(async () => {
    raiz.render(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        config={CONFIG_PRONTA}
        ligado
        chaveOk
        formasNaEntrega={formasNaEntrega}
        produtos={[{ isActive: true, stock: 5 }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );
  });
  const abrir = hospedeiro.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  expect(abrir).toBeTruthy();
  await act(async () => {
    abrir?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return (hospedeiro.querySelector("ul")?.textContent ?? "").replace(
    /\s+/g,
    " ",
  );
}

describe("Loja pronta: o aviso da maquininha na lista dos seis passos", () => {
  it("só Pix e Dinheiro na entrega: lista os dois e NÃO fala de maquininha", async () => {
    const texto = await montarComListaAberta(["pix", "cash"]);
    expect(texto).toContain("Ativos na entrega: Pix, Dinheiro");
    expect(texto).not.toContain("Sem maquininha?");
    expect(texto).not.toContain("Desligue Cartão");
  });

  it("só Dinheiro na entrega: nada de maquininha", async () => {
    const texto = await montarComListaAberta(["cash"]);
    expect(texto).toContain("Ativos na entrega: Dinheiro");
    expect(texto).not.toContain("Sem maquininha?");
  });

  it("só Cartão na entrega: o aviso da maquininha aparece", async () => {
    const texto = await montarComListaAberta(["card"]);
    expect(texto).toContain("Ativos na entrega: Cartão");
    expect(texto).toContain(
      "Sem maquininha? Desligue Cartão na entrega/retirada.",
    );
  });

  it("nenhuma forma na entrega: o bloco 'Ativos na entrega' não aparece", async () => {
    const texto = await montarComListaAberta([]);
    expect(texto).not.toContain("Ativos na entrega");
    expect(texto).not.toContain("Sem maquininha?");
    expect(hospedeiro.textContent).not.toContain("Formas de pagamento");
  });
});
