// @vitest-environment jsdom
// Caça por mutação (25/11/2026), chave da tentativa do caixa: o que NUNCA pode
// acontecer com a memória de uma sangria/suprimento que ainda não deu resposta.
//   - sem autor identificado (null), a chave não é lida nem apagada do
//     armazenamento: um registro gravado "para ninguém" não vira a intenção de
//     quem abre a folha agora;
//   - a limpeza por histórico novo não apaga entrada de formato estranho (texto,
//     null) e uma entrada torta não impede apagar as sessões fechadas do autor.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chaveDaTentativaDoCaixa,
  esquecerTentativaDoCaixa,
  esquecerTentativasDeSessoesFechadas,
} from "@/components/admin/financeiro/tentativasDoCaixa";
import type { SessaoDeCaixa } from "@/types/financeiro";

const PREFIXO = "ikcous_fin_caixa_tentativa:";
const UUID_ALHEIO = "11111111-1111-4111-8111-111111111111";
const UUID_DA_ANA = "22222222-2222-4222-8222-222222222222";

const fechada = (id: string) =>
  ({
    id,
    contaNome: "Caixa da loja",
    abertoEm: "2026-09-26T12:00:00Z",
    fechadoEm: "2026-09-26T20:00:00Z",
    valorAbertura: 100,
    esperado: 100,
    contado: 100,
    diferenca: 0,
    status: "fechado",
  }) satisfies SessaoDeCaixa;

const enderecoSemAutor = PREFIXO + JSON.stringify([null, "sess-1", "sangria"]);

describe("tentativas do caixa: sem autor identificado", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("não lê a chave que ficou gravada para 'ninguém': devolve uma chave nova", () => {
    localStorage.setItem(enderecoSemAutor, UUID_ALHEIO);

    const chave = chaveDaTentativaDoCaixa(null, "sess-1", "sangria");

    expect(chave).not.toBe(UUID_ALHEIO);
    expect(localStorage.getItem(enderecoSemAutor)).toBe(UUID_ALHEIO);
  });

  it("esquecer sem autor não apaga o registro gravado para 'ninguém'", () => {
    localStorage.setItem(enderecoSemAutor, UUID_ALHEIO);

    esquecerTentativaDoCaixa(null, "sess-1", "sangria", UUID_ALHEIO);

    expect(localStorage.getItem(enderecoSemAutor)).toBe(UUID_ALHEIO);
  });

  it("o histórico novo sem autor não apaga o registro de 'ninguém', mesmo de sessão fechada", () => {
    localStorage.setItem(enderecoSemAutor, UUID_ALHEIO);

    esquecerTentativasDeSessoesFechadas(null, [fechada("sess-1")]);

    expect(localStorage.getItem(enderecoSemAutor)).toBe(UUID_ALHEIO);
  });
});

describe("tentativas do caixa: entrada de formato estranho no armazenamento", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("texto no lugar da lista não é tratado como [autor, sessão, tipo]", () => {
    // "ana-x" lido como lista daria autor "a" e sessão "n" por indexação de texto.
    localStorage.setItem(PREFIXO + JSON.stringify("ana-x"), UUID_ALHEIO);

    esquecerTentativasDeSessoesFechadas("a", [fechada("n")]);

    expect(localStorage.getItem(PREFIXO + JSON.stringify("ana-x"))).toBe(
      UUID_ALHEIO,
    );
  });

  it("entrada null não impede apagar a sessão fechada da Ana, gravada antes dela", () => {
    const daAna = PREFIXO + JSON.stringify(["ana", "sess-9", "suprimento"]);
    localStorage.setItem(daAna, UUID_DA_ANA);
    // Gravada por último: o laço (de trás para frente) passa por ela primeiro.
    localStorage.setItem(`${PREFIXO}null`, UUID_ALHEIO);

    esquecerTentativasDeSessoesFechadas("ana", [fechada("sess-9")]);

    expect(localStorage.getItem(daAna)).toBeNull();
    expect(localStorage.getItem(`${PREFIXO}null`)).toBe(UUID_ALHEIO);
  });
});
