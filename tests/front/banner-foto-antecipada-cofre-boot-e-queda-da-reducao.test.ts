// @vitest-environment jsdom
//
// Bordas da foto do banner do topo que o app baixa ANTES da Home montar, e do
// relógio do cache de banners, que os outros testes não pegavam:
//
//  - a lista que vem do COFRE do aparelho (offline-first) também antecipa a foto
//    do topo, não só a que vem da rede;
//  - o Realtime que acompanha a lista renova a hora da última verdade (senão o
//    throttle de 60 s trata a cópia como velha e consulta de novo à toa) -- o
//    teste usa relógio fixo, porque uma hora "maior que zero" já existia antes;
//  - se a versão REDUZIDA da foto falha, o app pede a original UMA vez, e não
//    fica preso nem repete o pedido; foto sem versão reduzida nem arma a rede
//    de segurança (ela já é a original);
//  - no BOOT, quem decide se a foto é antecipada é o banner do topo que está no
//    ar -- não um banner do meio, nem um vencido que ainda está ligado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

const h = vi.hoisted(() => ({ consultar: vi.fn() }));

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
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));

const REDUZIVEL = "https://loja.test/storage/v1/object/public/banners/r.png";
const SEM_REDUCAO = "https://loja.test/banners/original.png";
const VENCIDO_EM = "2020-01-01T00:00:00Z";

interface ImagemRegistrada {
  src: string;
  srcset: string;
  sizes: string;
  onerror: (() => void) | null;
}
const imagens: ImagemRegistrada[] = [];

function banner(id: string, extra: Partial<Banner> = {}): Banner {
  return {
    id,
    imageUrl: REDUZIVEL,
    title: id,
    position: "home_top",
    active: true,
    order: 0,
    ...extra,
  };
}

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  image_url: REDUZIVEL,
  position: "home_top",
  active: true,
  order: 0,
  ...extra,
});

async function modulo() {
  vi.resetModules();
  return import("@/lib/banners-da-vitrine");
}

async function bootCom(linhas: Record<string, unknown>[]) {
  h.consultar.mockResolvedValue({ data: linhas, error: null });
  const m = await modulo();
  await m.pedirBanners({ cedo: true });
}

beforeEach(() => {
  imagens.length = 0;
  h.consultar.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      srcset = "";
      sizes = "";
      onerror: (() => void) | null = null;
      constructor() {
        imagens.push(this);
      }
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a lista do cofre também antecipa a foto do topo", () => {
  it("semear com um banner do topo no ar baixa a foto dele", async () => {
    const m = await modulo();

    expect(m.semearBannersDoCofre([banner("topo")])).toBe(true);

    expect(imagens).toHaveLength(1);
    expect(imagens[0]?.src).toContain("/banners/r.png");
  });

  it("semear só com banner do meio não baixa nada", async () => {
    const m = await modulo();

    m.semearBannersDoCofre([banner("meio", { position: "home_middle" })]);

    expect(imagens).toHaveLength(0);
  });

  it("uma segunda semeadura recusada não baixa foto nenhuma", async () => {
    const m = await modulo();
    m.semearBannersDoCofre([banner("meio", { position: "home_middle" })]);

    expect(m.semearBannersDoCofre([banner("topo")])).toBe(false);

    expect(imagens).toHaveLength(0);
  });
});

describe("o Realtime renova a hora da última verdade conhecida", () => {
  it("a hora passa a ser a do aviso, não a da última gravação local", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    const m = await modulo();
    m.gravarBannersLocais([banner("a")]);
    const aoGravar = m.horaDaUltimaConsultaDeBanners();

    vi.setSystemTime(new Date("2026-11-24T15:00:30Z"));
    m.acompanharBannersDoRealtime([banner("b")]);

    expect(aoGravar).toBe(Date.parse("2026-11-24T15:00:00Z"));
    expect(m.horaDaUltimaConsultaDeBanners()).toBe(
      Date.parse("2026-11-24T15:00:30Z"),
    );
  });
});

describe("a queda da versão reduzida da foto do topo", () => {
  it("foto reduzível: se a reduzida falha, pede a original uma vez e solta o aviso", async () => {
    const m = await modulo();

    m.preCarregarFotoDoTopo([banner("topo")]);

    expect(imagens).toHaveLength(1);
    const reduzida = imagens[0] as ImagemRegistrada;
    expect(reduzida.src).toContain("/render/image/public/");
    expect(reduzida.onerror).toBeTypeOf("function");

    reduzida.onerror?.();

    expect(reduzida.onerror).toBeNull();
    expect(imagens).toHaveLength(2);
    expect(imagens[1]?.src).toBe(REDUZIVEL);
  });

  it("foto sem versão reduzida já é a original: nada a refazer em caso de erro", async () => {
    const m = await modulo();

    m.preCarregarFotoDoTopo([banner("topo", { imageUrl: SEM_REDUCAO })]);

    expect(imagens).toHaveLength(1);
    expect(imagens[0]?.src).toBe(SEM_REDUCAO);
    expect(imagens[0]?.onerror).toBeNull();
  });
});

describe("no boot, quem decide é o banner do topo que está no ar", () => {
  it("um banner do MEIO reduzível à frente não faz o topo sem redução ser baixado", async () => {
    await bootCom([
      linha("meio", { position: "home_middle", order: 0 }),
      linha("topo", { image_url: SEM_REDUCAO, order: 1 }),
    ]);

    expect(imagens).toHaveLength(0);
  });

  it("um topo VENCIDO (ainda ligado) reduzível à frente não faz o topo no ar, sem redução, ser baixado", async () => {
    await bootCom([
      linha("vencido", { end_date: VENCIDO_EM, order: 0 }),
      linha("no-ar", { image_url: SEM_REDUCAO, order: 1 }),
    ]);

    expect(imagens).toHaveLength(0);
  });

  it("um topo vencido sem redução à frente não impede o topo no ar reduzível de ser baixado", async () => {
    await bootCom([
      linha("vencido", {
        image_url: SEM_REDUCAO,
        end_date: VENCIDO_EM,
        order: 0,
      }),
      linha("no-ar", { order: 1 }),
    ]);

    expect(imagens).toHaveLength(1);
    expect(imagens[0]?.src).toContain("/banners/r.png");
  });
});
