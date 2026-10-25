// @vitest-environment jsdom
//
// ENDEREÇO NOVO SÓ VIRA PRINCIPAL SOZINHO QUANDO A LISTA FOI LIDA (caça 4,
// achado A2, 24/10/2026).
//
// O primeiro endereço de uma conta vira o principal automaticamente. A regra
// olhava a lista EM MEMÓRIA: `addresses.length === 0`. Só que essa lista também
// é `[]` quando a leitura FALHOU (rede ruim, sem cópia no aparelho) ou ainda
// não terminou — e a tela de endereço deixa salvar assim. Resultado: a cliente
// que JÁ tinha uma casa cadastrada, com a lista sem carregar, cadastrava o
// trabalho sem marcar nada e o trabalho virava o principal; o gatilho do banco
// (`handle_default_address`) desmarcava a casa. O frete e o endereço
// pré-selecionado do checkout passavam a ser o errado, sem aviso.
//
// Regra nova: só força o principal quando a lista foi lida COM SUCESSO e está
// vazia (aí é de fato o primeiro). Sem leitura confirmada, vale o que a cliente
// marcou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

type Resultado = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  leituras: [] as Array<(r: { data: unknown; error: unknown }) => void>,
  insercoes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      // Leitura: a resposta é controlada pelo teste (uma por chamada).
      select: () => {
        const promessa = new Promise<Resultado>((resolve) => {
          banco.leituras.push(resolve);
        });
        const cadeia: any = Object.assign(promessa, {
          eq: () => cadeia,
          order: () => cadeia,
        });
        return cadeia;
      },
      // Gravação: devolve a linha como o banco devolveria.
      insert: (linha: Record<string, unknown>) => {
        banco.insercoes.push(linha);
        return {
          select: () => ({
            single: async () => ({
              data: { id: `novo-${banco.insercoes.length}`, ...linha },
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const ENDERECO_NOVO = {
  name: "Trabalho",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: false,
};

const CASA = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-001",
  street: "Rua Principal",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: true,
};

describe("addAddress — o primeiro endereço só vira principal com a lista lida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const telas = new Map<string, Hook>();

  function Sonda({ nome }: { readonly nome: string }) {
    // Chamada (e não atribuição) de propósito: a regra do compilador do React
    // proíbe escrever fora do componente durante a renderização.
    guardar(nome, useAddresses());
    return null;
  }
  function guardar(nome: string, hook: Hook) {
    telas.set(nome, hook);
  }
  const tela = (nome: string): Hook => {
    const hook = telas.get(nome);
    if (!hook) throw new Error(`tela '${nome}' não montada`);
    return hook;
  };

  beforeEach(() => {
    banco.leituras.length = 0;
    banco.insercoes.length = 0;
    telas.clear();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function montar(...nomes: string[]) {
    await act(async () => {
      raiz.render(
        <div>
          {nomes.map((n) => (
            <Sonda key={n} nome={n} />
          ))}
        </div>,
      );
    });
  }

  async function ler(nome: string, resultado: Resultado) {
    let leitura!: Promise<void>;
    await act(async () => {
      leitura = tela(nome).fetchAddresses();
    });
    const resolver = banco.leituras.shift();
    expect(resolver).toBeDefined();
    await act(async () => {
      resolver!(resultado);
      await leitura;
    });
  }

  async function salvar(nome: string, dados = ENDERECO_NOVO) {
    await act(async () => {
      await tela(nome).addAddress(dados);
    });
    return banco.insercoes.at(-1);
  }

  it("leitura FALHOU + lista vazia: o endereço novo vai como a cliente marcou (não principal)", async () => {
    await montar("tela");
    await ler("tela", { data: null, error: new Error("Sem rede") });
    expect(tela("tela").erroAoCarregar).toBe(true);
    expect(tela("tela").addresses).toEqual([]);

    const linha = await salvar("tela");

    // Antes do conserto isto saía `true` e o gatilho do banco desmarcava a casa.
    expect(linha?.is_default).toBe(false);
  });

  it("leitura ainda NÃO feita (nenhuma tentativa): vale o que a cliente marcou", async () => {
    await montar("tela");

    const linha = await salvar("tela");

    expect(linha?.is_default).toBe(false);
  });

  it("leitura falhou e a cliente MARCOU 'principal': respeita a marcação", async () => {
    await montar("tela");
    await ler("tela", { data: null, error: new Error("Sem rede") });

    const linha = await salvar("tela", { ...ENDERECO_NOVO, is_default: true });

    expect(linha?.is_default).toBe(true);
  });

  it("CONTROLE: leitura OK e lista de fato vazia — o primeiro endereço vira principal sozinho", async () => {
    await montar("tela");
    await ler("tela", { data: [], error: null });
    expect(tela("tela").erroAoCarregar).toBe(false);

    const linha = await salvar("tela");

    expect(linha?.is_default).toBe(true);
  });

  it("leitura falhou, depois a nova tentativa deu certo e a lista está vazia: volta a ser o primeiro", async () => {
    await montar("tela");
    await ler("tela", { data: null, error: new Error("Sem rede") });
    await ler("tela", { data: [], error: null });

    const linha = await salvar("tela");

    expect(linha?.is_default).toBe(true);
  });

  it("lista com endereços: nada é forçado (a marcação da cliente manda)", async () => {
    await montar("tela");
    await ler("tela", { data: [CASA], error: null });

    const linha = await salvar("tela");

    expect(linha?.is_default).toBe(false);
  });

  it("leitura confirmada em OUTRA tela da mesma conta (carrinho atrás do checkout) vale para esta", async () => {
    await montar("carrinho", "checkout");
    await ler("carrinho", { data: [], error: null });

    const linha = await salvar("checkout");

    expect(linha?.is_default).toBe(true);
  });
});
