// @vitest-environment jsdom
import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
import { type ContextType, act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Erro = { message: string } | null;
type Leitura = { usuario: string; concluir: () => void };
type Gravacao = { concluir: (erro?: Erro) => void };
const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-a" },
  linhas: new Set<string>(),
  leituras: [] as Leitura[],
  gravacoes: [] as Gravacao[],
  ouvintes: new Set<(evento: MessageEvent) => void>(),
}));
const produtos = [
  { id: "caneca", name: "Caneca azul", price: 19, images: [] },
  { id: "jarra", name: "Jarra verde", price: 32, images: [] },
] as unknown as Product[];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites")
        throw new Error(`Tabela inesperada: ${tabela}`);
      const gravar = (usuario: string, produto: string, remover: boolean) =>
        new Promise<{ error: Erro }>((resolve) => {
          mundo.gravacoes.push({
            concluir: (erro = null) => {
              if (!erro) {
                const chave = `${usuario}|${produto}`;
                if (remover) mundo.linhas.delete(chave);
                else mundo.linhas.add(chave);
              }
              resolve({ error: erro });
            },
          });
        });
      return {
        select: () => ({
          eq: (_coluna: string, usuario: string) => {
            // Congela na PARTIDA: ler o Set só ao concluir esconderia a corrida.
            const retrato = Array.from(mundo.linhas)
              .filter((chave) => chave.startsWith(`${usuario}|`))
              .map((chave) => ({ product_id: chave.split("|")[1] }));
            return new Promise((resolve) => {
              mundo.leituras.push({
                usuario,
                concluir: () => resolve({ data: retrato, error: null }),
              });
            });
          },
        }),
        upsert: ({
          user_id,
          product_id,
        }: { user_id: string; product_id: string }) =>
          gravar(user_id, product_id, false),
        delete: () => ({
          eq: (_coluna: string, usuario: string) => ({
            eq: (_campo: string, produto: string) =>
              gravar(usuario, produto, true),
          }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observar = vi.fn();
function Sonda() {
  const contexto = useContext(FavoritesContext);
  useEffect(() => {
    observar(contexto);
  });
  return (
    <>
      <button
        type="button"
        aria-label="Favoritar caneca"
        aria-pressed={contexto?.isFavorite("caneca") ?? false}
        onClick={() => contexto?.toggleFavorite(produtos[0])}
      >
        Coração
      </button>
      <ul aria-label="Favoritos">
        {contexto?.favorites.map((produto) => (
          <li key={produto.id}>{produto.name}</li>
        ))}
      </ul>
    </>
  );
}
const atual = () =>
  observar.mock.calls.at(-1)?.[0] as NonNullable<
    ContextType<typeof FavoritesContext>
  >;
let raiz: Root;
let hospedeiro: HTMLDivElement;

async function renderizar() {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
}
async function responderLeitura(indice: number) {
  const leitura = mundo.leituras.at(indice);
  if (!leitura) throw new Error(`Leitura ${indice} não começou`);
  await act(async () => leitura.concluir());
}
async function concluirGravacao(indice: number, erro: Erro = null) {
  const gravacao = mundo.gravacoes.at(indice);
  if (!gravacao) throw new Error(`Gravação ${indice} não começou`);
  await act(async () => gravacao.concluir(erro));
}
async function notificarOutraAba() {
  await act(async () => {
    for (const ouvinte of mundo.ouvintes) {
      ouvinte(
        new MessageEvent("message", { data: { type: "favorites_update" } }),
      );
    }
  });
}
async function tocarCoracao() {
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
}
function conferirCaneca(marcada: boolean) {
  expect(hospedeiro.querySelector("button")?.getAttribute("aria-pressed")).toBe(
    String(marcada),
  );
  expect(atual().isFavorite("caneca")).toBe(marcada);
  expect(atual().favorites.some((produto) => produto.id === "caneca")).toBe(
    marcada,
  );
  expect(
    hospedeiro.querySelector("ul")?.textContent?.includes("Caneca azul"),
  ).toBe(marcada);
}

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "conta-a" };
  mundo.linhas.clear();
  mundo.leituras.length = 0;
  mundo.gravacoes.length = 0;
  mundo.ouvintes.clear();
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      valores.set(chave, valor);
    },
    removeItem: (chave: string) => {
      valores.delete(chave);
    },
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener(_tipo: string, ouvinte: (evento: MessageEvent) => void) {
        mundo.ouvintes.add(ouvinte);
      }
      removeEventListener(
        _tipo: string,
        ouvinte: (evento: MessageEvent) => void,
      ) {
        mundo.ouvintes.delete(ouvinte);
      }
      close() {}
    },
  );
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  Reflect.deleteProperty(navigator, "onLine");
  vi.unstubAllGlobals();
});

describe("Favoritos — leitura atrasada não desfaz o toque", () => {
  it.each([false, true])(
    "preserva adicionar/remover confirmado quando o retrato anterior chega depois (já marcado: %s)",
    async (jaMarcada) => {
      if (jaMarcada) mundo.linhas.add("conta-a|caneca");
      await renderizar();
      await responderLeitura(0);
      conferirCaneca(jaMarcada);
      await notificarOutraAba(); // A consulta automática guarda o retrato anterior ao toque.
      await tocarCoracao();
      await concluirGravacao(0);
      expect(toast.success).toHaveBeenCalledWith(
        jaMarcada ? "Removido dos favoritos" : "Adicionado aos favoritos",
      );
      await responderLeitura(1);
      conferirCaneca(!jaMarcada);
      await responderLeitura(2);
      conferirCaneca(!jaMarcada);
      expect(mundo.leituras).toHaveLength(3); // Uma reconsulta, sem ciclo.
    },
  );

  it("espera todas as gravações e reconsulta uma vez para revelar mudança de outra aba", async () => {
    await renderizar();
    await responderLeitura(0);
    await notificarOutraAba();
    await tocarCoracao();
    // Outro produto também está sendo gravado; terminar só um não basta.
    await act(async () => atual().toggleFavorite(produtos[1]));
    await responderLeitura(1);
    conferirCaneca(true);
    expect(mundo.leituras).toHaveLength(2);
    await concluirGravacao(0);
    expect(mundo.leituras).toHaveLength(2);
    // Outra aba retirou a caneca enquanto a gravação da jarra ainda estava em voo.
    mundo.linhas.delete("conta-a|caneca");
    await concluirGravacao(1);
    await responderLeitura(2);
    conferirCaneca(false);
    expect(atual().favorites.map((produto) => produto.id)).toEqual(["jarra"]);
    expect(mundo.leituras).toHaveLength(3);
  });

  it.each([false, true])(
    "descarta também leitura que começou durante a gravação (responde após terminar: %s)",
    async (respondeDepois) => {
      await renderizar();
      await responderLeitura(0);
      await tocarCoracao();
      await notificarOutraAba();
      if (respondeDepois) await concluirGravacao(0);
      await responderLeitura(1);
      conferirCaneca(true);
      if (!respondeDepois) {
        expect(mundo.leituras).toHaveLength(2);
        await concluirGravacao(0);
      }
      await responderLeitura(2);
      conferirCaneca(true);
      expect(mundo.leituras).toHaveLength(3);
    },
  );

  it("aplica normalmente uma leitura lenta quando não houve gravação", async () => {
    await renderizar();
    await responderLeitura(0);
    mundo.linhas.add("conta-a|caneca");
    await notificarOutraAba();
    conferirCaneca(false);
    await responderLeitura(1);
    conferirCaneca(true);
    expect(mundo.leituras).toHaveLength(2);
  });

  it("a leitura de A não vaza para B nem provoca reconsulta em nome de A", async () => {
    mundo.linhas.add("conta-a|caneca");
    await renderizar(); // Leitura de A fica presa.
    mundo.usuario = { id: "conta-b" };
    mundo.linhas.add("conta-b|jarra");
    await renderizar();
    await responderLeitura(1);
    await responderLeitura(0);
    conferirCaneca(false);
    expect(atual().favorites.map((produto) => produto.id)).toEqual(["jarra"]);
    expect(mundo.leituras.map((leitura) => leitura.usuario)).toEqual([
      "conta-a",
      "conta-b",
    ]);
  });

  it("terminar uma gravação antiga de A não invalida a leitura lenta de B", async () => {
    await renderizar();
    await responderLeitura(0);
    await tocarCoracao();
    await notificarOutraAba();
    await responderLeitura(1); // Reconsulta de A adiada até a gravação terminar.
    mundo.usuario = { id: "conta-b" };
    mundo.linhas.add("conta-b|jarra");
    await renderizar();
    await concluirGravacao(0);
    await responderLeitura(2);
    conferirCaneca(false);
    expect(atual().favorites.map((produto) => produto.id)).toEqual(["jarra"]);
    expect(mundo.leituras).toHaveLength(3);
  });

  it("leituras substituídas não provocam reconsultas extras ao chegar por último", async () => {
    await renderizar();
    await responderLeitura(0);
    await notificarOutraAba();
    await notificarOutraAba();
    await tocarCoracao();
    await concluirGravacao(0);
    await responderLeitura(2);
    await responderLeitura(3);
    await responderLeitura(1);
    conferirCaneca(true);
    expect(mundo.leituras).toHaveLength(4);
  });

  it("sem leitura descartada, a gravação mantém o caminho feliz sem reconsulta", async () => {
    await renderizar();
    await responderLeitura(0);
    await tocarCoracao();
    await concluirGravacao(0);
    conferirCaneca(true);
    expect(mundo.leituras).toHaveLength(1);
  });

  it("a reconsulta após falha preserva o rollback e revela o favorito de outra aba", async () => {
    await renderizar();
    await responderLeitura(0);
    await notificarOutraAba();
    await tocarCoracao();
    await responderLeitura(1);
    mundo.linhas.add("conta-a|jarra");
    const erroEsperado = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      await concluirGravacao(0, { message: "Falha simulada de rede" });
      conferirCaneca(false);
      expect(toast.error).toHaveBeenCalledWith("Erro ao salvar favorito");
      await responderLeitura(2);
      expect(atual().favorites.map((produto) => produto.id)).toEqual(["jarra"]);
    } finally {
      erroEsperado.mockRestore();
    }
  });
});
