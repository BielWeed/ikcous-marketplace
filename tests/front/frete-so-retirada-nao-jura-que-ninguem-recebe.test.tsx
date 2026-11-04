// @vitest-environment jsdom
//
// "Só retirada" não manda NADA para dentro da cidade, mas o servidor continua
// cotando a transportadora para o CEP de fora (cobertura nacional + transportadora
// ligada): o cliente de outra cidade paga o frete e a lojista recebe um pedido
// para despachar. A tela dizia o contrário ("qualquer cliente, de qualquer
// lugar, busca na loja"; "quem é de fora retira na loja"). Aqui se prova que a
// promessa da tela segue o servidor: com transportadora vendendo fora o texto
// fala dela; sem ela (ou com a cobertura só na cidade) a retirada é a única saída.
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import { statusDaEntrega } from "@/lib/status-da-entrega";
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEXTO_ANTIGO =
  "Ninguém recebe em casa. Qualquer cliente, de qualquer lugar, busca na loja.";

const soRetiro = (parcial: Partial<StoreConfig> = {}) =>
  ({
    originCep: "38400-000",
    localDeliveryEnabled: false,
    shippingCoverage: "national",
    storeAddress: "Rua A, 10",
    enabledShippingMethods: ["store-pickup", "pac"],
    ...parcial,
  }) as unknown as StoreConfig;

describe("Só retirada — a tela não promete o que o servidor não faz", () => {
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

  function efeitoDaSoRetirada(
    coverage: "local" | "national",
    nomesLigados: readonly string[] | null,
  ): string {
    act(() => {
      raiz.render(
        <FreteLocalBloco
          valor={10}
          onValor={() => {}}
          faixa=""
          onFaixa={() => {}}
          coverage={coverage}
          cepDaLoja="38400-100"
          modo="entrego"
          onModo={() => {}}
          nomesLigados={nomesLigados}
        />,
      );
    });
    const chave = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((b) => b.querySelector("span")?.textContent === "Só retirada");
    return chave?.textContent ?? "";
  }

  function previa(config: StoreConfig, nomesLigados: readonly string[] | null) {
    act(() => {
      raiz.render(
        <PreviaDoFrete
          config={config}
          nomesLigados={nomesLigados}
          pendente={false}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("opção 'Só retirada' com transportadora vendendo fora: não diz que qualquer lugar busca na loja", () => {
    const texto = efeitoDaSoRetirada("national", ["Melhor Envio"]);
    expect(texto).not.toContain("de qualquer lugar");
    expect(texto).toContain("transportadora");
  });

  it("opção 'Só retirada' sem saber as transportadoras ainda: também não jura", () => {
    expect(efeitoDaSoRetirada("national", null)).not.toContain(
      "de qualquer lugar",
    );
  });

  it("opção 'Só retirada' sem transportadora ou com cobertura só na cidade: a frase antiga é verdadeira e fica", () => {
    expect(efeitoDaSoRetirada("national", [])).toContain(TEXTO_ANTIGO);
    expect(efeitoDaSoRetirada("local", ["Melhor Envio"])).toContain(
      TEXTO_ANTIGO,
    );
  });

  it("prévia com transportadora vendendo fora: lista a transportadora em vez de 'retira na loja'", () => {
    const texto = previa(soRetiro(), ["Melhor Envio"]);
    expect(texto).toContain("Melhor Envio");
    expect(texto).not.toContain("quem é de fora retira na loja");
    expect(texto).not.toContain("Só retirada · Grátis");
  });

  it("prévia sem transportadora ou com cobertura só na cidade: segue dizendo que a retirada é a saída", () => {
    for (const texto of [
      previa(soRetiro(), []),
      previa(soRetiro({ shippingCoverage: "local" }), ["Melhor Envio"]),
    ]) {
      expect(texto).toContain("quem é de fora retira na loja");
      expect(texto).toContain("Só retirada · Grátis");
    }
  });

  it("faixa 'Fora da cidade' com transportadora ligada: diz a transportadora e a retirada", () => {
    const [, nacional] = statusDaEntrega({
      config: soRetiro(),
      credsErro: false,
      nomesLigados: ["Melhor Envio"],
    });
    expect(nacional.valor).toBe("Melhor Envio ligado");
    expect(nacional.detalhe).toContain("retirar na loja");
  });

  it("faixa 'Fora da cidade' sem transportadora ou só na cidade: segue 'Só retirada'", () => {
    for (const entrada of [
      { config: soRetiro(), nomesLigados: [] as string[] },
      {
        config: soRetiro({ shippingCoverage: "local" }),
        nomesLigados: ["Melhor Envio"],
      },
    ]) {
      const [, nacional] = statusDaEntrega({ ...entrada, credsErro: false });
      expect(nacional.valor).toBe("Só retirada");
      expect(nacional.detalhe).toContain("retirar na loja");
    }
  });
});
