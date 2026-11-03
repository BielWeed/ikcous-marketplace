// @vitest-environment jsdom
//
// "SAIR" APAGA DO COFRE LOCAL O RESUMO DE VENDAS DO PAINEL (caça 4, rodada 4,
// achado e4).
//
// O painel guarda no cofre (IndexedDB `ikcous-datavault`, gaveta
// `store_config`) uma cópia do resumo de vendas: linhas `admin_dashboard_stats`
// (faturamento, lucro, custo do estoque, mais vendidos) e `admin_category_data`
// (vendas por categoria). O "Sair" já esvaziava cupons e catálogo de admin, mas
// essas duas linhas ficavam legíveis no DevTools do tablet de balcão.
//
// A gaveta `store_config` guarda também o singleton PÚBLICO da loja: por isso a
// limpeza é por id (`deleteById`), nunca `clear('store_config')`.
//
// Sem fake-indexeddb no projeto: o cofre é um dublê em memória com a mesma
// interface do que o código usa (init/clear/deleteById/getById).
import { beforeEach, describe, expect, it, vi } from "vitest";

const cofre = vi.hoisted(() => {
  const gavetas = new Map<string, Map<string, unknown>>();
  const estado = {
    gavetas,
    falhaAoAbrir: false,
    /** ids cuja exclusão falha (rejeita), no formato `gaveta/id`. */
    exclusoesQueFalham: new Set<string>(),
    limparChamadas: [] as string[],
    apagarChamadas: [] as string[],
    vault: {
      clear: async (loja: string) => {
        estado.limparChamadas.push(loja);
        gavetas.set(loja, new Map());
      },
      deleteById: async (loja: string, id: string) => {
        estado.apagarChamadas.push(`${loja}/${id}`);
        if (estado.exclusoesQueFalham.has(`${loja}/${id}`)) {
          throw new Error("exclusão negada");
        }
        gavetas.get(loja)?.delete(id);
      },
      getById: async (loja: string, id: string) => gavetas.get(loja)?.get(id),
    },
  };
  return estado;
});

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn(async () => {
      if (cofre.falhaAoAbrir) throw new Error("IndexedDB indisponível");
      return cofre.vault;
    }),
  },
}));

function gravar(gaveta: string, id: string, resto: object = {}) {
  if (!cofre.gavetas.has(gaveta)) cofre.gavetas.set(gaveta, new Map());
  cofre.gavetas.get(gaveta)?.set(id, { id, ...resto });
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** O que o painel deixa no cofre numa sessão de lojista. */
function encherOCofre() {
  gravar("store_config", "admin_dashboard_stats", {
    data: { receitaDoMes: 12345.6, lucroDoMes: 4321.1 },
  });
  gravar("store_config", "admin_category_data", {
    data: [{ categoria: "Verão", total: 900 }],
  });
  gravar("store_config", "singleton", { nomeDaLoja: "Loja pública" });
  gravar("store_config", "outra_linha_publica", { x: 1 });
}

describe("esquecerCofreDeQuemSaiu — resumo de vendas do painel", () => {
  beforeEach(() => {
    cofre.gavetas.clear();
    cofre.limparChamadas.length = 0;
    cofre.apagarChamadas.length = 0;
    cofre.exclusoesQueFalham.clear();
    cofre.falhaAoAbrir = false;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("lojista que sai: as duas linhas do resumo somem; o singleton público FICA", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    encherOCofre();

    esquecerCofreDeQuemSaiu(true);
    await esperarMicrotarefas();

    expect(
      await cofre.vault.getById("store_config", "admin_dashboard_stats"),
    ).toBeUndefined();
    expect(
      await cofre.vault.getById("store_config", "admin_category_data"),
    ).toBeUndefined();
    // O que é público e dividido na mesma gaveta não pode sumir.
    expect(
      await cofre.vault.getById("store_config", "singleton"),
    ).toBeDefined();
    expect(
      await cofre.vault.getById("store_config", "outra_linha_publica"),
    ).toBeDefined();
    // Nunca esvazia a gaveta inteira.
    expect(cofre.limparChamadas).not.toContain("store_config");
  });

  it("quem saiu não era lojista (marca ausente no aparelho): as duas linhas também somem", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    encherOCofre();

    esquecerCofreDeQuemSaiu(false);
    await esperarMicrotarefas();

    expect(
      await cofre.vault.getById("store_config", "admin_dashboard_stats"),
    ).toBeUndefined();
    expect(
      await cofre.vault.getById("store_config", "admin_category_data"),
    ).toBeUndefined();
    expect(
      await cofre.vault.getById("store_config", "singleton"),
    ).toBeDefined();
    expect(cofre.limparChamadas).not.toContain("store_config");
  });

  it("as linhas nem existem (aparelho que nunca abriu o painel): nada quebra", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    gravar("store_config", "singleton", { nomeDaLoja: "Loja pública" });

    expect(() => esquecerCofreDeQuemSaiu(true)).not.toThrow();
    await esperarMicrotarefas();

    expect(
      await cofre.vault.getById("store_config", "singleton"),
    ).toBeDefined();
  });

  it("rodar duas vezes seguidas dá o mesmo resultado (idempotente)", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    encherOCofre();

    esquecerCofreDeQuemSaiu(true);
    esquecerCofreDeQuemSaiu(true);
    await esperarMicrotarefas();

    expect(
      await cofre.vault.getById("store_config", "admin_dashboard_stats"),
    ).toBeUndefined();
    expect(
      await cofre.vault.getById("store_config", "singleton"),
    ).toBeDefined();
  });

  it("uma exclusão que falha não impede a outra nem as demais gavetas, e nada lança", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    encherOCofre();
    gravar("coupons", "c1", { code: "PROMO10" });
    cofre.exclusoesQueFalham.add("store_config/admin_dashboard_stats");

    expect(() => esquecerCofreDeQuemSaiu(true)).not.toThrow();
    await esperarMicrotarefas();

    expect(cofre.apagarChamadas).toContain("store_config/admin_category_data");
    expect(
      await cofre.vault.getById("store_config", "admin_category_data"),
    ).toBeUndefined();
    expect(await cofre.vault.getById("coupons", "c1")).toBeUndefined();
  });

  it("cofre indisponível (IndexedDB negado): não lança", async () => {
    const { esquecerCofreDeQuemSaiu } = await import(
      "@/lib/cofre-de-quem-saiu"
    );
    cofre.falhaAoAbrir = true;

    expect(() => esquecerCofreDeQuemSaiu(true)).not.toThrow();
    await esperarMicrotarefas();
    expect(cofre.apagarChamadas).toEqual([]);
  });
});
