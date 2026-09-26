// DESTAQUES DO FRETE (release 1.5.7) — CONTRATO-1.5.7.md §6, R1-7 e R2-4.
//
// Com vários provedores ligados a lista de frete cresce; o dono pediu só
// DUAS opções em destaque (mais barata, mais rápida) e o resto atrás de
// "+ Ver outras opções". Este arquivo prova a função pura que decide QUEM
// são os destaques — a tela (ShippingCalculator) só desenha o que ela
// devolve.
import { destaquesDoFrete } from "@/lib/destaques-do-frete";
import { describe, expect, it } from "vitest";

type Opcao = { id: string; price: number; deliveryDays: number };
const opcao = (id: string, price: number, deliveryDays: number): Opcao => ({
  id,
  price,
  deliveryDays,
});

describe("destaquesDoFrete", () => {
  it("mais barata: menor preço, empate menor prazo, empate o id", () => {
    const a = opcao("a", 20, 5);
    const b = opcao("b", 10, 8);
    const c = opcao("c", 10, 3);
    expect(destaquesDoFrete([a, b, c]).maisBarata?.id).toBe("c");

    // Empate de preço E prazo: o id decide (ordem estável).
    const d = opcao("z", 10, 3);
    const e = opcao("m", 10, 3);
    expect(destaquesDoFrete([d, e]).maisBarata?.id).toBe("m");
  });

  it("mais rápida: menor prazo, empate menor preço, empate o id", () => {
    const a = opcao("a", 20, 5);
    const b = opcao("b", 10, 2);
    const c = opcao("c", 8, 2);
    expect(destaquesDoFrete([a, b, c]).maisRapida?.id).toBe("c");

    const d = opcao("z", 10, 1);
    const e = opcao("m", 10, 1);
    expect(destaquesDoFrete([d, e]).maisRapida?.id).toBe("m");
  });

  it("a mesma oferta vencendo as duas corridas vira UM item com os dois selos", () => {
    const loggi = opcao("frenet-LOGGI", 15, 2);
    const sedex = opcao("melhor-envio-2", 40, 4);
    const resultado = destaquesDoFrete([loggi, sedex]);
    expect(resultado.mesmaOferta).toBe(true);
    expect(resultado.maisBarata?.id).toBe("frenet-LOGGI");
    expect(resultado.maisRapida?.id).toBe("frenet-LOGGI");
    // O SEDEX (não vencedor) vai para as outras, nunca duplicado.
    expect(resultado.outras.map((o) => o.id)).toEqual(["melhor-envio-2"]);
  });

  it("a retirada fica FORA dos destaques e de 'outras' — aparece como hoje, à parte", () => {
    const retirada = opcao("store-pickup", 0, 0);
    const pac = opcao("melhor-envio-1", 26.41, 8);
    const resultado = destaquesDoFrete([retirada, pac]);
    expect(resultado.maisBarata?.id).toBe("melhor-envio-1");
    expect(resultado.maisRapida?.id).toBe("melhor-envio-1");
    expect(resultado.outras.some((o) => o.id === "store-pickup")).toBe(false);
  });

  it("a entrega local PARTICIPA do ranking (R2-4) — pode virar destaque ou cair em outras", () => {
    const local = opcao("local-delivery", 5, 1);
    const sedex = opcao("melhor-envio-2", 54.88, 4);
    const resultado = destaquesDoFrete([local, sedex]);
    expect(resultado.maisBarata?.id).toBe("local-delivery");
    expect(resultado.maisRapida?.id).toBe("local-delivery");
    expect(resultado.outras.map((o) => o.id)).toEqual(["melhor-envio-2"]);
  });

  it("'outras' nunca repete quem já é destaque, e vem em preço crescente", () => {
    const barata = opcao("barata", 10, 9);
    const rapida = opcao("rapida", 90, 1);
    const meio1 = opcao("meio-caro", 50, 5);
    const meio2 = opcao("meio-barato", 30, 6);
    const resultado = destaquesDoFrete([rapida, barata, meio1, meio2]);
    expect(resultado.maisBarata?.id).toBe("barata");
    expect(resultado.maisRapida?.id).toBe("rapida");
    expect(resultado.outras.map((o) => o.id)).toEqual([
      "meio-barato",
      "meio-caro",
    ]);
  });

  it("preço 0 e prazo 0 são válidos (Frenet/ME com regra da loja, entrega no mesmo dia)", () => {
    const gratisNoMesmoDia = opcao("frenet-X", 0, 0);
    const pac = opcao("melhor-envio-1", 26.41, 8);
    const resultado = destaquesDoFrete([gratisNoMesmoDia, pac]);
    expect(resultado.maisBarata?.id).toBe("frenet-X");
    expect(resultado.maisRapida?.id).toBe("frenet-X");
    expect(resultado.mesmaOferta).toBe(true);
  });

  it("lista vazia, ausente ou só com retirada: nada de destaque, nada inventado", () => {
    expect(destaquesDoFrete([])).toEqual({
      maisBarata: null,
      maisRapida: null,
      mesmaOferta: false,
      outras: [],
    });
    expect(destaquesDoFrete(null)).toEqual({
      maisBarata: null,
      maisRapida: null,
      mesmaOferta: false,
      outras: [],
    });
    expect(destaquesDoFrete(undefined)).toEqual({
      maisBarata: null,
      maisRapida: null,
      mesmaOferta: false,
      outras: [],
    });
    expect(
      destaquesDoFrete([opcao("store-pickup", 0, 0)]).maisBarata,
    ).toBeNull();
  });

  it("uma opção só (sem retirada): ela é os dois destaques, sem 'outras'", () => {
    const unica = opcao("unica", 15, 3);
    const resultado = destaquesDoFrete([unica]);
    expect(resultado.mesmaOferta).toBe(true);
    expect(resultado.maisBarata?.id).toBe("unica");
    expect(resultado.outras).toEqual([]);
  });

  it("a ordem de chegada da lista não muda o resultado", () => {
    const a = opcao("a", 20, 5);
    const b = opcao("b", 10, 2);
    const c = opcao("c", 30, 9);
    const emUmaOrdem = destaquesDoFrete([a, b, c]);
    const naOutra = destaquesDoFrete([c, b, a]);
    expect(naOutra.maisBarata?.id).toBe(emUmaOrdem.maisBarata?.id);
    expect(naOutra.maisRapida?.id).toBe(emUmaOrdem.maisRapida?.id);
    expect(naOutra.outras.map((o) => o.id)).toEqual(
      emUmaOrdem.outras.map((o) => o.id),
    );
  });
});
