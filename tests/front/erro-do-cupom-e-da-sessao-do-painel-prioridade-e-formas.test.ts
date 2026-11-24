import {
  MENSAGEM_SESSAO_OU_PERMISSAO,
  mensagemDeErroDeSessaoDoPainel,
} from "@/lib/erro-de-sessao-do-painel";
// Frases de erro do painel que dependem de ORDEM e de forma do erro
// (src/lib/erro-do-cupom.ts e src/lib/erro-de-sessao-do-painel.ts). O que
// protege:
//   · ao salvar cupom, sessão vencida/sem permissão VENCE a frase genérica da
//     tela — a lojista deslogada precisa ouvir "entre de novo", não "erro ao
//     salvar cupom" para sempre;
//   · a sessão vence até a frase de código repetido (sem sessão o salvar nem
//     chegou ao banco, então "já existe um cupom" seria mentira);
//   · "jwt expired" vale em qualquer caixa (cada camada do gateway escreve de
//     um jeito) e erro sem forma (nulo, texto cru) não estoura.
import {
  AVISO_CODIGO_DO_CUPOM_REPETIDO,
  mensagemDeErroDoCupom,
} from "@/lib/erro-do-cupom";
import { describe, expect, it } from "vitest";

const PADRAO = "Erro ao salvar o cupom.";

describe("mensagemDeErroDoCupom — a sessão vence", () => {
  it.each([
    ["42501 (sem permissão)", { code: "42501", message: "denied" }],
    ["HTTP 401 do gateway", { status: 401, message: "Unauthorized" }],
    ["JWT expired", { message: "JWT expired" }],
  ])("%s vira a frase de sessão ou permissão", (_nome, erro) => {
    expect(mensagemDeErroDoCupom(erro, PADRAO)).toBe(
      MENSAGEM_SESSAO_OU_PERMISSAO,
    );
  });

  it("sessão vencida ganha até de código repetido no mesmo erro", () => {
    expect(
      mensagemDeErroDoCupom(
        { code: "42501", message: 'duplicate key "coupons_code_key"' },
        PADRAO,
      ),
    ).toBe(MENSAGEM_SESSAO_OU_PERMISSAO);
  });

  it("sem sinal de sessão, código repetido segue valendo", () => {
    expect(mensagemDeErroDoCupom({ code: "23505", message: "x" }, PADRAO)).toBe(
      AVISO_CODIGO_DO_CUPOM_REPETIDO,
    );
  });

  it("erro nulo, texto cru ou sem forma cai na frase padrão da tela", () => {
    expect(mensagemDeErroDoCupom(null, PADRAO)).toBe(PADRAO);
    expect(mensagemDeErroDoCupom(undefined, PADRAO)).toBe(PADRAO);
    expect(mensagemDeErroDoCupom("falhou", PADRAO)).toBe(PADRAO);
    expect(mensagemDeErroDoCupom({}, PADRAO)).toBe(PADRAO);
  });
});

describe("mensagemDeErroDeSessaoDoPainel — formas do erro", () => {
  it.each(["JWT expired", "jwt expired", "JWT EXPIRED at 17:00"])(
    "mensagem %j conta como sessão vencida",
    (message) => {
      expect(mensagemDeErroDeSessaoDoPainel({ message })).toBe(
        MENSAGEM_SESSAO_OU_PERMISSAO,
      );
    },
  );

  it("mensagem que não é texto não conta (nem estoura)", () => {
    expect(mensagemDeErroDeSessaoDoPainel({ message: 401 })).toBeNull();
    expect(mensagemDeErroDeSessaoDoPainel({ message: null })).toBeNull();
    expect(mensagemDeErroDeSessaoDoPainel(null)).toBeNull();
  });
});
