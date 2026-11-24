// @vitest-environment jsdom
//
// Início do painel, os dois lugares que contam "produtos com estoque baixo":
// a linha do "Para fazer" e o cartão "Sua loja". Duas bordas que os testes
// irmãos não prendiam (achadas por mutação):
//
//  - "Para fazer": 1 produto no singular ("1 produto com estoque baixo") e 2+
//    no plural. Trocar a borda do singular passava em silêncio.
//  - Cartão "Sua loja": ZERO produtos com estoque baixo não pinta o ícone de
//    âmbar (atenção); 1 ou mais pinta. Âmbar com zero é alarme falso.
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { classeDoIcone } from "@/lib/tons-de-estado";
import type { PainelInicio } from "@/types/painel";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AMBAR = classeDoIcone("atencao");

const PAINEL: PainelInicio = {
  hoje: {
    receita: 1482,
    online: 1102,
    presencial: 380,
    pedidos: 9,
    receitaSemanaPassada: 1256,
  },
  mes: {
    receita: 18640,
    receitaMesAnterior: 16643,
    pedidos: 112,
    ticketMedio: 166.43,
    lucroEstimado: 4210,
  },
  saldoTotal: 6820,
  aReceber7d: 2340,
  aPagar7d: 1180,
  contasVencidas: 0,
  pendencias: {
    pedidosParaPreparar: 0,
    devolucoesAbertas: 0,
    caixaAberto: false,
    estoqueBaixo: 0,
  },
  serie14d: [],
};

const comEstoqueBaixo = (n: number) =>
  ({
    ...PAINEL,
    pendencias: { ...PAINEL.pendencias, estoqueBaixo: n },
  }) satisfies PainelInicio;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
});

const texto = () =>
  (tela.textContent ?? "").split(String.fromCharCode(160)).join(" ");

describe("Para fazer: linha de estoque baixo concorda em número", () => {
  const montarLinha = (n: number) =>
    act(() =>
      raiz.render(
        <ParaFazer
          painel={comEstoqueBaixo(n)}
          carregando={false}
          onNavigate={vi.fn()}
        />,
      ),
    );

  it("1 produto: singular, nunca '1 produtos'", () => {
    montarLinha(1);

    expect(texto()).toContain("1 produto com estoque baixo");
    expect(texto()).not.toContain("1 produtos com estoque baixo");
  });

  it("0 produtos: a linha nem aparece (nada a repor não é pendência)", () => {
    montarLinha(0);

    expect(texto()).not.toContain("estoque baixo");
  });

  it("2 produtos: plural com o número", () => {
    montarLinha(2);

    expect(texto()).toContain("2 produtos com estoque baixo");
  });

  it("12 produtos: o plural segue com o número inteiro", () => {
    montarLinha(12);

    expect(texto()).toContain("12 produtos com estoque baixo");
  });
});

type PropsDoCartao = ComponentProps<typeof LojaProntaEEstoqueBaixo>;

const ENDERECO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
});

function propsDoCartao(alertas: number): PropsDoCartao {
  return {
    stats: { inventoryAlerts: alertas },
    config: {
      storeName: "Ateliê da Serra",
      logoUrl: "https://exemplo.test/logo.png",
      originCep: ENDERECO.originCep,
      storeAddress: ENDERECO.storeAddress,
      whatsappNumber: "(34) 99999-9999",
      localCepRange: "01000-000, 05999-999",
    },
    ligado: true,
    chaveOk: true,
    formasNaEntrega: [],
    produtos: [{ isActive: true, stock: 5 }],
    configCarregando: false,
    produtosCarregando: false,
    onNavigate: vi.fn(),
    onTentarDeNovo: vi.fn(),
  };
}

describe("Cartão 'Sua loja': a cor do ícone de estoque baixo", () => {
  async function montarCartao(alertas: number) {
    await act(async () => {
      raiz.render(<LojaProntaEEstoqueBaixo {...propsDoCartao(alertas)} />);
    });
  }

  function iconeDoEstoque(): Element {
    const botao = [...tela.querySelectorAll("button")].find((b) =>
      /estoque baixo/i.test(b.textContent ?? ""),
    );
    if (!botao) throw new Error("Cartão de estoque baixo não está na tela.");
    const icone = botao.querySelector("svg");
    if (!icone) throw new Error("Ícone do estoque não está no cartão.");
    return icone;
  }

  it("zero produtos: diz '0 produtos' e o ícone NÃO é âmbar", async () => {
    await montarCartao(0);

    expect(texto()).toContain("Estoque baixo: 0 produtos");
    expect(iconeDoEstoque().getAttribute("class") ?? "").not.toContain(AMBAR);
  });

  it("1 produto: singular e o ícone é âmbar", async () => {
    await montarCartao(1);

    expect(texto()).toContain("Estoque baixo: 1 produto");
    expect(texto()).not.toContain("1 produtos");
    expect(iconeDoEstoque().getAttribute("class") ?? "").toContain(AMBAR);
  });
});
