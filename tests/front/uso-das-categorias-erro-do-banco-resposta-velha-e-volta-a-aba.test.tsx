// @vitest-environment jsdom
//
// `useUsoDasCategorias` (a contagem de produtos/banners por categoria) nos
// limites que o caminho feliz não mostra:
//  - a primeira pintura já nasce "carregando" (nunca "lista vazia" por um instante);
//  - erro do banco vence, mesmo se vier junto uma lista: a tela não habilita
//    "Apagar" por uma contagem que o banco recusou;
//  - o erro de uma leitura VELHA não sobrescreve a lista da leitura nova;
//  - voltar à aba relê; ir para o fundo não relê.
// Dados inventados.
import { useUsoDasCategorias } from "@/hooks/useUsoDasCategorias";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  chamadas: 0,
  proximas: [] as Array<() => Promise<Resposta>>,
  padrao: { data: [], error: null } as Resposta,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome !== "categorias_com_uso")
        throw new Error(`rpc inesperada ${nome}`);
      banco.chamadas += 1;
      const proxima = banco.proximas.shift();
      return proxima ? proxima() : Promise.resolve(banco.padrao);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Visto = ReturnType<typeof useUsoDasCategorias>;

const linha = (id: string, nome: string) => ({
  id,
  nome,
  slug: nome.toLowerCase(),
  ativo: true,
  produtos: 3,
  produtos_excluidos: 0,
  banners: 1,
  regra_devolucao: 0,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: Visto;
let renders: Array<{ carregando: boolean; usos: Visto["usos"] }>;
let visibilidade: "visible" | "hidden";

function Sonda() {
  const valor = useUsoDasCategorias();
  renders.push({ carregando: valor.carregando, usos: valor.usos });
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}

function adiada() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

async function montar() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
}
async function mudarVisibilidade(para: "visible" | "hidden") {
  visibilidade = para;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  banco.chamadas = 0;
  banco.proximas = [];
  banco.padrao = { data: [], error: null };
  renders = [];
  visibilidade = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibilidade,
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

describe("useUsoDasCategorias — limites", () => {
  it("a primeira pintura já é 'carregando', sem lista", async () => {
    banco.proximas.push(() => new Promise<Resposta>(() => {}));
    await montar();
    expect(renders[0]).toEqual({ carregando: true, usos: null });
  });

  it("erro do banco vence mesmo com lista junto: sem usos e com a frase do erro", async () => {
    banco.padrao = {
      data: [linha("c1", "Blusas")],
      error: { code: "42501", message: "permission denied" },
    };
    await montar();
    expect(ultimo.usos).toBeNull();
    expect(ultimo.erro).toBe(
      "Só quem administra a loja pode mudar as categorias. Entre de novo e tente outra vez.",
    );
    expect(ultimo.carregando).toBe(false);
  });

  it("o ERRO de uma leitura velha, chegando depois, não derruba a lista da leitura nova", async () => {
    const velha = adiada();
    banco.proximas.push(() => velha.promessa);
    banco.padrao = { data: [linha("c2", "Saias")], error: null };
    await montar();
    await act(async () => {
      await ultimo.recarregar();
    });
    expect(ultimo.usos?.map((u) => u.nome)).toEqual(["Saias"]);
    expect(ultimo.erro).toBeNull();

    await act(async () => {
      velha.resolver({ data: null, error: { code: "42501" } });
      await velha.promessa;
    });
    expect(ultimo.usos?.map((u) => u.nome)).toEqual(["Saias"]);
    expect(ultimo.erro).toBeNull();
    expect(ultimo.carregando).toBe(false);
  });

  it("voltar para a aba relê; ir para o fundo não relê", async () => {
    await montar();
    expect(banco.chamadas).toBe(1);
    await mudarVisibilidade("hidden");
    expect(banco.chamadas).toBe(1);
    await mudarVisibilidade("visible");
    expect(banco.chamadas).toBe(2);
  });

  it("depois de fechar a tela, a resposta que chega não escreve nada", async () => {
    const tardia = adiada();
    banco.proximas.push(() => tardia.promessa);
    await montar();
    await act(async () => raiz.unmount());
    const antes = renders.length;
    await act(async () => {
      tardia.resolver({ data: [linha("c3", "Meias")], error: null });
      await tardia.promessa;
    });
    expect(renders.length).toBe(antes);
    raiz = createRoot(hospedeiro);
  });
});
