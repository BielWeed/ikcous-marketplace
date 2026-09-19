// @vitest-environment jsdom
//
// O CATCHUP DE DETALHES FATIA OS IDS — frente pwa, tarefa
// realtimeSyncEngine-955.
//
// O DEFEITO: `outOfDateIds` nasce do resumo de TODOS os produtos do servidor
// (deliberadamente sem `.limit()` — limite causaria falso-sync) e virava UM
// único GET `.in("id", ...)`. Cada UUID custa ~37 caracteres na query string:
// uma loja com algumas centenas de produtos e cofre vazio (primeiro boot,
// purge de versão) estoura o limite de linha do gateway (~8 KB), a resposta
// vem 414/431 e a falha morria no console — o cofre nunca recebia nada pelo
// catchUp, sem aviso na tela.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. Muitos ids viram vários lotes de ≤100, e os resultados são
//      CONCATENADOS (o cofre recebe o catálogo inteiro, lote a lote).
//   2. Um lote que falha NÃO descarta os outros: os que chegaram são
//      gravados (registrar e seguir) — a próxima rodada tenta os que
//      faltaram, e o que entrou é marcado com setLastSync.
//   3. Catálogo pequeno continua custando UMA chamada de detalhe (nenhuma
//      regressão de latência para a loja normal).
//
// O dublê do supabase distingue as idas por ORDEM: a 1ª chamada a
// `from(productSource)` é o RESUMO (devolve `resumoDoServidor`); as
// seguintes são lotes de detalhe — o lote é o array capturado no
// `.in("id", [...])`.
import { beforeEach, describe, expect, it, vi } from "vitest";

type ProdutoResumo = { id: string; ultima_atualizacao: string };

let resumoDoServidor: ProdutoResumo[] = [];
let lotesRecebidos: string[][] = [];
// Índices (0-based) de lote de detalhe que falham — para provar que erro em
// um lote não soma com os outros.
let lotesQueFalham: number[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (tabela === "produtos" || tabela === "vw_produtos_public") {
        // from() é chamado uma vez por consulta; a 1ª é o resumo.
        return builderDeProduto();
      }
      return builderDeOutraTabela();
    }),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })) })),
    removeChannel: vi.fn(),
  },
}));

// Contador de consultas ao productSource — 0-based; 0 é o resumo.
let consultasDeProduto = 0;

function builderDeProduto(): any {
  consultasDeProduto += 1;
  const ehResumo = consultasDeProduto === 1;
  const consulta: any = {};
  consulta.is = vi.fn(() => consulta);
  consulta.order = vi.fn(() => consulta);
  consulta.eq = vi.fn(() => consulta);
  consulta.limit = vi.fn(() => consulta);
  consulta.in = vi.fn((_coluna: string, ids: string[]) => {
    lotesRecebidos.push([...ids]);
    const indiceDoLote = lotesRecebidos.length - 1;
    consulta.resposta = lotesQueFalham.includes(indiceDoLote)
      ? Promise.resolve({
          data: null,
          error: { message: "414 URI Too Long (simulado)" },
        })
      : Promise.resolve({
          data: ids.map((id) => ({
            id,
            nome: `Produto ${id}`,
            preco_venda: 10,
            estoque: 1,
            ativo: true,
            ultima_atualizacao: "2026-09-19T00:00:00.000Z",
          })),
          error: null,
        });
    return consulta;
  });
  consulta.select = vi.fn(() => consulta);
  consulta.then = (
    onOk: (v: unknown) => unknown,
    onErro: (e: unknown) => unknown,
  ) => {
    const resposta = ehResumo
      ? Promise.resolve({ data: resumoDoServidor, error: null })
      : (consulta.resposta ?? Promise.resolve({ data: [], error: null }));
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

function resumoCom(quantidade: number): ProdutoResumo[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `produto-${String(i).padStart(3, "0")}`,
    ultima_atualizacao: "2026-09-19T00:00:00.000Z",
  }));
}

describe("catchUp — o catchup de detalhes fatia os ids (realtimeSyncEngine-955)", () => {
  beforeEach(() => {
    lotesRecebidos = [];
    lotesQueFalham = [];
    resumoDoServidor = [];
    consultasDeProduto = 0;
  });

  it("catálogo pequeno (≤100 desatualizados) custa UMA chamada de detalhe", async () => {
    resumoDoServidor = resumoCom(50);
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const vault = dubleDeCofreVazio();

    await engine.catchUp(vault as any, false);

    expect(lotesRecebidos).toHaveLength(1);
    expect(lotesRecebidos[0]).toHaveLength(50);
    expect(vault.putMany).toHaveBeenCalledTimes(1);
  });

  it("250 ids desatualizados viram 3 lotes de ≤100 e o cofre recebe os 250 concatenados", async () => {
    resumoDoServidor = resumoCom(250);
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const vault = dubleDeCofreVazio();

    await engine.catchUp(vault as any, false);

    expect(lotesRecebidos).toHaveLength(3);
    expect(lotesRecebidos[0]).toHaveLength(100);
    expect(lotesRecebidos[1]).toHaveLength(100);
    expect(lotesRecebidos[2]).toHaveLength(50);
    // Sem id perdido e sem id repetido entre os lotes.
    const todos = lotesRecebidos.flat();
    expect(new Set(todos).size).toBe(250);
    // O cofre recebe o catálogo INTEIRO — com o `.in` único de antes, esta
    // requisição nem chegava ao banco (414 no gateway) e o putMany ficava
    // vazio para sempre.
    const gravados = vault.putMany.mock.calls.at(0)?.[1] ?? [];
    expect(gravados).toHaveLength(250);
  });

  it("um lote que falha NÃO descarta os outros: os que chegaram são gravados", async () => {
    resumoDoServidor = resumoCom(250);
    lotesQueFalham = [1]; // o segundo lote (100 ids) falha
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const vault = dubleDeCofreVazio();

    // NÃO pode lançar: registrar e seguir é o contrato.
    await engine.catchUp(vault as any, false);

    expect(lotesRecebidos).toHaveLength(3);
    // 1º e 3º lotes entraram; o 2º ficou para a próxima rodada.
    const gravados = vault.putMany.mock.calls.at(0)?.[1] ?? [];
    expect(gravados).toHaveLength(150);
    const idsGravados = new Set(gravados.map((p: any) => p.id));
    expect(idsGravados.has("produto-000")).toBe(true);
    expect(idsGravados.has("produto-150")).toBe(false);
    // E o que entrou é marcado como sincronizado.
    expect(vault.setLastSync).toHaveBeenCalledWith("products");
  });
});
