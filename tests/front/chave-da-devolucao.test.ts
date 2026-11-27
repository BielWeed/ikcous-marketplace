// @vitest-environment jsdom
//
// A chave da devolução (src/lib/chave-da-devolucao.ts): a mesma intenção (pedido + valor em centavos) leva a
// mesma chave por até 30 min; cada valor guarda a sua (outro valor no meio não apaga); a linha confirmada na
// lista ou pelo servidor encerra a intenção; encerrar só apaga a chave que ainda é a da intenção;
// registro vencido, malformado ou com validade absurda não vale; sem localStorage a chave ainda vale na aba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

const PRAZO_MS = 30 * 60_000;
const PREFIXO = "ikcous-chave-da-devolucao:";

async function carregar() {
  vi.resetModules();
  return import("@/lib/chave-da-devolucao");
}

// O `localStorage` de cada teste é um dublê INSTALADO no global (vi.stubGlobal),
// nunca um espião: o global muda de natureza com o Node. No Node 24 é o
// `Storage` do jsdom, em que `vi.spyOn(localStorage, "getItem")` vira um ITEM
// guardado (o método nem é trocado); no Node 25 é o storage de reserva do setup
// (tests/front/setup-build-identity.ts), que não herda de `Storage.prototype`.
// Trocar o objeto inteiro vale nos dois.
let recusas = 0;
function storageQueRecusa(): void {
  const recusar = () => {
    recusas += 1;
    throw new DOMException("cota", "QuotaExceededError");
  };
  vi.stubGlobal("localStorage", {
    length: 0,
    clear: recusar,
    getItem: recusar,
    key: recusar,
    removeItem: recusar,
    setItem: recusar,
  });
}

beforeEach(() => {
  recusas = 0;
  vi.stubGlobal(
    "localStorage",
    new ArmazenamentoComCota(Number.POSITIVE_INFINITY),
  );
});

afterEach(() => {
  // Sem `localStorage.clear()` aqui: depois de desfazer os stubs, o global do
  // Node 25 é o experimental quebrado até o `beforeEach` do setup reinstalar a
  // reserva. Cada teste ganha um dublê novo no `beforeEach` acima.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chaveDaDevolucao", () => {
  it("mesma intenção, mesma chave; outro valor ou outro pedido, chave nova", async () => {
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    expect(chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
    expect(chaveDaDevolucao("p1", 50.0, 3_000)).toBe(a);
    const b = chaveDaDevolucao("p1", 49.99, 4_000);
    expect(b).not.toBe(a);
    expect(chaveDaDevolucao("p1", 49.99, 4_500)).toBe(b);
    expect(chaveDaDevolucao("p2", 50, 5_000)).not.toBe(
      chaveDaDevolucao("p1", 50, 5_000),
    );
  });

  it("CASO 2: outro valor no meio NÃO apaga a intenção de antes — voltar a R$ 50 repete a chave de R$ 50", async () => {
    // R$ 50 (K1) presa na trava do pedido, depois R$ 60 (K2), depois R$ 50 de novo: se a K1 ainda gravar e a
    // terceira levasse chave nova, nasceriam duas de R$ 50. Cada valor guarda a sua chave.
    const { chaveDaDevolucao } = await carregar();
    const k1 = chaveDaDevolucao("p1", 50, 1_000);
    const k2 = chaveDaDevolucao("p1", 60, 2_000);
    expect(k2).not.toBe(k1);
    expect(chaveDaDevolucao("p1", 50, 3_000)).toBe(k1);
    expect(chaveDaDevolucao("p1", 60, 4_000)).toBe(k2);
    // e sobrevive à recarga da página (mora no localStorage, um registro por valor)
    const depois = await carregar();
    expect(depois.chaveDaDevolucao("p1", 50, 5_000)).toBe(k1);
    expect(depois.chaveDaDevolucao("p1", 60, 5_000)).toBe(k2);
  });

  it("CASO 1: a lista já mostra a linha criada com a chave → intenção confirmada, a próxima de igual valor é NOVA", async () => {
    const { chaveDaDevolucao } = await carregar();
    const k = chaveDaDevolucao("p1", 50, 1_000);
    // a lista mostra OUTRAS chaves (outra intenção, outra porta): a de R$ 50 continua a mesma
    expect(chaveDaDevolucao("p1", 50, 2_000, new Set(["outra"]))).toBe(k);
    const nova = chaveDaDevolucao("p1", 50, 3_000, new Set([k]));
    expect(nova).not.toBe(k);
    // a nova é a que vale agora (a confirmada não volta)
    expect(chaveDaDevolucao("p1", 50, 4_000)).toBe(nova);
    expect(chaveDaDevolucao("p1", 50, 5_000, new Set([k]))).toBe(nova);
  });

  it("a linha confirmada de R$ 50 não mexe na intenção de R$ 30 em curso", async () => {
    const { chaveDaDevolucao } = await carregar();
    const k50 = chaveDaDevolucao("p1", 50, 1_000);
    const k30 = chaveDaDevolucao("p1", 30, 1_000);
    expect(chaveDaDevolucao("p1", 30, 2_000, new Set([k50]))).toBe(k30);
  });

  it("registro do formato ANTERIOR (um por pedido, versão 1.5.244) ainda vale para o mesmo valor", async () => {
    // Quem atualizou o app no meio de uma intenção presa: a chave gravada antes não pode virar chave nova.
    localStorage.setItem(
      `${PREFIXO}p1`,
      JSON.stringify({ centavos: 5000, chave: "k-antiga", expiraEm: 10_000 }),
    );
    const { chaveDaDevolucao } = await carregar();
    expect(chaveDaDevolucao("p1", 50, 1_000)).toBe("k-antiga");
    expect(chaveDaDevolucao("p1", 30, 1_000)).not.toBe("k-antiga");
    expect(chaveDaDevolucao("p1", 50, 2_000)).toBe("k-antiga");
    // confirmada pela lista: some de vez (não ressurge por baixo da nova)
    const nova = chaveDaDevolucao("p1", 50, 3_000, new Set(["k-antiga"]));
    expect(nova).not.toBe("k-antiga");
    expect(localStorage.getItem(`${PREFIXO}p1`)).toBeNull();
    expect(chaveDaDevolucao("p1", 50, 4_000)).toBe(nova);
  });

  it("vence em 30 min contados da criação (nunca estendidos pelo uso)", async () => {
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 0);
    expect(chaveDaDevolucao("p1", 50, PRAZO_MS - 1)).toBe(a);
    expect(chaveDaDevolucao("p1", 50, PRAZO_MS)).not.toBe(a);
  });

  it("vale entre montagens e recargas: mora no localStorage", async () => {
    const primeira = await carregar();
    const a = primeira.chaveDaDevolucao("p1", 50, 1_000);
    const segunda = await carregar(); // módulo novo = página recarregada
    expect(segunda.chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
  });

  it("registro malformado ou com validade além do prazo não vale", async () => {
    const { chaveDaDevolucao } = await carregar();
    for (const cru of [
      "{",
      JSON.stringify({ centavos: 5000, chave: 1, expiraEm: 10_000 }),
      JSON.stringify({ centavos: 50.5, chave: "x", expiraEm: 10_000 }),
      JSON.stringify({ centavos: 5000, chave: "x", expiraEm: 10 * PRAZO_MS }),
    ]) {
      localStorage.setItem(`${PREFIXO}p1:5000`, cru);
      localStorage.setItem(`${PREFIXO}p1`, cru);
      expect(chaveDaDevolucao("p1", 50, 1_000)).not.toBe("x");
      localStorage.clear();
    }
  });

  it("sem localStorage (getItem/setItem recusam), a chave ainda vale na aba", async () => {
    storageQueRecusa();
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    // guarda: o storage recusou de verdade (o dublê foi chamado)
    expect(recusas).toBeGreaterThan(0);
    expect(chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
  });
});

describe("encerrarChaveDaDevolucao", () => {
  it("encerra o registro do formato ANTERIOR quando a chave é a dele", async () => {
    localStorage.setItem(
      `${PREFIXO}p1`,
      JSON.stringify({ centavos: 5000, chave: "k-antiga", expiraEm: 10_000 }),
    );
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    encerrarChaveDaDevolucao("p1", 50, "outra");
    expect(localStorage.getItem(`${PREFIXO}p1`)).not.toBeNull();
    encerrarChaveDaDevolucao("p1", 50, "k-antiga");
    expect(localStorage.getItem(`${PREFIXO}p1`)).toBeNull();
    expect(chaveDaDevolucao("p1", 50, 1_000)).not.toBe("k-antiga");
  });

  it("encerra a intenção: a próxima de igual valor tem chave nova", async () => {
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    expect(localStorage.getItem(`${PREFIXO}p1:5000`)).not.toBeNull();
    encerrarChaveDaDevolucao("p1", 50, a);
    expect(localStorage.getItem(`${PREFIXO}p1:5000`)).toBeNull();
    expect(chaveDaDevolucao("p1", 50, 2_000)).not.toBe(a);
  });

  it("a chave de uma intenção ANTIGA não apaga a da intenção em curso", async () => {
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    // a de R$ 50 foi confirmada pela lista e girou; a resposta tardia da antiga chega depois
    const antiga = chaveDaDevolucao("p1", 50, 1_000);
    const emCurso = chaveDaDevolucao("p1", 50, 2_000, new Set([antiga]));
    expect(emCurso).not.toBe(antiga);
    encerrarChaveDaDevolucao("p1", 50, antiga);
    expect(chaveDaDevolucao("p1", 50, 3_000)).toBe(emCurso);
    // e encerrar a de R$ 50 não toca na de R$ 30
    const k30 = chaveDaDevolucao("p1", 30, 3_000);
    encerrarChaveDaDevolucao("p1", 50, emCurso);
    expect(chaveDaDevolucao("p1", 30, 4_000)).toBe(k30);
  });

  it("sem localStorage, encerra na memória da aba", async () => {
    storageQueRecusa();
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    // guarda: o storage recusou de verdade (a chave só existe na memória)
    expect(recusas).toBeGreaterThan(0);
    expect(chaveDaDevolucao("p1", 30, 1_500)).not.toBe(a);
    expect(chaveDaDevolucao("p1", 50, 1_600)).toBe(a);
    encerrarChaveDaDevolucao("p1", 50, a);
    expect(chaveDaDevolucao("p1", 50, 2_000)).not.toBe(a);
  });
});
