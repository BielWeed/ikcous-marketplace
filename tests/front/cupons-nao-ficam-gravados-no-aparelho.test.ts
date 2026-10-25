// @vitest-environment jsdom
//
// OS CUPONS DA LOJA NÃO FICAM GRAVADOS NO APARELHO (caça 4, achado A1, 24/10/2026).
//
// O motor de sincronização gravava, para a sessão de LOJISTA, a lista inteira
// de cupons (código, valor, limite de uso) na gaveta `coupons` do IndexedDB
// `ikcous-datavault`. Nada no app LÊ essa gaveta (a tela de Cupons usa o
// próprio hook e o cache em memória): era escrita morta, e num tablet de
// balcão compartilhado qualquer pessoa com o DevTools aberto lia todos os
// códigos ativos, mesmo depois do "Sair".
//
// Conserto: o motor não busca nem grava cupons, e não os assina no tempo real.
//
// Molde do dublê: tests/front/catchup-avisa-a-tela-quando-apaga-produto.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const tabelasConsultadas: string[] = [];

vi.mock("@/lib/supabase", () => {
  const builder: any = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    is: () => builder,
    in: () => builder,
    single: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase, ver tests/front/catchup-avisa-a-tela-quando-apaga-produto.test.ts
    then(resolve: any, reject: any) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return {
    supabase: {
      from(tabela: string) {
        tabelasConsultadas.push(tabela);
        return builder;
      },
    },
  };
});

const { RealtimeSyncEngine, TABLE_CONFIGS } = await import(
  "@/lib/realtimeSyncEngine"
);

function criarDubleVault() {
  return {
    put: vi.fn(async (_store: string, _registro: unknown) => undefined),
    putMany: vi.fn(async (_store: string, _itens: unknown[]) => undefined),
    replaceAll: vi.fn(async (_store: string, _itens: unknown[]) => undefined),
    deleteById: vi.fn(async (_store: string, _id: string) => undefined),
    setLastSync: vi.fn(async (_store: string) => undefined),
    getById: vi.fn(async () => undefined),
    getByIndex: vi.fn(async () => []),
    getAll: vi.fn(async () => []),
    getAllOrThrow: vi.fn(async () => []),
  };
}

describe("cupons da loja não ficam gravados no aparelho", () => {
  beforeEach(() => {
    tabelasConsultadas.length = 0;
  });

  it("catchUp da sessão de lojista não grava nem marca a gaveta de cupons", async () => {
    const vault = criarDubleVault();

    await RealtimeSyncEngine.catchUp(vault as any, true);

    const gavetasGravadas = [
      ...vault.replaceAll.mock.calls.map(([s]) => s),
      ...vault.putMany.mock.calls.map(([s]) => s),
      ...vault.put.mock.calls.map(([s]) => s),
      ...vault.setLastSync.mock.calls.map(([s]) => s),
    ];
    // Controle: o catchUp rodou e gravou as outras gavetas -- sem isto, "não
    // gravou cupons" passaria também com um catchUp que nem saiu do lugar.
    expect(gavetasGravadas).toContain("categories");
    expect(gavetasGravadas).toContain("banners");
    expect(gavetasGravadas).not.toContain("coupons");
  });

  it("catchUp da sessão de lojista nem busca a tabela de cupons", async () => {
    const vault = criarDubleVault();

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(tabelasConsultadas).toContain("categorias");
    expect(tabelasConsultadas).not.toContain("coupons");
  });

  it("o tempo real não assina a tabela de cupons (não há como gravar a gaveta)", () => {
    expect(TABLE_CONFIGS.map((c) => c.table)).not.toContain("coupons");
    expect(TABLE_CONFIGS.map((c) => c.store)).not.toContain("coupons");
  });
});
