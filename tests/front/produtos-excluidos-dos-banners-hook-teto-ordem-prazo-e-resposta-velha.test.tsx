// @vitest-environment jsdom
//
// `useProdutosExcluidosDosBanners` (o aviso "o produto deste banner foi excluído")
// direto no hook, nos limites que o teste da tela não alcança:
//  - a consulta leva no máximo 100 ids, ordenados (a mesma lista nunca vira duas
//    consultas) e sem repetir nem aceitar id que não parece id de produto;
//  - só conta como excluído o produto que o banco devolve com `deleted_at`;
//  - a resposta que chega no instante do prazo (15 s) já é tardia: "não sei";
//  - a resposta de uma lista ANTIGA de banners não vira aviso na lista nova.
// Ids inventados.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Linha {
  id: string;
  deleted_at: string | null;
}
interface Resposta {
  data: Linha[] | null;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  consultas: [] as string[][],
  proximas: [] as Array<() => Promise<Resposta>>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_coluna: string, ids: string[]) => {
          banco.consultas.push(ids);
          const proxima = banco.proximas.shift();
          return proxima
            ? proxima()
            : Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { useProdutosExcluidosDosBanners } from "@/hooks/useProdutosExcluidosDosBanners";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: ReadonlySet<string>;

function Sonda({ ids, ativo }: { ids: readonly string[]; ativo: boolean }) {
  const valor = useProdutosExcluidosDosBanners(ids, ativo);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}
async function renderizar(ids: readonly string[], ativo = true) {
  await act(async () => {
    raiz.render(<Sonda ids={ids} ativo={ativo} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const excluidos = () => [...ultimo].sort();

beforeEach(() => {
  vi.useFakeTimers();
  banco.consultas = [];
  banco.proximas = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useProdutosExcluidosDosBanners — limites", () => {
  it("130 ids fora de ordem e repetidos: a consulta leva só os 100 menores, ordenados, sem repetição", async () => {
    const ids: string[] = [];
    for (let n = 130; n >= 1; n--) ids.push(uuid(n));
    ids.push(uuid(5), uuid(77), "nao-e-id-de-produto");
    await renderizar(ids);
    expect(banco.consultas).toHaveLength(1);
    const esperado = Array.from({ length: 100 }, (_, i) => uuid(i + 1));
    expect(banco.consultas[0]).toEqual(esperado);
  });

  it("só conta como excluído quem o banco devolve com deleted_at; ausente da resposta é 'não sei'", async () => {
    banco.proximas.push(() =>
      Promise.resolve({
        data: [
          { id: uuid(1), deleted_at: "2026-11-01T10:00:00Z" },
          { id: uuid(2), deleted_at: null },
        ],
        error: null,
      }),
    );
    await renderizar([uuid(1), uuid(2), uuid(3)]);
    expect(excluidos()).toEqual([uuid(1)]);
  });

  it("resposta com erro, mesmo trazendo dados, não vira aviso", async () => {
    banco.proximas.push(() =>
      Promise.resolve({
        data: [{ id: uuid(1), deleted_at: "2026-11-01T10:00:00Z" }],
        error: { code: "42501" },
      }),
    );
    await renderizar([uuid(1)]);
    expect(excluidos()).toEqual([]);
  });

  it("tela inativa ou sem ids: não consulta", async () => {
    await renderizar([uuid(1)], false);
    await renderizar([]);
    expect(banco.consultas).toEqual([]);
  });

  it("resposta aos 14,999 s ainda vale; a que chega exatamente aos 15 s já é tardia", async () => {
    banco.proximas.push(
      () =>
        new Promise<Resposta>((resolver) => {
          setTimeout(
            () =>
              resolver({
                data: [{ id: uuid(1), deleted_at: "2026-11-01T10:00:00Z" }],
                error: null,
              }),
            14_999,
          );
        }),
    );
    await renderizar([uuid(1)]);
    await passar(14_999);
    expect(excluidos()).toEqual([uuid(1)]);
  });

  it("exatamente aos 15 s o prazo vence a resposta: sem aviso", async () => {
    banco.proximas.push(
      () =>
        new Promise<Resposta>((resolver) => {
          setTimeout(
            () =>
              resolver({
                data: [{ id: uuid(1), deleted_at: "2026-11-01T10:00:00Z" }],
                error: null,
              }),
            15_000,
          );
        }),
    );
    await renderizar([uuid(1)]);
    await passar(15_000);
    expect(excluidos()).toEqual([]);
  });

  it("a resposta da lista ANTIGA de banners, chegando depois, não vira aviso na lista nova", async () => {
    let entregarVelha!: (r: Resposta) => void;
    banco.proximas.push(
      () =>
        new Promise<Resposta>((resolver) => {
          entregarVelha = resolver;
        }),
      () =>
        Promise.resolve({
          data: [{ id: uuid(2), deleted_at: "2026-11-02T10:00:00Z" }],
          error: null,
        }),
    );
    await renderizar([uuid(1)]);
    await renderizar([uuid(2)]);
    expect(excluidos()).toEqual([uuid(2)]);

    await act(async () => {
      entregarVelha({
        data: [{ id: uuid(1), deleted_at: "2026-11-01T10:00:00Z" }],
        error: null,
      });
      await Promise.resolve();
    });
    expect(excluidos()).toEqual([uuid(2)]);
  });
});
