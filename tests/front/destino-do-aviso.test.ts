// Avisar clientes: o destino do aviso (para onde o cliente vai ao tocar na
// notificação) virou função pura em `src/lib/destino-do-aviso.ts`. O CONTRATO
// é a URL que vai para o envio (`action_url` no aviso do app, `url` no push e
// no histórico): é a mesma de antes da tela escolher o destino por lista.
// A tabela abaixo usa as URLs LITERAIS de antes — se alguém "arrumar" uma
// delas, o aviso do cliente abre outra página.
import { describe, expect, it } from "vitest";

import {
  type TipoDeDestino,
  destinoDaUrl,
  urlDoDestino,
} from "@/lib/destino-do-aviso";

describe("urlDoDestino — a URL enviada para cada opção da lista", () => {
  const tabela: ReadonlyArray<{
    tipo: TipoDeDestino;
    idDoProduto: string;
    caminho: string;
    url: string;
  }> = [
    { tipo: "home", idDoProduto: "", caminho: "", url: "/" },
    { tipo: "search", idDoProduto: "", caminho: "", url: "/search" },
    { tipo: "cart", idDoProduto: "", caminho: "", url: "/cart" },
    { tipo: "favorites", idDoProduto: "", caminho: "", url: "/favorites" },
    { tipo: "orders", idDoProduto: "", caminho: "", url: "/orders" },
    { tipo: "profile", idDoProduto: "", caminho: "", url: "/profile" },
    {
      tipo: "product",
      idDoProduto: "abc-123",
      caminho: "",
      url: "/product-detail?id=abc-123",
    },
    {
      tipo: "product",
      idDoProduto: "",
      caminho: "",
      url: "/product-detail",
    },
    {
      tipo: "custom",
      idDoProduto: "",
      caminho: "/promocao-do-mes",
      url: "/promocao-do-mes",
    },
  ];

  it.each(tabela)("$tipo envia $url", ({ tipo, idDoProduto, caminho, url }) => {
    expect(urlDoDestino(tipo, idDoProduto, caminho)).toBe(url);
  });

  it("as opções de lista ignoram o id e o caminho que sobraram de outra escolha", () => {
    expect(urlDoDestino("cart", "abc-123", "/sobra")).toBe("/cart");
    expect(urlDoDestino("home", "abc-123", "/sobra")).toBe("/");
    expect(urlDoDestino("orders", "", "/sobra")).toBe("/orders");
  });

  it("o caminho manual sai exatamente como foi digitado (sem tratar nem completar)", () => {
    expect(urlDoDestino("custom", "x", "")).toBe("");
    expect(urlDoDestino("custom", "x", "sem-barra")).toBe("sem-barra");
    expect(urlDoDestino("custom", "x", "/a?b=1")).toBe("/a?b=1");
  });

  it("tipo desconhecido cai na página inicial, como sempre", () => {
    expect(urlDoDestino("qualquer-coisa", "1", "/x")).toBe("/");
  });
});

describe("destinoDaUrl — o inverso (a URL de um modelo pronto escolhe o destino)", () => {
  it.each([
    ["/", "home"],
    ["", "home"],
    ["/home", "home"],
    ["/search", "search"],
    ["/cart", "cart"],
    ["/favorites", "favorites"],
    ["/orders", "orders"],
    ["/profile", "profile"],
  ] as const)("%j é o destino %s", (url, tipo) => {
    expect(destinoDaUrl(url)).toEqual({
      tipo,
      idDoProduto: null,
      caminho: null,
    });
  });

  it("/product-detail?id=… devolve o id do produto", () => {
    expect(destinoDaUrl("/product-detail?id=abc-123")).toEqual({
      tipo: "product",
      idDoProduto: "abc-123",
      caminho: null,
    });
  });

  it("o formato antigo /product/123 ainda é reconhecido como produto", () => {
    expect(destinoDaUrl("/product/123")).toEqual({
      tipo: "product",
      idDoProduto: "123",
      caminho: null,
    });
  });

  it("produto sem id depois do ?id= devolve id vazio (não vira página manual)", () => {
    expect(destinoDaUrl("/product-detail?id=")).toEqual({
      tipo: "product",
      idDoProduto: "",
      caminho: null,
    });
  });

  it("/product-detail sem id não é reconhecido: vai para o caminho manual", () => {
    expect(destinoDaUrl("/product-detail")).toEqual({
      tipo: "custom",
      idDoProduto: null,
      caminho: "/product-detail",
    });
  });

  it("URL fora do conjunto é página manual e guarda o caminho inteiro", () => {
    expect(destinoDaUrl("/promocao-do-mes?x=1")).toEqual({
      tipo: "custom",
      idDoProduto: null,
      caminho: "/promocao-do-mes?x=1",
    });
  });
});

describe("ida e volta", () => {
  it.each([
    ["home", "", ""],
    ["search", "", ""],
    ["cart", "", ""],
    ["favorites", "", ""],
    ["orders", "", ""],
    ["profile", "", ""],
    ["product", "abc-123", ""],
    ["custom", "", "/promocao-do-mes"],
  ] as const)("%s sobrevive à ida e volta", (tipo, idDoProduto, caminho) => {
    const url = urlDoDestino(tipo, idDoProduto, caminho);
    const volta = destinoDaUrl(url);
    expect(volta.tipo).toBe(tipo);
    if (tipo === "product") expect(volta.idDoProduto).toBe(idDoProduto);
    if (tipo === "custom") expect(volta.caminho).toBe(caminho);
  });
});
