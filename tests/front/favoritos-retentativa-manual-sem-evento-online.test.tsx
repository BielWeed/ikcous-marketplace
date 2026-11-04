// @vitest-environment jsdom
//
// A retentativa da fila de favoritos não pode depender só do evento `online`.
// Falha do servidor com a rede de pé nunca dispara `online`, e o aviso do
// login promete "tentar de novo". O contexto expõe `retentarPendentes` (o
// mesmo caminho do `online`) para a tela de Favoritos oferecer "Tentar agora".
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";
const pendingKeyDe = (userId: string) => `ikcous_favorites_pendentes:${userId}`;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] as Product[], loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

let servidorFalha = true;
let chamadasUpsert: { user_id: string; product_id: string }[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          return Promise.resolve(
            servidorFalha
              ? { data: null, error: { message: "500" } }
              : { data: [{}], error: null },
          );
        },
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// testes irmãos de FavoritesContext.
function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

interface Contexto {
  pendingCount: number;
  retentarPendentes: () => Promise<void>;
}
let ultimoContexto: Contexto | null = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  servidorFalha = true;
  chamadasUpsert = [];
  usuarioDaVez = null;
  ultimoContexto = null;
  storageFake = criarStorageFake();
  vi.stubGlobal("localStorage", storageFake);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("FavoritesContext — retentativa manual da fila (sem evento online)", () => {
  it("login com o servidor falhando deixa pendingCount; retentarPendentes() grava de novo e zera a fila", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1"]));
    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );
    const montar = () =>
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );

    await act(async () => {
      montar();
    });
    await flush();

    usuarioDaVez = { id: "userA" };
    await act(async () => {
      montar();
    });
    await flush();

    expect(ultimoContexto?.pendingCount).toBe(1);
    expect(chamadasUpsert).toHaveLength(1);

    // O servidor volta SEM nenhum evento `online`.
    servidorFalha = false;
    await act(async () => {
      await ultimoContexto?.retentarPendentes();
    });
    await flush();

    expect(chamadasUpsert).toHaveLength(2);
    expect(chamadasUpsert[1]).toEqual({ user_id: "userA", product_id: "p1" });
    expect(ultimoContexto?.pendingCount).toBe(0);
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toHaveLength(0);
  });
});
