import { describe, expect, it } from "vitest";
import {
  caminhoDoPedidoNoAviso,
  decidirToqueNoAviso,
} from "../../src/lib/alvo-do-aviso";

// O aviso "Seu pedido #X agora está: ..." precisa abrir O PEDIDO da cliente,
// não a vitrine. O endereço é o MESMO que o app já escreve ao abrir um pedido
// (`handleNavigate`, App.tsx: `/${tela}?id=${id}`) e que `syncWithUrl` lê.

const ORIGEM = "https://loja.example";

describe("caminhoDoPedidoNoAviso", () => {
  it.each([
    ["pedido-c35ce4dd-7a1b", "/order-details?id=pedido-c35ce4dd-7a1b"],
    [
      "0b9f2c3e-1d4a-4f6b-8c7d-9e0a1b2c3d4e",
      "/order-details?id=0b9f2c3e-1d4a-4f6b-8c7d-9e0a1b2c3d4e",
    ],
    ["a b&c", "/order-details?id=a%20b%26c"],
  ])("pedido %s abre %s", (id, esperado) => {
    expect(caminhoDoPedidoNoAviso(id)).toBe(esperado);
  });
});

describe("decidirToqueNoAviso", () => {
  const casos: Array<{
    nome: string;
    alvo: string;
    janelas: string[];
    esperado: ReturnType<typeof decidirToqueNoAviso>;
  }> = [
    {
      nome: "sem nenhuma janela aberta: abre uma nova",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [],
      esperado: { acao: "abrir" },
    },
    {
      nome: "aviso sem endereço ('/') e janela da loja em /?source=pwa: só foca (comportamento de hoje)",
      alvo: `${ORIGEM}/`,
      janelas: [`${ORIGEM}/?source=pwa`],
      esperado: { acao: "focar", indice: 0 },
    },
    {
      nome: "aviso sem endereço ('/') e janela em outra tela: abre nova (comportamento de hoje)",
      alvo: `${ORIGEM}/`,
      janelas: [`${ORIGEM}/cart`],
      esperado: { acao: "abrir" },
    },
    {
      nome: "campanha com caminho e sem query: foca a janela do mesmo caminho",
      alvo: `${ORIGEM}/favorites`,
      janelas: [`${ORIGEM}/favorites?x=1`],
      esperado: { acao: "focar", indice: 0 },
    },
    {
      nome: "já está no MESMO pedido: só foca",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/order-details?id=A`],
      esperado: { acao: "focar", indice: 0 },
    },
    {
      nome: "já está em OUTRO pedido: navega para o do aviso",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/order-details?id=B`],
      esperado: { acao: "navegar", indice: 0 },
    },
    {
      nome: "está em /order-details sem id: navega",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/order-details`],
      esperado: { acao: "navegar", indice: 0 },
    },
    {
      nome: "duas janelas, a segunda já está no pedido certo: foca a segunda (não navega a primeira)",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/order-details?id=B`, `${ORIGEM}/order-details?id=A`],
      esperado: { acao: "focar", indice: 1 },
    },
    {
      nome: "janela no pedido certo mas com outro parâmetro junto: foca",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/order-details?id=A&source=pwa`],
      esperado: { acao: "focar", indice: 0 },
    },
    {
      nome: "janela da loja na vitrine e aviso de pedido: abre nova (não derruba a vitrine)",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: [`${ORIGEM}/?source=pwa`],
      esperado: { acao: "abrir" },
    },
    {
      nome: "janela de OUTRA origem nunca conta",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: ["https://outra.example/order-details?id=A"],
      esperado: { acao: "abrir" },
    },
    {
      nome: "endereço de janela inválido é ignorado, sem quebrar",
      alvo: `${ORIGEM}/order-details?id=A`,
      janelas: ["isto não é url", `${ORIGEM}/order-details?id=B`],
      esperado: { acao: "navegar", indice: 1 },
    },
  ];

  it.each(casos)("$nome", ({ alvo, janelas, esperado }) => {
    expect(decidirToqueNoAviso(alvo, janelas)).toEqual(esperado);
  });
});
