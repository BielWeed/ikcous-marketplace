// @vitest-environment jsdom
//
// A consulta dos banners da vitrine no nível do módulo (sem o hook por cima):
//
//  - dois pedidos AO MESMO TEMPO dividem UMA consulta (a Home, o painel e o boot
//    pedem juntos; cada um indo ao banco duplicaria a leitura na rede fraca), e
//    depois que ela termina o próximo pedido é uma consulta nova;
//  - uma edição local que passa ENQUANTO a consulta está em voo vence a resposta:
//    quem esperava recebe a lista editada (não uma lista vazia, que apagaria a
//    tela), o cache continua sendo o da edição e a resposta velha não grava nada;
//  - a lista lida da rede vai para o cofre do aparelho e SÓ DEPOIS de gravada o
//    cofre marca a hora da sincronização (gravação que falhou não marca nada e
//    não derruba a leitura);
//  - uma resposta com ERRO que só chega depois da edição local também não derruba
//    a tela: a edição já é a verdade conhecida.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  persistir: vi.fn(),
  sincronizar: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: h.consultar }),
      }),
    }),
  },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      replaceAll: h.persistir,
      setLastSync: h.sincronizar,
    }),
  },
}));

type Resposta = { data: unknown[] | null; error: unknown };

/** Uma consulta que só termina quando o teste manda. */
function consultaManual() {
  let responder: (r: Resposta) => void = () => {};
  h.consultar.mockImplementationOnce(
    () =>
      new Promise<Resposta>((resolve) => {
        responder = resolve;
      }),
  );
  return (r: Resposta) => responder(r);
}

const linhaRemota = (id: string) => ({
  id,
  image_url: "https://loja.test/banners/remoto.png",
  position: "home_middle",
});

const bannerLocal = (id: string): Banner => ({
  id,
  title: id,
  imageUrl: "https://loja.test/banners/local.png",
  active: true,
  order: 1,
  position: "home_middle",
});

async function modulo() {
  vi.resetModules();
  return import("@/lib/banners-da-vitrine");
}

beforeEach(() => {
  h.consultar.mockReset();
  h.persistir.mockReset().mockResolvedValue(undefined);
  h.sincronizar.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pedidos de banners ao mesmo tempo", () => {
  it("dois pedidos juntos dividem uma só consulta ao banco", async () => {
    const m = await modulo();
    const responder = consultaManual();

    const primeiro = m.pedirBanners();
    const segundo = m.pedirBanners();
    expect(m.consultaDeBannersEmVoo()).toBe(primeiro);
    responder({ data: [linhaRemota("a")], error: null });

    expect(segundo).toBe(primeiro);
    expect(h.consultar).toHaveBeenCalledTimes(1);
    expect((await primeiro).map((b) => b.id)).toEqual(["a"]);
  });

  it("terminada a consulta, o pedido seguinte é uma consulta nova", async () => {
    const m = await modulo();
    const responder = consultaManual();
    const primeiro = m.pedirBanners();
    responder({ data: [linhaRemota("a")], error: null });
    await primeiro;
    expect(m.consultaDeBannersEmVoo()).toBeNull();

    const responder2 = consultaManual();
    const segundo = m.pedirBanners();
    responder2({ data: [linhaRemota("b")], error: null });

    expect(h.consultar).toHaveBeenCalledTimes(2);
    expect((await segundo).map((b) => b.id)).toEqual(["b"]);
  });
});

describe("a lista lida vai para o cofre do aparelho", () => {
  it("grava a lista e só então marca a hora da sincronização dos banners", async () => {
    const m = await modulo();
    const responder = consultaManual();
    const pedido = m.pedirBanners();
    responder({ data: [linhaRemota("a")], error: null });
    await pedido;
    await vi.waitFor(() => expect(h.sincronizar).toHaveBeenCalledTimes(1));

    expect(h.persistir).toHaveBeenCalledWith(
      "banners",
      expect.arrayContaining([expect.objectContaining({ id: "a" })]),
    );
    expect(h.sincronizar).toHaveBeenCalledWith("banners");
    expect(h.persistir.mock.invocationCallOrder[0]).toBeLessThan(
      h.sincronizar.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("cofre que falha ao gravar não marca sincronização e não derruba a leitura", async () => {
    const m = await modulo();
    h.persistir.mockRejectedValue(new Error("cofre cheio"));
    const responder = consultaManual();
    const pedido = m.pedirBanners();
    responder({ data: [linhaRemota("a")], error: null });

    await expect(pedido).resolves.toHaveLength(1);
    await vi.waitFor(() => expect(h.persistir).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(h.sincronizar).not.toHaveBeenCalled();
  });
});

describe("edição local durante a consulta em voo", () => {
  it("quem esperava recebe a lista editada, e a resposta velha não grava nada", async () => {
    const m = await modulo();
    const responder = consultaManual();
    const pedido = m.pedirBanners();

    m.gravarBannersLocais([bannerLocal("editado")]);
    responder({ data: [linhaRemota("velho")], error: null });
    const entregue = await pedido;

    expect(entregue.map((b) => b.id)).toEqual(["editado"]);
    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["editado"]);
    expect(h.persistir).not.toHaveBeenCalled();
  });

  it("resposta com erro que chega depois da edição local não rejeita", async () => {
    const m = await modulo();
    const responder = consultaManual();
    const pedido = m.pedirBanners();

    m.gravarBannersLocais([bannerLocal("editado")]);
    responder({ data: null, error: new Error("rede caiu") });

    await expect(pedido).resolves.toHaveLength(1);
    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["editado"]);
  });

  it("sem edição no meio, o erro da consulta rejeita e o cache continua vazio", async () => {
    const m = await modulo();
    const responder = consultaManual();
    const pedido = m.pedirBanners();

    responder({ data: null, error: new Error("rede caiu") });

    await expect(pedido).rejects.toThrow("rede caiu");
    expect(m.bannersEmCache()).toBeNull();
  });
});
