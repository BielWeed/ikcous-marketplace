// @vitest-environment jsdom
// A foto que o app baixa ANTES da Home montar era a do primeiro banner "ligado",
// sem olhar o período programado. Banner agendado para começar depois (ou já
// vencido, mas ainda ligado) gastava a banda da primeira visita enquanto a
// vitrine mostrava outro. Agora só vale o que `estaNoAr` aceita, a mesma regra
// do carrossel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const baixadas: string[] = [];

class ImagemFalsa {
  sizes = "";
  srcset = "";
  onerror: (() => void) | null = null;
  set src(valor: string) {
    baixadas.push(valor);
  }
}

function banner(id: string, extra: Partial<Banner>): Banner {
  return {
    id,
    imageUrl: `https://exemplo.test/${id}.jpg`,
    title: null,
    position: "home_top",
    active: true,
    order: 0,
    ...extra,
  };
}

describe("foto antecipada do banner do topo", () => {
  beforeEach(() => {
    baixadas.length = 0;
    vi.stubGlobal("Image", ImagemFalsa);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pula o banner que só começa depois e baixa o que está no ar", async () => {
    const { preCarregarFotoDoTopo } = await import("@/lib/banners-da-vitrine");
    preCarregarFotoDoTopo([
      banner("black", { startDate: "2026-11-29T03:00:00Z", order: 0 }),
      banner("normal", { order: 1 }),
    ]);
    expect(baixadas.some((u) => u.includes("normal"))).toBe(true);
    expect(baixadas.some((u) => u.includes("black"))).toBe(false);
  });

  it("pula o banner já vencido, mesmo ainda ligado", async () => {
    const { preCarregarFotoDoTopo } = await import("@/lib/banners-da-vitrine");
    preCarregarFotoDoTopo([
      banner("velho", { endDate: "2026-11-20T02:59:59Z", order: 0 }),
      banner("normal", { order: 1 }),
    ]);
    expect(baixadas.some((u) => u.includes("normal"))).toBe(true);
    expect(baixadas.some((u) => u.includes("velho"))).toBe(false);
  });

  it("banner dentro do período continua sendo o antecipado", async () => {
    const { preCarregarFotoDoTopo } = await import("@/lib/banners-da-vitrine");
    preCarregarFotoDoTopo([
      banner("black", {
        startDate: "2026-11-20T03:00:00Z",
        endDate: "2026-11-30T02:59:59Z",
      }),
    ]);
    expect(baixadas.some((u) => u.includes("black"))).toBe(true);
  });
});
