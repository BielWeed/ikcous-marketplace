// Caça 11-E, achado 5: a lista de aparelhos chega ordenada por endereço
// (necessário para a paginação não repetir nem pular), o que agrupa por
// empresa: Google, Firefox, Apple, Windows. A send-push tem teto de 50 s e
// corta o FIM da lista, então iPhone e Windows ficavam sempre sem tentativa.
// A ordem do ENVIO intercala os serviços; o conjunto de aparelhos é o mesmo.
import { describe, expect, it } from "vitest";

import { intercalarPorServico } from "@/lib/ordem-do-envio-de-push";

const SERVICOS = [
  "https://fcm.googleapis.com/fcm/send/",
  "https://updates.push.services.mozilla.com/wpush/v2/",
  "https://web.push.apple.com/",
  "https://wns2-par02p.notify.windows.com/w/?token=",
];
const servicoDe = (endpoint: string) => new URL(endpoint).hostname;

function ordenadoPorEndereco(porServico: number[]) {
  return porServico
    .flatMap((n, s) =>
      Array.from({ length: n }, (_, i) => ({ endpoint: `${SERVICOS[s]}${i}` })),
    )
    .sort((a, b) => (a.endpoint < b.endpoint ? -1 : 1));
}

describe("intercalarPorServico", () => {
  it("a ordem de entrada agrupa por empresa; a de saída intercala as quatro", () => {
    const entrada = ordenadoPorEndereco([50, 50, 50, 50]);
    // Premissa do defeito: o início da lista é só Google.
    expect(new Set(entrada.slice(0, 50).map((t) => servicoDe(t.endpoint))).size).toBe(1);

    const saida = intercalarPorServico(entrada);
    const primeiros = saida.slice(0, 8).map((t) => servicoDe(t.endpoint));
    expect(new Set(primeiros.slice(0, 4)).size).toBe(4);
    expect(new Set(primeiros.slice(4, 8)).size).toBe(4);
    // Cortando a lista no meio, todos os serviços foram tentados.
    expect(new Set(saida.slice(0, 100).map((t) => servicoDe(t.endpoint))).size).toBe(4);
  });

  it("nenhum aparelho se perde nem se repete (mesmo conjunto, mesma contagem)", () => {
    const entrada = ordenadoPorEndereco([300, 7, 40, 1]);
    const saida = intercalarPorServico(entrada);
    expect(saida).toHaveLength(entrada.length);
    expect(new Set(saida.map((t) => t.endpoint))).toEqual(
      new Set(entrada.map((t) => t.endpoint)),
    );
    expect(new Set(saida.map((t) => t.endpoint)).size).toBe(entrada.length);
  });

  it("serviços muito desiguais: os pequenos aparecem logo, o resto segue em ordem", () => {
    const saida = intercalarPorServico(ordenadoPorEndereco([100, 0, 3, 0]));
    const servicos = saida.map((t) => servicoDe(t.endpoint));
    expect(servicos.slice(0, 6)).toEqual([
      "fcm.googleapis.com",
      "web.push.apple.com",
      "fcm.googleapis.com",
      "web.push.apple.com",
      "fcm.googleapis.com",
      "web.push.apple.com",
    ]);
    expect(servicos.slice(6).every((s) => s === "fcm.googleapis.com")).toBe(true);
  });

  it("mantém a ordem relativa dentro de cada serviço e não muda o objeto", () => {
    const entrada = ordenadoPorEndereco([5, 0, 5, 0]);
    const copia = [...entrada];
    const saida = intercalarPorServico(entrada);
    expect(entrada).toEqual(copia);
    const doGoogle = saida.filter((t) => servicoDe(t.endpoint) === "fcm.googleapis.com");
    expect(doGoogle).toEqual(copia.filter((t) => servicoDe(t.endpoint) === "fcm.googleapis.com"));
  });

  it("endereço ilegível não derruba o envio: vai junto, num grupo à parte", () => {
    const entrada = [{ endpoint: "isto-nao-e-url" }, { endpoint: `${SERVICOS[0]}1` }, { endpoint: null }];
    const saida = intercalarPorServico(entrada as { endpoint: unknown }[]);
    expect(saida).toHaveLength(3);
    expect(new Set(saida)).toEqual(new Set(entrada));
  });

  it("lista vazia ou ausente", () => {
    expect(intercalarPorServico([])).toEqual([]);
    expect(intercalarPorServico(null)).toEqual([]);
  });
});
