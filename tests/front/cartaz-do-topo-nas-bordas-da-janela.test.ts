// Quem aparece no topo, no INSTANTE em que a janela do banner abre ou fecha.
//
// O porteiro escolhe o banner do topo com a mesma regra do app: a programação
// vale do início ao fim, ambos inclusive (no milissegundo do início já está no
// ar; no do fim ainda está). E um banner que abre ou fecha DENTRO da margem de
// 2 minutos pode trocar de capa antes de o app pintar: nesse caso, sem cartaz.
// Os testes vizinhos provam a margem com folga de 1 s; aqui a prova é no
// milissegundo exato da fronteira, onde um `<` trocado por `<=` mudaria o
// banner que a cliente vê na primeira visita.
import { MARGEM_DO_FIM_MS, escolherBannerDoTopo } from "@/hospedagem/cartaz";
import { describe, expect, it } from "vitest";

const AGORA = Date.parse("2026-10-31T12:00:00Z");
const iso = (instante: number) => new Date(instante).toISOString();

function linha(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    image_url: "https://loja.test/storage/v1/object/public/banners/a.webp",
    position: "home_top",
    active: true,
    order: 1,
    start_date: null,
    end_date: null,
    ...extra,
  };
}

describe("o início da programação, no milissegundo", () => {
  it("começou neste exato instante: já está no ar e é o banner do topo", () => {
    const lista = [linha({ start_date: iso(AGORA) })];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b1");
  });

  it("começa a exatos 2 minutos: ainda fora da margem, o segundo banner é o do topo", () => {
    const lista = [
      linha({ id: "b1", order: 1, start_date: iso(AGORA + MARGEM_DO_FIM_MS) }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });

  it("começa 1 ms antes dos 2 minutos: dentro da margem, sem cartaz", () => {
    const lista = [
      linha({
        id: "b1",
        order: 1,
        start_date: iso(AGORA + MARGEM_DO_FIM_MS - 1),
      }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
});

describe("o fim da programação, no milissegundo", () => {
  it("termina neste exato instante: ainda no ar, mas saindo, então sem cartaz", () => {
    const lista = [
      linha({ id: "b1", order: 1, end_date: iso(AGORA) }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });

  it("terminou 1 ms atrás: saiu do ar, o segundo banner é o do topo", () => {
    const lista = [
      linha({ id: "b1", order: 1, end_date: iso(AGORA - 1) }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });

  it("termina a exatos 2 minutos: fora da margem, segue sendo o banner do topo", () => {
    const lista = [linha({ end_date: iso(AGORA + MARGEM_DO_FIM_MS) })];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b1");
  });

  it("termina 1 ms antes dos 2 minutos: dentro da margem, sem cartaz", () => {
    const lista = [linha({ end_date: iso(AGORA + MARGEM_DO_FIM_MS - 1) })];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
});

describe("a ordem que não é número", () => {
  it("ordem ilegível vale 0 e empata com outro 0: sem cartaz", () => {
    const lista = [
      linha({ id: "b1", order: "primeiro" }),
      linha({ id: "b2", order: 0 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });

  it("ordem ilegível vale 0 e passa na frente de uma ordem 5", () => {
    const lista = [
      linha({ id: "b1", order: 5 }),
      linha({ id: "b2", order: "primeiro" }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });
});

describe("data ilegível com outro banner na fila", () => {
  it("início ilegível: o app trata como 'dentro', então na dúvida não há cartaz", () => {
    const lista = [
      linha({ id: "b1", order: 1, start_date: "em breve" }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });

  it("fim ilegível: idem", () => {
    const lista = [
      linha({ id: "b1", order: 1, end_date: "nunca" }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });

  it("data que não é texto também é ilegível", () => {
    const lista = [
      linha({ id: "b1", order: 1, end_date: 20261231 }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
});

describe("o que o app descarta ou assume antes de filtrar", () => {
  it("foto vazia nas duas colunas: o app descarta o banner, o segundo é o do topo", () => {
    const lista = [
      linha({ id: "b1", order: 1, image_url: "", imagem_url: "" }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });

  it("sem a coluna de ligado/desligado, o banner vale como ligado (como o app)", () => {
    const semColuna = linha();
    semColuna.active = undefined;
    expect(escolherBannerDoTopo([semColuna], AGORA)?.id).toBe("b1");
  });
});
