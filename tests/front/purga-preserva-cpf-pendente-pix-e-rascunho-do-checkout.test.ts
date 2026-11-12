// Lote r22-m: trabalho que a pessoa ainda NÃO terminou não some na purga.
//
// DEFEITO 1 (CPF do cadastro): a lista branca do localStorage tinha o prefixo
// "ikcous_" (sublinhado), mas a chave do CPF digitado no cadastro, esperando a
// confirmação do e-mail, é "ikcous:cpf-pendente-cadastro" (dois-pontos). A
// purga de versão obrigatória (useUpdateCheck) e o botão "Recarregar o app"
// apagavam o CPF e a pessoa tinha de digitá-lo de novo depois de confirmar o
// e-mail.
//
// DEFEITO 2 (PIX pendente e rascunho do checkout): `handleReset` do
// GlobalErrorBoundary fazia `sessionStorage.clear()` e levava junto o pedido
// que estava sendo pago e o formulário do checkout. Agora há uma lista branca
// de sessionStorage com SÓ essas duas chaves. O lote r66-b acrescentou a
// terceira: o pedido de visitante com resposta perdida (pedido-sem-resposta.ts).
//
// As duas chaves de sessionStorage não são exportadas pelos módulos dela; o
// teste amarra o literal da lista ao módulo de verdade GRAVANDO por ele e
// perguntando à lista se a chave que apareceu sobrevive.
import { describe, expect, it, vi } from "vitest";

// O módulo do CPF importa o cliente do Supabase, que exige variáveis de
// ambiente no import; aqui só interessa o literal da chave.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { CHAVE_CPF_PENDENTE } from "@/lib/cpf-pendente-do-cadastro";
import {
  LOCALSTORAGE_PURGE_WHITELIST,
  SESSIONSTORAGE_PURGE_WHITELIST,
  chaveDeSessaoSobreviveAPurga,
  chaveSobreviveAPurga,
} from "@/lib/localStoragePurgeWhitelist";
import { chaveDoPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";
import {
  type PedidoCongelado,
  guardarPedidoSemResposta,
} from "@/lib/pedido-sem-resposta";
import {
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";

describe("CPF pendente do cadastro sobrevive à purga do localStorage", () => {
  it("a chave real do módulo do CPF está na lista branca", () => {
    expect(chaveSobreviveAPurga(CHAVE_CPF_PENDENTE)).toBe(true);
    expect(LOCALSTORAGE_PURGE_WHITELIST).toContain(CHAVE_CPF_PENDENTE);
  });

  it("a exceção é exata: outra chave com 'ikcous:' continua sendo purgada", () => {
    expect(chaveSobreviveAPurga("ikcous:qualquer-outra-coisa")).toBe(false);
    expect(chaveSobreviveAPurga("ikcous:")).toBe(false);
  });
});

describe("lista branca do sessionStorage (purga do botão 'Recarregar o app')", () => {
  it("preserva o pedido pendente do checkout (PIX na tela), de qualquer conta", () => {
    expect(
      chaveDeSessaoSobreviveAPurga(
        chaveDoPedidoPendenteDoCheckout("5f0d6c1e-8a3b-4c52-9e7a-2b1d3f4a5c6d"),
      ),
    ).toBe(true);
    expect(
      chaveDeSessaoSobreviveAPurga(chaveDoPedidoPendenteDoCheckout("u1")),
    ).toBe(true);
  });

  it("preserva o rascunho do checkout, na chave que o módulo dele realmente usa", () => {
    const gravadas: string[] = [];
    salvarRascunhoDoCheckout(
      {
        getItem: () => null,
        setItem: (chave) => {
          gravadas.push(chave);
        },
        removeItem: () => {},
      },
      rascunhoVazio(),
    );
    expect(gravadas).toHaveLength(1);
    expect(chaveDeSessaoSobreviveAPurga(gravadas[0] ?? "")).toBe(true);
  });

  it("NÃO preserva o resto: sessão, token e qualquer outra chave genérica somem", () => {
    expect(chaveDeSessaoSobreviveAPurga("qualquer_coisa")).toBe(false);
    expect(chaveDeSessaoSobreviveAPurga("sb-projeto-auth-token")).toBe(false);
    expect(chaveDeSessaoSobreviveAPurga("supabase.auth.token")).toBe(false);
    expect(chaveDeSessaoSobreviveAPurga("splash_shown")).toBe(false);
    expect(chaveDeSessaoSobreviveAPurga("ikcous:cpf-pendente-cadastro")).toBe(
      false,
    );
    expect(chaveDeSessaoSobreviveAPurga("")).toBe(false);
  });

  it("não aceita chave só PARECIDA: prefixo do pedido sem os dois-pontos e rascunho de outra versão", () => {
    expect(
      chaveDeSessaoSobreviveAPurga("ikcous:checkout-pedido-pendente"),
    ).toBe(false);
    expect(chaveDeSessaoSobreviveAPurga("ikcous-rascunho-do-checkout-v2")).toBe(
      false,
    );
    expect(
      chaveDeSessaoSobreviveAPurga("x-ikcous-rascunho-do-checkout-v1"),
    ).toBe(false);
  });

  it("preserva o pedido de visitante com resposta perdida, na chave que o módulo dele realmente usa", () => {
    const pedido: PedidoCongelado = {
      orderData: { idempotencyKey: "k1", items: [] },
      ehOnline: false,
      metodoOnline: "pix",
      itens: [],
      valor: 10,
      cpfParaRpc: undefined,
      contaEsperada: null,
      semConta: true,
    };
    // Lê as chaves que o módulo gravou pelo próprio sessionStorage, sem mexer no
    // protótipo de `Storage` (não existe como global em todo ambiente de teste).
    sessionStorage.clear();
    let gravadas: string[] = [];
    try {
      guardarPedidoSemResposta(pedido);
      gravadas = Array.from(
        { length: sessionStorage.length },
        (_, i) => sessionStorage.key(i) ?? "",
      );
    } finally {
      sessionStorage.clear();
    }
    expect(gravadas).toHaveLength(1);
    expect(chaveDeSessaoSobreviveAPurga(gravadas[0] ?? "")).toBe(true);
  });

  it("não aceita o pedido sem resposta de OUTRA versão da chave", () => {
    expect(chaveDeSessaoSobreviveAPurga("ikcous-pedido-sem-resposta-v2")).toBe(
      false,
    );
    expect(
      chaveDeSessaoSobreviveAPurga("x-ikcous-pedido-sem-resposta-v1"),
    ).toBe(false);
  });

  it("a lista tem só as três entradas nomeadas (nada de segredo entra por aqui)", () => {
    expect(SESSIONSTORAGE_PURGE_WHITELIST).toHaveLength(3);
  });
});
