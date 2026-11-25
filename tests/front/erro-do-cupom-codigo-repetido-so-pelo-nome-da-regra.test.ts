// Achado por mutação, 25/11/2026: apagar `mensagem.includes("coupons_code_key")`
// (ou o `coupons_code_upper_uidx`) de `mensagemDeErroDoCupom` deixava a suíte
// inteira verde, porque todo teste de código repetido já trazia
// `code: "23505"`. O comentário da função promete o contrário: o PostgREST
// varia `message` entre versões e proxies, mas há caminhos em que o `code`
// não chega (proxy que reescreve o corpo, erro embrulhado em texto) e o NOME
// da regra do banco é o único sinal. Sem ele a lojista via de novo o toast
// genérico "Erro ao salvar" e trocava o código achando que o app quebrou.
import {
  AVISO_CODIGO_DO_CUPOM_REPETIDO,
  mensagemDeErroDoCupom,
} from "@/lib/erro-do-cupom";
import { describe, expect, it } from "vitest";

const PADRAO = "Erro ao salvar o cupom.";

describe("mensagemDeErroDoCupom — código repetido reconhecido só pelo nome da regra", () => {
  it("regra `coupons_code_key` na mensagem, sem `code`, avisa que o código já existe", () => {
    expect(
      mensagemDeErroDoCupom(
        {
          message:
            'duplicate key value violates unique constraint "coupons_code_key"',
        },
        PADRAO,
      ),
    ).toBe(AVISO_CODIGO_DO_CUPOM_REPETIDO);
  });

  it("índice `coupons_code_upper_uidx` (código sem diferença de caixa) também avisa", () => {
    expect(
      mensagemDeErroDoCupom(
        {
          message:
            'duplicate key value violates unique constraint "coupons_code_upper_uidx"',
        },
        PADRAO,
      ),
    ).toBe(AVISO_CODIGO_DO_CUPOM_REPETIDO);
  });

  it("o nome da regra vale com outro `code` que não seja o de violação única", () => {
    expect(
      mensagemDeErroDoCupom(
        { code: "XX000", message: 'violates "coupons_code_key"' },
        PADRAO,
      ),
    ).toBe(AVISO_CODIGO_DO_CUPOM_REPETIDO);
    expect(
      mensagemDeErroDoCupom(
        { code: "XX000", message: 'violates "coupons_code_upper_uidx"' },
        PADRAO,
      ),
    ).toBe(AVISO_CODIGO_DO_CUPOM_REPETIDO);
  });

  it("mensagem de outra regra do banco, sem `code` de violação única, segue na frase padrão", () => {
    expect(
      mensagemDeErroDoCupom(
        { message: 'violates unique constraint "products_slug_key"' },
        PADRAO,
      ),
    ).toBe(PADRAO);
    expect(
      mensagemDeErroDoCupom({ code: "23503", message: "fk" }, PADRAO),
    ).toBe(PADRAO);
  });
});
