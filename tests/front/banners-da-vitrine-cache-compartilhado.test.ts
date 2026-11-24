// @vitest-environment jsdom
//
// O cache de banners que o painel e a Home compartilham, nas regras que o
// protegem de uma cópia que não é a lista da loja:
//  - o Realtime só ACOMPANHA uma cópia que a rede já confirmou (com o cofre frio
//    ele pode guardar um registro solto, e esse não é a lista da loja);
//  - a lista do cofre só vale se a rede ainda não confirmou nada;
//  - mutação local vira a última verdade e invalida o que estava em voo;
//    o Realtime NÃO conta como mutação local.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/dataVault", () => ({ DataVault: { init: async () => ({}) } }));

import type { Banner } from "@/types";

const banner = (id: string): Banner => ({
  id,
  title: id,
  imageUrl: "/foto.jpg",
  active: true,
  order: 1,
  position: "home_top",
});

async function modulo() {
  vi.resetModules();
  return import("@/lib/banners-da-vitrine");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("o cache compartilhado de banners", () => {
  it("o Realtime sozinho não cria cache: sem lista confirmada, nada é guardado", async () => {
    const m = await modulo();

    m.acompanharBannersDoRealtime([banner("solto")]);

    expect(m.bannersEmCache()).toBeNull();
    expect(m.horaDaUltimaConsultaDeBanners()).toBe(0);
  });

  it("com a lista confirmada, o Realtime a acompanha e renova a hora, sem contar como mutação", async () => {
    const m = await modulo();
    m.gravarBannersLocais([banner("a")]);
    const geracao = m.geracaoDasMutacoesDeBanners();

    m.acompanharBannersDoRealtime([banner("b")]);

    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["b"]);
    expect(m.horaDaUltimaConsultaDeBanners()).toBeGreaterThan(0);
    expect(m.geracaoDasMutacoesDeBanners()).toBe(geracao);
  });

  it("mutação local vira a última verdade e sobe a geração", async () => {
    const m = await modulo();
    const antes = m.geracaoDasMutacoesDeBanners();

    m.gravarBannersLocais([banner("a")]);
    m.gravarBannersLocais([banner("a"), banner("b")]);

    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["a", "b"]);
    expect(m.geracaoDasMutacoesDeBanners()).toBe(antes + 2);
  });

  it("a lista do cofre semeia o cache uma vez e só se a rede ainda não confirmou nada", async () => {
    const m = await modulo();

    expect(m.semearBannersDoCofre([banner("cofre")])).toBe(true);
    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["cofre"]);
    // Já há cache: uma segunda semeadura não sobrescreve.
    expect(m.semearBannersDoCofre([banner("outra")])).toBe(false);
    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["cofre"]);
  });

  it("uma mutação local antes do cofre responder impede o cofre de sobrescrever", async () => {
    const m = await modulo();
    m.gravarBannersLocais([banner("local")]);

    expect(m.semearBannersDoCofre([banner("cofre")])).toBe(false);
    expect(m.bannersEmCache()?.map((b) => b.id)).toEqual(["local"]);
  });
});
