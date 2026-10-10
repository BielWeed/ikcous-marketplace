// @vitest-environment node
//
// O CATCHUP DO ADMIN LÊ A MESMA VIEW QUE A VITRINE — frente pwa, tarefa
// realtimeSyncEngine-952 (docs/superpowers/passagem/2026-09-17-super-atualizacao/frentes/pwa.json).
//
// O DEFEITO: três caminhos gravam o MESMO registro de produto no cofre com
// conjuntos de colunas diferentes — o `fetchProducts` do StoreContext lê
// `vw_produtos_admin` com `*`; o catchUp de detalhes do admin leria a TABELA
// `produtos` com uma lista de colunas escolhida a dedo (para não pedir
// `custo`, que tem SELECT negado ao `authenticated` na tabela); o Realtime
// entrega a linha crua. Como `vault.put`/`putMany` SOBRESCREVE o registro,
// cada passada de catchUp regravava o produto sem as colunas que ficaram fora
// da lista (o custo do admin sumia do cofre; qualquer coluna nova — o
// `codigo_barras` do PDV — precisaria ser lembrada na lista à mão, e o
// esquecimento é silencioso).
//
// O CONSERTO (mínimo da instrução da tarefa): o ramo ADMIN do catchUp de
// detalhes passa a ler a MESMA view do `fetchProducts` — `vw_produtos_admin`
// com `*, product_variants(*)` — e passa pelo mesmo mapper. Um esquema só: a
// coluna nova viaja sozinha, sem lista para manter.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. O resumo continua na tabela `produtos` (2 colunas, sem `.limit()` —
//      decisão do comentário no próprio motor, não mexer).
//   2. Os detalhes do admin vêm de `vw_produtos_admin` com a MESMA literal
//      de select do ramo da vitrine (`*, product_variants(*)`).
//   3. O registro gravado no cofre carrega `codigoBarras` — a prova de que
//      uma coluna nova chega sem ninguém editar lista nenhuma.
//   4. Admin e vitrine usam a MESMA literal de select (comparação direta
//      entre os dois ramos, para o "um esquema só" não divergir de novo).
//
// O dublê do supabase registra cada consulta de produto (tabela + select) e
// distingue o resumo (1ª consulta) dos lotes de detalhe pelos índices —
// mesmo molde de tests/front/realtime-catchup-fatia-os-ids.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

type ProdutoResumo = { id: string; ultima_atualizacao: string };
type ConsultaRegistrada = { tabela: string; select: string };

let resumoDoServidor: ProdutoResumo[] = [];
let chamadasDeProduto: ConsultaRegistrada[] = [];
let linhaDeDetalheExtra: Record<string, unknown> = {};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (
        tabela === "produtos" ||
        tabela === "vw_produtos_admin" ||
        tabela === "vw_produtos_public"
      ) {
        return builderDeProduto(tabela);
      }
      return builderDeOutraTabela();
    }),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })) })),
    removeChannel: vi.fn(),
  },
}));

// Contador de consultas ao productSource — 0-based; 0 é o resumo.
let consultasDeProduto = 0;

function builderDeProduto(tabela: string): any {
  const consulta: any = {};
  const ehResumo = consultasDeProduto === 0;
  if (ehResumo) consultasDeProduto += 1;

  consulta.is = vi.fn(() => consulta);
  consulta.order = vi.fn(() => consulta);
  consulta.eq = vi.fn(() => consulta);
  consulta.limit = vi.fn(() => consulta);
  consulta.in = vi.fn(() => consulta);
  consulta.select = vi.fn((colunas: string) => {
    chamadasDeProduto.push({ tabela, select: colunas });
    return consulta;
  });
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
  consulta.then = (
    onOk: (v: unknown) => unknown,
    onErro: (e: unknown) => unknown,
  ) => {
    const resposta = ehResumo
      ? Promise.resolve({ data: resumoDoServidor, error: null })
      : Promise.resolve({
          data: [
            {
              id: "produto-000",
              nome: "Produto com código",
              preco_venda: 10,
              estoque: 1,
              ativo: true,
              codigo_barras: "7891234567890",
              product_variants: [],
              ...linhaDeDetalheExtra,
            },
          ],
          error: null,
        });
    return resposta.then(onOk, onErro);
  };
  return consulta;
}

function builderDeOutraTabela(): any {
  const consulta: any = {};
  consulta.is = vi.fn(() => consulta);
  consulta.in = vi.fn(() => consulta);
  consulta.order = vi.fn(() => consulta);
  consulta.eq = vi.fn(() => consulta);
  consulta.limit = vi.fn(() => consulta);
  consulta.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
  consulta.then = (
    onOk: (v: { data: null; error: null }) => unknown,
    onErro: (e: unknown) => unknown,
  ) => Promise.resolve({ data: null, error: null }).then(onOk, onErro);
  consulta.select = vi.fn(() => consulta);
  return consulta;
}

function dubleDeCofreVazio() {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async () => []),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async (_loja?: string, _itens?: unknown[]) => {}),
    deleteById: vi.fn(),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(),
    getByIndex: vi.fn(async () => []),
  };
}

describe("catchUp — admin lê o mesmo esquema da vitrine (realtimeSyncEngine-952)", () => {
  beforeEach(() => {
    resumoDoServidor = [
      {
        id: "produto-000",
        ultima_atualizacao: "2026-09-19T00:00:00.000Z",
      },
    ];
    chamadasDeProduto = [];
    // O contador separa RESUMO de DETALHE no dublê (a 1ª consulta de produto
    // de cada rodada). Sem zerar aqui, o teste anterior deixava o contador em
    // 1 e o resumo destes testes recebia linha de detalhe — as asserções
    // seguiam valendo (resumo só usa id/ultima_atualizacao), mas o arranjo
    // mentia sobre o que cada chamada é (ressalva da revisão).
    consultasDeProduto = 0;
    linhaDeDetalheExtra = {};
  });

  it("o resumo continua na tabela produtos, com 2 colunas e sem mudança", async () => {
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    await engine.catchUp(dubleDeCofreVazio() as any, true);

    const resumo = chamadasDeProduto[0];
    expect(resumo.tabela).toBe("produtos");
    expect(resumo.select).toBe("id, ultima_atualizacao");
  });

  it("os detalhes do admin vêm de vw_produtos_admin com * e as variações", async () => {
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    await engine.catchUp(dubleDeCofreVazio() as any, true);

    const detalhes = chamadasDeProduto.slice(1);
    expect(detalhes.length).toBeGreaterThan(0);
    for (const consulta of detalhes) {
      expect(consulta.tabela).toBe("vw_produtos_admin");
      expect(consulta.select).toBe("*, product_variants(*)");
    }
  });

  it("a coluna nova do PDV (codigo_barras) chega ao cofre sem lista à mão", async () => {
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const vault = dubleDeCofreVazio();
    await engine.catchUp(vault as any, true);

    const gravados = (vault.putMany.mock.calls.at(0)?.[1] ?? []) as any[];
    expect(gravados).toHaveLength(1);
    expect(gravados[0].codigoBarras).toBe("7891234567890");
  });

  it("admin e vitrine usam a MESMA literal de select (um esquema só)", async () => {
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );

    await engine.catchUp(dubleDeCofreVazio() as any, true);
    const selectDoAdmin = chamadasDeProduto.slice(1).map((c) => c.select);

    chamadasDeProduto = [];
    consultasDeProduto = 0;
    await engine.catchUp(dubleDeCofreVazio() as any, false);
    const selectDaVitrine = chamadasDeProduto.slice(1).map((c) => c.select);

    expect(selectDoAdmin.length).toBeGreaterThan(0);
    expect(selectDoAdmin).toEqual(selectDaVitrine);
  });
});
