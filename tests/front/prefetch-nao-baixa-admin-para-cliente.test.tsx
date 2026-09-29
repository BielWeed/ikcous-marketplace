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
import { describe, expect, it } from "vitest";

import { chavesParaPrefetchAll } from "@/hooks/usePrefetchOnHover";

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
