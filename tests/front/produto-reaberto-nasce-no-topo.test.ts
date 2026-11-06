/* eslint-disable security/detect-non-literal-fs-filename --
   lê o próprio App.tsx do repositório (caminho fixo, não vem de entrada de usuário) */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { esquecerRolagemDoProdutoAberto } from "@/lib/rolagemDaEntradaNova";
import { describe, expect, it } from "vitest";

describe("esquecerRolagemDoProdutoAberto: abrir um produto de novo nasce no topo", () => {
  it("entrada nova de produto apaga a posição guardada DAQUELE produto", () => {
    const posicoes = { "product-detail-p1": 1800, home: 300 };

    esquecerRolagemDoProdutoAberto(posicoes, "product-detail", "p1");

    expect(posicoes["product-detail-p1"]).toBeUndefined();
  });

  it("não mexe na posição de outro produto nem na de outras telas", () => {
    const posicoes = {
      "product-detail-p1": 1800,
      "product-detail-p2": 900,
      home: 300,
      cart: 50,
    };

    esquecerRolagemDoProdutoAberto(posicoes, "product-detail", "p1");

    expect(posicoes).toEqual({
      "product-detail-p2": 900,
      home: 300,
      cart: 50,
    });
  });

  it("destino que não é produto não apaga nada", () => {
    const posicoes = { "product-detail-p1": 1800, home: 300 };

    esquecerRolagemDoProdutoAberto(posicoes, "home", "p1");
    esquecerRolagemDoProdutoAberto(posicoes, "product-detail", undefined);

    expect(posicoes).toEqual({ "product-detail-p1": 1800, home: 300 });
  });
});

describe("esquecerRolagemDoProdutoAberto: pedido aberto de novo também nasce no topo", () => {
  it("a tela do pedido guarda a posição sob UMA chave só: entrada nova de pedido a apaga (B não nasce onde A parou)", () => {
    const posicoes = { "order-details": 2400, orders: 120, home: 300 };

    esquecerRolagemDoProdutoAberto(posicoes, "order-details", "pedido-b");

    expect(posicoes).toEqual({ orders: 120, home: 300 });
  });

  it("destino que não é pedido, ou pedido sem id, não apaga a posição do pedido", () => {
    const posicoes = { "order-details": 2400, orders: 120 };

    esquecerRolagemDoProdutoAberto(posicoes, "orders", "pedido-b");
    esquecerRolagemDoProdutoAberto(posicoes, "order-details", undefined);

    expect(posicoes).toEqual({ "order-details": 2400, orders: 120 });
  });
});

describe("App.tsx chama o esquecimento só na navegação por ação (handleNavigate)", () => {
  const fonte = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf8");
  const chamada =
    /esquecerRolagemDoProdutoAberto\(\s*scrollPositionsRef\.current,\s*targetView,\s*id,?\s*\)/g;

  it("a chamada existe exatamente uma vez, dentro de handleNavigate e depois do 'mesmo destino' (mesmo pedido já aberto não perde a posição)", () => {
    const achados = [...fonte.matchAll(chamada)];
    expect(achados).toHaveLength(1);

    const posicao = achados[0].index ?? -1;
    const inicioDoHandleNavigate = fonte.indexOf(
      "const handleNavigate = useCallback(",
    );
    const mesmoDestino = fonte.indexOf("if (!isReallyDifferent) {");
    expect(inicioDoHandleNavigate).toBeGreaterThan(-1);
    expect(mesmoDestino).toBeGreaterThan(inicioDoHandleNavigate);
    expect(posicao).toBeGreaterThan(mesmoDestino);
  });

  it("o Voltar/Avançar (popstate, syncWithUrl) nunca esquece a posição", () => {
    const inicioDoSync = fonte.indexOf("const syncWithUrl = ");
    expect(inicioDoSync).toBeGreaterThan(-1);
    expect(fonte.slice(inicioDoSync)).not.toContain(
      "esquecerRolagemDoProdutoAberto(",
    );
  });
});
