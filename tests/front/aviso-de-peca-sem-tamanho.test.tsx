// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ids inventados (repositorio publico).
const PEDIDO = "00000000-0000-4000-8000-00000000a1b2";

const banco = vi.hoisted(() => ({
  pendentes: [] as Record<string, unknown>[],
  falharLista: null as null | { code: string; message: string },
  chamadas: [] as Array<{ nome: string; args: any }>,
  resposta: null as null | ((args: any) => { data: any; error: any }),
  segurar: null as null | Promise<void>,
  sessao: { user: { id: "lojista-1" } } as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: banco.sessao } }),
    },
    rpc: async (nome: string, args: any) => {
      banco.chamadas.push({ nome, args: structuredClone(args) });
      if (nome === "pecas_sem_tamanho_pendentes") {
        if (banco.falharLista) return { data: null, error: banco.falharLista };
        return {
          data: banco.pendentes.filter(
            (p) => !args?.p_produto_id || p.produto_id === args.p_produto_id,
          ),
          error: null,
        };
      }
      if (nome === "resolver_peca_sem_tamanho") {
        if (banco.segurar) await banco.segurar;
        const r = banco.resposta!(args);
        if (!r.error)
          banco.pendentes = banco.pendentes.filter(
            (p) => p.id !== args.p_peca_id,
          );
        return r;
      }
      throw new Error(`RPC inesperada: ${nome}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;

const P = { id: "v-p", rotulo: "P" };
const M = { id: "v-m", rotulo: "M" };

function peca(id: string, order: string | null = PEDIDO) {
  return {
    id,
    produto_id: "p-1",
    order_id: order,
    origem: "pedido_desfeito",
    criada_em: "2026-11-27T12:00:00+00:00",
  };
}

function respostaOk(args: any) {
  return {
    data: {
      id: args.p_peca_id,
      resolucao: args.p_variant_id ? "reposta" : "descartada",
      variant_id: args.p_variant_id,
      ja_resolvida: false,
      pendentes: banco.pendentes.length - 1,
    },
    error: null,
  };
}

async function montar(tamanhos = [P, M], produtoId = "p-1") {
  const { AvisoDePecaSemTamanho } = await import(
    "@/components/admin/products/AvisoDePecaSemTamanho"
  );
  await act(async () => {
    raiz.render(
      <AvisoDePecaSemTamanho produtoId={produtoId} tamanhos={tamanhos} />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const botao = (texto: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );

async function clicar(texto: string) {
  const b = botao(texto);
  expect(b, `botao "${texto}"`).toBeDefined();
  await act(async () => {
    b!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const resolucoes = () =>
  banco.chamadas.filter((c) => c.nome === "resolver_peca_sem_tamanho");

beforeEach(() => {
  // A loja tem banco configurado (o hook nem importa o cliente sem URL e chave).
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
  banco.pendentes = [];
  banco.falharLista = null;
  banco.chamadas = [];
  banco.resposta = respostaOk;
  banco.segurar = null;
  banco.sessao = { user: { id: "lojista-1" } };
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("aviso da peca que voltou sem tamanho", () => {
  it("sem peca esperando, nada aparece", async () => {
    await montar();
    expect(host.textContent).toBe("");
    expect(banco.chamadas).toEqual([
      { nome: "pecas_sem_tamanho_pendentes", args: { p_produto_id: "p-1" } },
    ]);
  });

  it("sem sessao: nem pergunta ao banco (a RPC recusaria)", async () => {
    banco.sessao = null;
    banco.pendentes = [peca("x-1")];
    await montar();
    expect(host.textContent).toBe("");
    expect(banco.chamadas).toEqual([]);
  });

  it("sem banco configurado (teste de tela sem duble): nem importa o cliente", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    banco.pendentes = [peca("x-1")];
    await montar();
    expect(host.textContent).toBe("");
    expect(banco.chamadas).toEqual([]);
  });

  it("loja sem a migration (RPC ausente): silencio, sem erro na tela nem no console", async () => {
    const erro = vi.spyOn(console, "error");
    banco.falharLista = { code: "PGRST202", message: "not found" };
    await montar();
    expect(host.textContent).toBe("");
    expect(erro).not.toHaveBeenCalled();
  });

  it("uma peca: pergunta o tamanho e so soma depois da confirmacao", async () => {
    banco.pendentes = [peca("x-1")];
    await montar();
    expect(host.textContent).toContain(
      "1 peça deste produto voltou sem tamanho (pedido #00A1B2, vendido antes de você criar os tamanhos). Ela não está à venda.",
    );
    expect(host.textContent).toContain("Em qual tamanho ela entra?");
    expect(botao("P")?.getAttribute("aria-pressed")).toBe("false");
    expect(botao("M")?.getAttribute("aria-pressed")).toBe("false");
    expect(botao("Escolha o tamanho")?.disabled).toBe(true);

    await clicar("M");
    expect(resolucoes()).toHaveLength(0);
    expect(botao("M")?.getAttribute("aria-pressed")).toBe("true");
    await clicar("Somar ao tamanho M");

    expect(resolucoes()).toEqual([
      {
        nome: "resolver_peca_sem_tamanho",
        args: { p_peca_id: "x-1", p_variant_id: "v-m" },
      },
    ]);
    expect(host.textContent).toContain(
      "Peça somada ao tamanho M. Já está à venda.",
    );
    expect(host.textContent).not.toContain("Em qual tamanho");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Peça somada ao tamanho M.",
    );
  });

  it("produto com um tamanho so: vem marcado, mas a confirmacao e' dela", async () => {
    banco.pendentes = [peca("x-1")];
    await montar([M]);
    expect(botao("M")?.getAttribute("aria-pressed")).toBe("true");
    expect(resolucoes()).toHaveLength(0);
    await clicar("Somar ao tamanho M");
    expect(resolucoes()).toHaveLength(1);
  });

  it('"Não tenho essa peça" manda NULL e nao soma em tamanho nenhum', async () => {
    banco.pendentes = [peca("x-1")];
    await montar();
    await clicar("Não tenho essa peça");
    expect(resolucoes()).toEqual([
      {
        nome: "resolver_peca_sem_tamanho",
        args: { p_peca_id: "x-1", p_variant_id: null },
      },
    ]);
    expect(host.textContent).toContain(
      "Pronto: a peça saiu do aviso e o estoque não mudou.",
    );
  });

  it("varias pecas: plural, uma de cada vez, e a escolha nao passa para a proxima", async () => {
    banco.pendentes = [peca("x-1"), peca("x-2", null)];
    await montar();
    expect(host.textContent).toContain(
      "2 peças deste produto voltaram sem tamanho (pedido #00A1B2, vendido antes de você criar os tamanhos). Elas não estão à venda.",
    );
    expect(host.textContent).toContain(
      "Em qual tamanho entra a do pedido #00A1B2?",
    );
    await clicar("P");
    await clicar("Somar ao tamanho P");
    expect(resolucoes()[0].args).toEqual({
      p_peca_id: "x-1",
      p_variant_id: "v-p",
    });
    expect(host.textContent).toContain(
      "Peça somada ao tamanho P. Já está à venda.",
    );
    expect(host.textContent).toContain(
      "1 peça deste produto voltou sem tamanho (vendida antes de você criar os tamanhos).",
    );
    expect(botao("P")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("dois toques rapidos no confirmar: uma chamada so", async () => {
    banco.pendentes = [peca("x-1")];
    let soltar!: () => void;
    banco.segurar = new Promise<void>((r) => {
      soltar = r;
    });
    await montar();
    await clicar("M");
    const confirmar = botao("Somar ao tamanho M")!;
    await act(async () => {
      confirmar.click();
      confirmar.click();
    });
    expect(confirmar.disabled).toBe(true);
    await act(async () => {
      soltar();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(resolucoes()).toHaveLength(1);
  });

  it("recusa do banco: a mensagem dela, a peca continua esperando", async () => {
    banco.pendentes = [peca("x-1")];
    banco.resposta = () => ({
      data: null,
      error: {
        code: "22023",
        message:
          "Esse tamanho está desligado. Ligue o tamanho ou escolha outro.",
      },
    });
    await montar();
    await clicar("M");
    await clicar("Somar ao tamanho M");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Esse tamanho está desligado. Ligue o tamanho ou escolha outro.",
    );
    expect(host.textContent).toContain("Em qual tamanho ela entra?");
    expect(host.textContent).not.toContain("Já está à venda");
  });

  it("ja decidida em outro aparelho: diz que nada foi somado agora", async () => {
    banco.pendentes = [peca("x-1")];
    banco.resposta = (args) => ({
      data: {
        id: args.p_peca_id,
        resolucao: "reposta",
        variant_id: "v-p",
        ja_resolvida: true,
        pendentes: 0,
      },
      error: null,
    });
    await montar();
    await clicar("M");
    await clicar("Somar ao tamanho M");
    expect(host.textContent).toContain(
      "Essa peça já tinha sido decidida em outra aba ou aparelho. Nada foi somado agora.",
    );
    expect(host.textContent).not.toContain("Peça somada ao tamanho M");
  });

  it('sem tamanho ligado: so o "Não tenho essa peça"', async () => {
    banco.pendentes = [peca("x-1")];
    await montar([]);
    // O texto diz o caminho inteiro: so o tamanho LIGADO e SALVO aparece aqui,
    // e o Salvar leva para a lista (a lojista abre o produto de novo).
    expect(host.textContent).toContain(
      "Nenhum tamanho deste produto está ligado na loja. Para a peça voltar à venda, ligue ou crie o tamanho dela em Variações, salve o produto e abra-o de novo: o tamanho aparece aqui. Se você não tem mais a peça, toque em “Não tenho essa peça”.",
    );
    expect(host.textContent).not.toContain("Ligue um tamanho para somar");
    expect(botao("Não tenho essa peça")).toBeDefined();
    expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
  });
});
