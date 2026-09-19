// @vitest-environment jsdom
//
// DEPOIS DE `onversionchange` NINGUÉM ESCREVE NO VAZIO — frente pwa, tarefa
// dataVault-129.
//
// O DEFEITO: `db.onversionchange` (outra aba subiu o DATA_VAULT_VERSION)
// fecha a conexão e zera o singleton — mas quem já SEGUROU a instância (o
// RealtimeSyncEngine, que a recebe em start(vault) e guarda por closure)
// continua com o handle morto: toda escrita lança InvalidStateError (só
// console.error, e os listeners são avisados como se tivesse gravado) e o
// `getAll` do catchUp engole o throw e resolve [] — o que o catchUp lê como
// "cofre vazio" e põe O CATÁLOGO INTEIRO em outOfDateIds, a cada foco da
// aba. A existência de `getAllOrThrow` ao lado prova que a casa já sabia
// distinguir "quebrou" de "está vazio" — o motor é quem não usava.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. `cofreVivo`: instância sadia passa direto (dublês de teste, sem
//      isClosed, incluído); instância FECHADA é substituída pelo
//      `DataVault.init()` reaberto (singleton memorizado, custo zero).
//   2. A escrita do realtime (`_applyChangeAndNotify`) re-resolve o cofre
//      na borda assíncrona: evento chegando depois do versionchange grava
//      no cofre REABERTO, não no morto.
//   3. O catchUp lê o cofre local com `getAllOrThrow`: leitura quebrada
//      ABORTA a rodada — nenhuma ida de detalhe à rede, nenhum delete/put.
//      Nunca vira "cofre vazio" que reconcilia o catálogo inteiro.
//
// O `onversionchange` em si (a marcação da flag) não é exercício aqui: sem
// fake-indexeddb no projeto, abrir um IndexedDB de verdade no jsdom não é
// possível, e dublar o IDB para provar um callback do navegador seria
// teatro. O que segura a flag é a cadeia inteira: sem `isClosed()` no
// DataVault, os testes 2 e 3 não têm de onde reabrir — e o teste do motor
// de `_applyChangeAndNotify` exige uma instância que RESPONDA a isClosed().
import { beforeEach, describe, expect, it, vi } from "vitest";

// O motor importa { DataVault } (valor, para o init) e o tipo StoreName.
// O dublê substitui o singleton inteiro: init devolve o que o teste mandar.
let instanciaReaberta: any = null;
const initMock = vi.fn(async () => instanciaReaberta);

vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: (...args: unknown[]) => initMock(...(args as [])) },
}));

// Toda consulta resolve vazio; o registro das tabelas consultadas é o que
// prova a ordem do catchUp (resumo primeiro, detalhe só depois da leitura
// local — e a leitura local quebrada mata a rodada antes do detalhe).
const tabelasConsultadas: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      // O builder do postgrest é THENABLE — o catchUp faz `await consulta`
      // direto (Promise.all do resumo), sem `.then()` explícito. Resposta
      // padrão: vazio e sem erro (o resumo [] é o que leva a rodada até a
      // leitura local, onde o dublê do cofre quebra de propósito).
      const consulta: any = {
        is: vi.fn(() => consulta),
        in: vi.fn(() => consulta),
        order: vi.fn(() => consulta),
        eq: vi.fn(() => consulta),
        limit: vi.fn(() => consulta),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
      consulta.then = (
        onOk: (v: { data: unknown[]; error: null }) => unknown,
        onErro: (e: unknown) => unknown,
      ) => Promise.resolve({ data: [], error: null }).then(onOk, onErro);
      consulta.select = vi.fn(() => consulta);
      return consulta;
    }),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })) })),
    removeChannel: vi.fn(),
  },
}));

function dubleDeCofreSadio() {
  return {
    isClosed: () => false,
    getById: vi.fn(async () => undefined),
    put: vi.fn(),
    putMany: vi.fn(),
    getAll: vi.fn(async () => []),
    getAllOrThrow: vi.fn(async () => []),
    deleteById: vi.fn(),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(),
    getByIndex: vi.fn(async () => []),
  };
}

describe("cofreVivo — a borda que separa instância sadia de conexão morta", () => {
  beforeEach(() => {
    initMock.mockClear();
    instanciaReaberta = { marcado: "reaberto" };
  });

  it("instância FECHADA é substituída pelo singleton reaberto", async () => {
    const { cofreVivo } = await import("@/lib/realtimeSyncEngine");
    const morta = { isClosed: () => true };

    const resultado = await cofreVivo(morta as any);

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(resultado).toBe(instanciaReaberta);
  });

  it("instância SADIA passa direto — init nem é chamado", async () => {
    const { cofreVivo } = await import("@/lib/realtimeSyncEngine");
    const sadia = dubleDeCofreSadio();

    const resultado = await cofreVivo(sadia as any);

    expect(resultado).toBe(sadia);
    expect(initMock).not.toHaveBeenCalled();
  });

  it("dublê de teste SEM isClosed passa direto (compatibilidade com os dublês existentes)", async () => {
    const { cofreVivo } = await import("@/lib/realtimeSyncEngine");
    const duble = { put: vi.fn(), getAll: vi.fn(async () => []) };

    const resultado = await cofreVivo(duble as any);

    expect(resultado).toBe(duble);
    expect(initMock).not.toHaveBeenCalled();
  });
});

describe("_applyChangeAndNotify — evento de realtime depois do versionchange", () => {
  beforeEach(() => {
    initMock.mockClear();
    tabelasConsultadas.length = 0;
  });

  it("grava no cofre REABERTO (não no handle morto que o start capturou)", async () => {
    const engine = await import("@/lib/realtimeSyncEngine");
    const morta = {
      isClosed: () => true,
      getById: vi.fn(async () => undefined),
      put: vi.fn(),
      setLastSync: vi.fn(),
    };
    const viva = dubleDeCofreSadio();
    instanciaReaberta = viva;

    await (engine as any).RealtimeSyncEngine._applyChangeAndNotify(
      morta,
      { table: "produtos", store: "products" },
      "UPDATE",
      {
        id: "produto-1",
        nome: "Produto Teste",
        preco_venda: 10,
        ativo: true,
      },
      undefined,
    );

    // A morta não é tocada; a reaberta recebe a escrita.
    expect(morta.put).not.toHaveBeenCalled();
    expect(viva.put).toHaveBeenCalledTimes(1);
    expect(viva.setLastSync).toHaveBeenCalledWith("products");
  });
});

describe("catchUp — leitura local quebrada ABORTA a rodada (não vira 'cofre vazio')", () => {
  beforeEach(() => {
    initMock.mockClear();
    tabelasConsultadas.length = 0;
  });

  it("getAllOrThrow rejeitando: NENHUMA ida de detalhe à rede, nenhum delete, nenhum put", async () => {
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );

    const vault = {
      // A leitura local QUEBRA — é o cenário da conexão morta (o
      // InvalidStateError do transaction síncrono). `getAllOrThrow` REJEITA;
      // o `getAll` de antes engolia e devolvia [], lido como cofre vazio.
      getAllOrThrow: vi.fn(async () => {
        throw new Error("InvalidStateError: conexão fechada");
      }),
      getById: vi.fn(),
      put: vi.fn(),
      putMany: vi.fn(),
      deleteById: vi.fn(),
      setLastSync: vi.fn(),
      replaceAll: vi.fn(),
      getByIndex: vi.fn(async () => []),
    };

    await engine.catchUp(vault as any, false);

    // A leitura local foi tentada com o método que NÃO engole erro…
    expect(vault.getAllOrThrow).toHaveBeenCalled();
    // …e a rodada morreu ANTES da ida de detalhe: o resumo saiu (1ª ida a
    // vw_produtos_public no ramo de cliente), a segunda NÃO.
    expect(
      tabelasConsultadas.filter((t) => t === "vw_produtos_public"),
    ).toHaveLength(1);
    expect(tabelasConsultadas).not.toContain("produtos");

    // Nada foi escrito: o estado do cofre fica como estava, esperando a
    // próxima rodada (reaberta pelo cofreVivo).
    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(vault.putMany).not.toHaveBeenCalled();
    expect(vault.put).not.toHaveBeenCalled();
  });
});
