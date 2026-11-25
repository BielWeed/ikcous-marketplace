// @vitest-environment jsdom
//
// `useEconomiaDoFreteExibida`: o cache de módulo da cotação de EXIBIÇÃO nos
// limites que o teste de caminho feliz não fixa (relógio falso, sem espera real):
//  - validade de 10 min: com exatamente 10 min ainda serve, 1 ms depois recota;
//  - teto de 50 entradas: a 51ª cotação joga fora a MAIS ANTIGA (e só ela);
//  - a revisão mais recente vista não se perde quando uma resposta chega sem
//    `revisaoConfig`: a entrada velha continua inválida;
//  - resposta com erro NUNCA vira economia, mesmo trazendo opções junto.
// Dados inventados.
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke:
    vi.fn<
      (
        nome: string,
        opcoes: { body: { cep: string } },
      ) => Promise<{ data: unknown; error: unknown }>
    >(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  _limparCacheDeEconomiaDoFreteParaTeste,
  useEconomiaDoFreteExibida,
} from "@/hooks/useEconomiaDoFreteExibida";

const DEZ_MINUTOS_MS = 10 * 60 * 1000;
const DEBOUNCE_MS = 500;

const produto: Product = {
  id: "prod-1",
  name: "Produto de teste",
  description: "",
  price: 10,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 1 }];

type Params = Parameters<typeof useEconomiaDoFreteExibida>[0];
const params = (cepDeEntrega: string): Params => ({
  freteGratis: true,
  cepDeEntrega,
  temUsuario: true,
  originCep: "38500-000",
  localCepRange: undefined,
  localDeliveryFee: 12.9,
  freeShippingMin: 0.01,
  cart: CARRINHO,
  isOffline: false,
});
/** CEP número n, fora da cidade da loja (cota na edge). */
const cep = (n: number) => `0131${String(n).padStart(4, "0")}`;

let ultimo = -1;
function Sonda({ p }: { p: Params }) {
  const valor = useEconomiaDoFreteExibida(p);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const T0 = new Date("2026-11-20T12:00:00.000Z");

async function mostrar(cepDeEntrega: string) {
  await act(async () => {
    raiz.render(<Sonda p={params(cepDeEntrega)} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  });
}
async function desmontarSonda() {
  await act(async () => {
    raiz.render(<div />);
  });
}
const respostaDe = (preco: number, revisaoConfig?: string) => ({
  data: {
    options: [{ id: "x", name: "X", price: preco, deliveryDays: 2 }],
    ...(revisaoConfig ? { revisaoConfig } : {}),
  },
  error: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  mockInvoke.mockReset();
  _limparCacheDeEconomiaDoFreteParaTeste();
  ultimo = -1;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  _limparCacheDeEconomiaDoFreteParaTeste();
  vi.useRealTimers();
});

describe("useEconomiaDoFreteExibida — cache de módulo", () => {
  it("validade: com exatamente 10 min da gravação ainda serve; 1 ms depois recota", async () => {
    mockInvoke.mockResolvedValue(respostaDe(20));
    await mostrar(cep(1));
    expect(ultimo).toBe(20);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // A cotação foi gravada quando o debounce disparou (T0 + 500 ms).
    const gravadoEm = T0.getTime() + DEBOUNCE_MS;

    await desmontarSonda();
    vi.setSystemTime(gravadoEm + DEZ_MINUTOS_MS);
    await act(async () => {
      raiz.render(<Sonda p={params(cep(1))} />);
    });
    expect(ultimo).toBe(20);
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await desmontarSonda();
    vi.setSystemTime(gravadoEm + DEZ_MINUTOS_MS + 1);
    await act(async () => {
      raiz.render(<Sonda p={params(cep(1))} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("teto de 50 entradas: a 51ª cotação joga fora a mais antiga, e só ela", async () => {
    mockInvoke.mockImplementation((_nome, opcoes) =>
      Promise.resolve(respostaDe(Number(opcoes.body.cep.slice(-4)))),
    );
    for (let n = 1; n <= 50; n++) await mostrar(cep(n));
    expect(mockInvoke).toHaveBeenCalledTimes(50);

    await mostrar(cep(51));
    expect(mockInvoke).toHaveBeenCalledTimes(51);

    // O segundo CEP segue guardado: nenhuma chamada nova.
    await mostrar(cep(2));
    expect(ultimo).toBe(2);
    expect(mockInvoke).toHaveBeenCalledTimes(51);

    // O primeiro foi o descartado: cota de novo.
    await mostrar(cep(1));
    expect(ultimo).toBe(1);
    expect(mockInvoke).toHaveBeenCalledTimes(52);
  });

  it("resposta SEM revisaoConfig não apaga a revisão mais recente: a entrada velha continua inválida", async () => {
    mockInvoke.mockImplementation((_nome, opcoes) => {
      const c = opcoes.body.cep;
      if (c === cep(1)) return Promise.resolve(respostaDe(20, "rev-1"));
      if (c === cep(2)) return Promise.resolve(respostaDe(30, "rev-2"));
      return Promise.resolve(respostaDe(40));
    });
    await mostrar(cep(1));
    await mostrar(cep(2));
    await mostrar(cep(3));
    expect(mockInvoke).toHaveBeenCalledTimes(3);

    await mostrar(cep(1));
    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });

  it("resposta com erro NUNCA vira economia, mesmo trazendo opções junto", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        options: [{ id: "x", name: "X", price: 15, deliveryDays: 2 }],
      },
      error: new Error("falhou depois de montar a lista"),
    });
    await mostrar(cep(1));
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(ultimo).toBe(0);
  });
});
