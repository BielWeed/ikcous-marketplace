// @vitest-environment jsdom
// App-2114 — prefetchAll baixava os 32 chunks de view (18 do admin, 1,23 MB
// de fonte TSX + recharts do dashboard) para TODO visitante 800ms após o
// boot, mesmo sem ser lojista. O comentário em App.tsx ("Prefetching of
// admin views is handled internally within the secure AdminArea.tsx
// bundle") já prometia isso — só não era verdade: o único freio no caminho
// era isSlow() (rede lenta), que não distingue cliente de admin.
//
// `chavesParaPrefetchAll` é a mesma extração-em-função-pura que `redeLenta`
// fez para o guard de rede (ver tests/front/rede-lenta.test.ts): torna a
// regra de filtro testável sem precisar disparar os 27 import() reais do
// mapa. O prefetch por hover/touch dentro do AdminLayout (handleHoverTab)
// continua intacto — esta função só decide o que entra no prefetch em
// massa do boot.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import fonteApp from "@/App.tsx?raw";
import {
  chavesParaPrefetchAll,
  usePrefetchOnHover,
} from "@/hooks/usePrefetchOnHover";
import fontePrefetch from "@/hooks/usePrefetchOnHover.ts?raw";

vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => false }),
}));

// Sem exportar instrumentação em produção: lê as entradas reais do mapa e
// substitui apenas os módulos pesados. Quem decide quais fábricas chamar é
// o hook real, com a rede rápida e o idle controlados.
const fonteMapa =
  fontePrefetch.split("const VIEW_PREFETCH_MAP:")[1]?.split("\n};")[0] ?? "";
const entradas = [
  ...fonteMapa.matchAll(
    /(?:^|\n)\s*(?:"([^"]+)"|([\w-]+)):\s*\(\)\s*=>\s*import\("([^"]+)"\)/g,
  ),
].map((m) => ({ chave: m[1] ?? m[2], modulo: m[3] }));

describe("chavesParaPrefetchAll — App-2114", () => {
  it("visitante comum (isAdmin=false) não recebe nenhuma chave admin-*", () => {
    const chaves = [
      "home",
      "cart",
      "product-detail",
      "admin",
      "admin-dashboard",
      "admin-product-form",
    ];

    const resultado = chavesParaPrefetchAll(chaves, false);

    expect(resultado).toEqual(["home", "cart", "product-detail"]);
    expect(resultado.some((chave) => chave.startsWith("admin"))).toBe(false);
  });

  it("lojista confirmado (isAdmin=true) recebe o mapa inteiro, sem perder nenhuma view de cliente", () => {
    const chaves = ["home", "cart", "admin", "admin-dashboard"];

    const resultado = chavesParaPrefetchAll(chaves, true);

    expect(resultado).toEqual(chaves);
  });

  it("sem nenhuma chave admin-* no mapa, o filtro é um no-op (não derruba view de cliente por engano)", () => {
    const chaves = ["home", "cart", "product-detail"];

    expect(chavesParaPrefetchAll(chaves, false)).toEqual(chaves);
  });

  it("lista vazia não quebra em nenhum dos dois modos", () => {
    expect(chavesParaPrefetchAll([], false)).toEqual([]);
    expect(chavesParaPrefetchAll([], true)).toEqual([]);
  });
});

describe("a proteção está ligada ao mapa e ao boot reais", () => {
  it("toda fábrica do mapa foi lida e toda tela do painel tem chave protegida", () => {
    expect(entradas.length).toBeGreaterThan(20);
    expect(entradas.length).toBe([...fonteMapa.matchAll(/import\(/g)].length);
    const painel = entradas.filter(({ modulo }) =>
      modulo.includes("/views/admin/"),
    );
    expect(painel.length).toBeGreaterThan(10);
    for (const { chave } of painel) {
      expect(chave, "o filtro não protege apelidos como pdv").toMatch(/^admin/);
    }
  });

  it("App passa o papel atual ao prefetch, não autoriza todo visitante", () => {
    // Âncora da ligação, não uma montagem artificial do App: os imports das
    // views são exercitados pelo hook real no caso abaixo.
    expect(/prefetchAll\(isAdminRef\.current\)/.test(fonteApp)).toBe(true);
    expect(/isAdminRef\.current\s*=\s*isAdmin/.test(fonteApp)).toBe(true);
    expect(/prefetchAll\(true\)/.test(fonteApp)).toBe(false);
  });

  it("hook real: sem argumento só aquece cliente; true também aquece painel", async () => {
    const carregados = new Set<string>();
    const fila: IdleRequestCallback[] = [];
    const modulos = [...new Set(entradas.map(({ modulo }) => modulo))];
    for (const modulo of modulos) {
      vi.doMock(modulo, () => {
        carregados.add(modulo);
        return { default: () => null };
      });
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      fila.push(callback);
      return fila.length;
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    let prefetchAll: ((isAdmin?: boolean) => void) | undefined;
    function Alvo() {
      const hook = usePrefetchOnHover();
      useEffect(() => {
        prefetchAll = hook.prefetchAll;
      });
      return null;
    }
    const executarIdle = () => {
      for (const callback of fila.splice(0)) {
        callback({ didTimeout: false, timeRemaining: () => 50 });
      }
    };
    try {
      await act(async () => root.render(<Alvo />));
      expect(prefetchAll).toBeTypeOf("function");
      prefetchAll!();
      executarIdle();
      const publicos = modulos.filter(
        (modulo) => !modulo.includes("/views/admin/"),
      );
      await vi.dynamicImportSettled();
      expect([...carregados].sort()).toEqual(publicos.sort());
      expect(
        [...carregados].some((modulo) => modulo.includes("/views/admin/")),
      ).toBe(false);

      prefetchAll!(true);
      executarIdle();
      await vi.dynamicImportSettled();
      expect([...carregados].sort()).toEqual(modulos.sort());
      expect(carregados.has("@/views/admin/AdminPdvView")).toBe(true);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      for (const modulo of modulos) vi.doUnmock(modulo);
    }
  });
});
