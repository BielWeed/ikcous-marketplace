// @vitest-environment jsdom
// Chave da tentativa de sangria/suprimento do caixa (a que impede lançar duas
// vezes o mesmo dinheiro quando a resposta se perde).
//
// Nenhum teste lia `tentativasDoCaixa.ts` direto (só passava por dentro das telas
// do caixa). Aqui as regras da chave ficam fixadas uma a uma:
//  - mesma pessoa + mesma sessão + mesmo tipo = mesma chave (reabrir a folha
//    ou recarregar não gera um segundo lançamento);
//  - outra pessoa, outra sessão ou outro tipo = outra chave;
//  - resposta antiga não apaga a intenção mais nova;
//  - histórico novo só apaga sessões fechadas do autor, nunca as abertas nem as
//    de outro autor;
//  - sem armazenamento a operação segue (chave só em memória).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDaTentativaDoCaixa,
  esquecerTentativaDoCaixa,
  esquecerTentativasDeSessoesFechadas,
} from "@/components/admin/financeiro/tentativasDoCaixa";
import type { SessaoDeCaixa } from "@/types/financeiro";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sessao = (id: string, extra: Partial<SessaoDeCaixa> = {}) =>
  ({
    id,
    contaNome: "Caixa da loja",
    abertoEm: "2026-09-26T12:00:00Z",
    fechadoEm: null,
    valorAbertura: 100,
    esperado: null,
    contado: null,
    diferenca: null,
    status: "aberto",
    ...extra,
  }) satisfies SessaoDeCaixa;

const chavesGuardadas = () =>
  Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i),
  ).filter(
    (k): k is string => k?.startsWith("ikcous_fin_caixa_tentativa:") === true,
  );

describe("chaveDaTentativaDoCaixa", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("mesmo autor, sessão e tipo: a MESMA chave, em UUID v4", () => {
    const primeira = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    const segunda = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    expect(primeira).toMatch(UUID_V4);
    expect(segunda).toBe(primeira);
    expect(chavesGuardadas()).toHaveLength(1);
  });

  it("outro tipo, outra sessão ou outro autor: chave nova cada um", () => {
    const base = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    const outroTipo = chaveDaTentativaDoCaixa("ana", "sess-1", "suprimento");
    const outraSessao = chaveDaTentativaDoCaixa("ana", "sess-2", "sangria");
    const outroAutor = chaveDaTentativaDoCaixa("bia", "sess-1", "sangria");
    expect(new Set([base, outroTipo, outraSessao, outroAutor]).size).toBe(4);
    expect(chavesGuardadas()).toHaveLength(4);
  });

  it("sem autor: chave nova a cada chamada e nada vai para o armazenamento", () => {
    const a = chaveDaTentativaDoCaixa(null, "sess-1", "sangria");
    const b = chaveDaTentativaDoCaixa(null, "sess-1", "sangria");
    expect(a).toMatch(UUID_V4);
    expect(b).not.toBe(a);
    expect(chavesGuardadas()).toHaveLength(0);
  });

  it("valor guardado que não é UUID v4 é descartado e trocado por um válido", () => {
    const ok = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    const [endereco] = chavesGuardadas();
    expect(endereco).toBeDefined();
    localStorage.setItem(endereco as string, "lixo-nao-e-uuid");
    const nova = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    expect(nova).toMatch(UUID_V4);
    expect(nova).not.toBe(ok);
    expect(localStorage.getItem(endereco as string)).toBe(nova);
  });

  it("armazenamento bloqueado: devolve uma chave mesmo assim, sem estourar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "sangria")).toMatch(
      UUID_V4,
    );
  });
});

describe("esquecerTentativaDoCaixa", () => {
  beforeEach(() => localStorage.clear());

  it("apaga quando a chave da resposta é a que está guardada", () => {
    const chave = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    esquecerTentativaDoCaixa("ana", "sess-1", "sangria", chave);
    expect(chavesGuardadas()).toHaveLength(0);
    // a próxima tentativa já é outra intenção
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "sangria")).not.toBe(chave);
  });

  it("resposta ANTIGA (chave diferente da guardada) não apaga a intenção mais nova", () => {
    const nova = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    esquecerTentativaDoCaixa(
      "ana",
      "sess-1",
      "sangria",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "sangria")).toBe(nova);
  });

  it("sem autor ou sem chave não apaga nada", () => {
    const chave = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    esquecerTentativaDoCaixa(null, "sess-1", "sangria", chave);
    esquecerTentativaDoCaixa("ana", "sess-1", "sangria", null);
    expect(chavesGuardadas()).toHaveLength(1);
  });

  it("só apaga o tipo pedido (sangria não leva o suprimento junto)", () => {
    const sangria = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    const suprimento = chaveDaTentativaDoCaixa("ana", "sess-1", "suprimento");
    esquecerTentativaDoCaixa("ana", "sess-1", "sangria", sangria);
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "suprimento")).toBe(
      suprimento,
    );
  });
});

describe("esquecerTentativasDeSessoesFechadas", () => {
  beforeEach(() => localStorage.clear());

  it("apaga as chaves das sessões FECHADAS do autor e guarda as demais", () => {
    const fechadaSangria = chaveDaTentativaDoCaixa("ana", "fechada", "sangria");
    chaveDaTentativaDoCaixa("ana", "fechada", "suprimento");
    const aberta = chaveDaTentativaDoCaixa("ana", "aberta", "sangria");
    const doOutro = chaveDaTentativaDoCaixa("bia", "fechada", "sangria");
    localStorage.setItem("outra-coisa", "fica");

    esquecerTentativasDeSessoesFechadas("ana", [
      sessao("fechada", {
        status: "fechado",
        fechadoEm: "2026-09-26T20:00:00Z",
      }),
      sessao("aberta"),
    ]);

    // as duas da sessão fechada (sangria E suprimento) se foram
    expect(chaveDaTentativaDoCaixa("ana", "fechada", "sangria")).not.toBe(
      fechadaSangria,
    );
    expect(chaveDaTentativaDoCaixa("ana", "aberta", "sangria")).toBe(aberta);
    expect(chaveDaTentativaDoCaixa("bia", "fechada", "sangria")).toBe(doOutro);
    expect(localStorage.getItem("outra-coisa")).toBe("fica");
  });

  it("varre TODAS as chaves, mesmo as vizinhas (apagar no meio da leitura não pula nenhuma)", () => {
    for (const id of ["f1", "f2", "f3"]) {
      chaveDaTentativaDoCaixa("ana", id, "sangria");
      chaveDaTentativaDoCaixa("ana", id, "suprimento");
    }
    chaveDaTentativaDoCaixa("ana", "aberta", "sangria");
    expect(chavesGuardadas()).toHaveLength(7);

    esquecerTentativasDeSessoesFechadas(
      "ana",
      ["f1", "f2", "f3"].map((id) =>
        sessao(id, { status: "fechado", fechadoEm: "2026-09-26T20:00:00Z" }),
      ),
    );

    // sobra só a da sessão ainda aberta
    expect(chavesGuardadas()).toHaveLength(1);
  });

  it("'fechado' sem horário de fechamento não prova nada: a chave fica", () => {
    const chave = chaveDaTentativaDoCaixa("ana", "s", "sangria");
    esquecerTentativasDeSessoesFechadas("ana", [
      sessao("s", { status: "fechado", fechadoEm: null }),
    ]);
    expect(chaveDaTentativaDoCaixa("ana", "s", "sangria")).toBe(chave);
  });

  it("sessão com horário mas ainda 'aberto' também não apaga", () => {
    const chave = chaveDaTentativaDoCaixa("ana", "s", "sangria");
    esquecerTentativasDeSessoesFechadas("ana", [
      sessao("s", { status: "aberto", fechadoEm: "2026-09-26T20:00:00Z" }),
    ]);
    expect(chaveDaTentativaDoCaixa("ana", "s", "sangria")).toBe(chave);
  });

  it("sem autor não mexe em nada, e histórico vazio também não", () => {
    const chave = chaveDaTentativaDoCaixa("ana", "s", "sangria");
    esquecerTentativasDeSessoesFechadas(null, [
      sessao("s", { status: "fechado", fechadoEm: "2026-09-26T20:00:00Z" }),
    ]);
    esquecerTentativasDeSessoesFechadas("ana", []);
    expect(chaveDaTentativaDoCaixa("ana", "s", "sangria")).toBe(chave);
  });
});
