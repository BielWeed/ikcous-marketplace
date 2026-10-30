// @vitest-environment jsdom
//
// Cartão "Loja pronta" do Início com os passos RECOMENDADOS (30/10/2026,
// vistoria da Savy): e-mail da loja, pagamento pelo app e transportadora.
// Desenho: avisam e levam ao ajuste certo, NÃO entram na conta "N de 6", NÃO
// travam nada e somem quando não se aplicam ou quando a leitura falhou.
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import {
  type FatosDosRecomendados,
  pendentesRecomendados,
} from "@/lib/passos-recomendados";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof LojaProntaEEstoqueBaixo>;

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
});

const CONFIG_PRONTA: Props["config"] = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: ENDERECO_PRONTO.originCep,
  storeAddress: ENDERECO_PRONTO.storeAddress,
  whatsappNumber: "(34) 99999-9999",
  localCepRange: "01000-000, 05999-999",
};

function fatos(parcial: Partial<FatosDosRecomendados> = {}) {
  return {
    email: "configurado",
    pixOk: true,
    nomesLigados: ["Melhor Envio"],
    config: { shippingCoverage: "national" },
    configCarregando: false,
    ...parcial,
  } satisfies FatosDosRecomendados;
}

function propsDoCartao(parcial: Partial<Props> = {}): Props {
  return {
    stats: { inventoryAlerts: 0 },
    config: CONFIG_PRONTA,
    ligado: false,
    chaveOk: false,
    formasNaEntrega: ["cash"],
    produtos: [{ isActive: true }],
    configCarregando: false,
    produtosCarregando: false,
    onNavigate: vi.fn(),
    onTentarDeNovo: vi.fn(),
    ...parcial,
  };
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(parcial: Partial<Props> = {}) {
  await act(async () => {
    raiz.render(<LojaProntaEEstoqueBaixo {...propsDoCartao(parcial)} />);
  });
}

function botaoComTexto(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(trecho),
  );
}

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

describe("Loja pronta — recomendados no Início", () => {
  it("a Savy de 30/10: forma na entrega, mas sem e-mail, sem PIX e sem transportadora", async () => {
    const onNavigate = vi.fn();
    await montar({
      onNavigate,
      recomendados: pendentesRecomendados(
        fatos({ email: "nao_configurado", pixOk: false, nomesLigados: [] }),
      ),
    });
    const grupo = hospedeiro.querySelector(
      '[role="group"][aria-label="Recomendado para vender"]',
    );
    expect(grupo).not.toBeNull();
    expect(grupo?.textContent).toContain("Cadastrar o e-mail da loja");
    expect(grupo?.textContent).toContain("Ligar o pagamento pelo app (PIX)");
    expect(grupo?.textContent).toContain("Ligar uma transportadora");
    expect(grupo?.textContent).toContain("quem é de fora não compra");

    await act(async () => {
      botaoComTexto("Cadastrar o e-mail da loja")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-settings");
    await act(async () => {
      botaoComTexto("Ligar uma transportadora")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-shipping");
  });

  it("não muda a conta dos seis passos: 6 de 6 continua 6 de 6 com recomendados pendentes", async () => {
    await montar({
      recomendados: pendentesRecomendados(
        fatos({ email: "nao_configurado", pixOk: false, nomesLigados: [] }),
      ),
    });
    expect(hospedeiro.textContent).toContain("6 de 6 passos concluídos");
    expect(hospedeiro.textContent).toContain("Cadastro completo");
  });

  it("nada pendente: o bloco não aparece", async () => {
    await montar({ recomendados: pendentesRecomendados(fatos()) });
    expect(hospedeiro.textContent).not.toContain("Recomendado para vender");
  });

  it("sem a prop (quem não leu): o cartão é o de antes", async () => {
    await montar();
    expect(hospedeiro.textContent).not.toContain("Recomendado para vender");
  });

  it("boas-vindas não mostra recomendados", async () => {
    await montar({
      somenteBoasVindas: true,
      config: { ...CONFIG_PRONTA, storeName: "" },
      recomendados: pendentesRecomendados(fatos({ email: "nao_configurado" })),
    });
    expect(hospedeiro.textContent).not.toContain("Recomendado para vender");
  });
});
