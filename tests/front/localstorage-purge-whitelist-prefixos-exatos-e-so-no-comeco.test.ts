// A lista branca da purga decide o que sobrevive quando o app apaga o aparelho:
// escrita pendente do lojista, carrinho, sessão. Duas pontas opostas:
//  - prefixo CURTO demais deixa sobreviver chave que devia ser apagada
//    (`cart_` virar `cart` salvaria `cartao_antigo`), e o app guarda lixo
//    velho que a purga existe para tirar;
//  - o prefixo só vale no COMEÇO da chave: um nome que apenas CONTÉM o prefixo
//    no meio é de outro dono.
// O teste vizinho (`localstorage-purge-whitelist-e-compartilhada.test.ts`) prova
// que cada prefixo SALVA a sua chave; aqui se prova que ele não salva demais.
import { describe, expect, it } from "vitest";

import {
  LOCALSTORAGE_PURGE_WHITELIST,
  SESSIONSTORAGE_PURGE_WHITELIST,
  chaveDeSessaoSobreviveAPurga,
  chaveSobreviveAPurga,
} from "@/lib/localStoragePurgeWhitelist";

describe("lista branca do localStorage — prefixos exatos", () => {
  // Chaves LITERAIS (nunca derivadas da própria lista: uma lista que encurta um
  // prefixo encurtaria junto a sonda e o teste concordaria com o erro). Cada uma
  // é o prefixo de verdade com o ÚLTIMO caractere trocado.
  it.each([
    ["sb~sessao", "sb-"],
    ["supabase.aut~", "supabase.auth"],
    ["pwa~instalado", "pwa_"],
    ["marketplace~cart", "marketplace_"],
    ["ikcous~qualquer", "ikcous_"],
    ["cart~antigo", "cart_"],
    ["favorites~antigo", "favorites_"],
    ["notificacoes~campanha", "notificacoes-"],
    ["orders_offline_updates_queu~", "orders_offline_updates_queue"],
    ["products_offline_updates_queu~", "products_offline_updates_queue"],
    ["admin_banner_form_draf~", "admin_banner_form_draft"],
    ["admin_pdv_venda_draf~", "admin_pdv_venda_draft"],
    ["ikcous-chave-do-pedido~convidado", "ikcous-chave-do-pedido:"],
    ["ikcous:cpf-pendente-cadastr~", "ikcous:cpf-pendente-cadastro"],
    ["ikcous-chave-da-devolucao~p1:5000", "ikcous-chave-da-devolucao:"],
  ])(
    "a chave vizinha %s (prefixo %s com o fim trocado) é apagada",
    (vizinha) => {
      expect(chaveSobreviveAPurga(vizinha)).toBe(false);
    },
  );

  it.each(LOCALSTORAGE_PURGE_WHITELIST.map((p) => [p]))(
    "o prefixo %s só vale no COMEÇO: contido no meio da chave, não salva",
    (prefixo) => {
      const noMeio = `zz-${prefixo}resto`;
      expect(chaveSobreviveAPurga(noMeio)).toBe(false);
    },
  );

  it("exemplos do dia a dia: chave de outro dono com nome parecido é apagada", () => {
    expect(chaveSobreviveAPurga("cartao_de_visita")).toBe(false);
    expect(chaveSobreviveAPurga("sbx-token")).toBe(false);
    expect(chaveSobreviveAPurga("pwa-instalado")).toBe(false);
    expect(chaveSobreviveAPurga("favoritesx")).toBe(false);
  });
});

describe("lista branca do sessionStorage — prefixos exatos", () => {
  it.each([
    ["ikcous:checkout-pedido-pendente~conta-1"],
    ["ikcous-rascunho-do-checkout-v~"],
    ["ikcous-pedido-sem-resposta-v~"],
    ["fin-lancamento-tentativas-em-abert~"],
    ["ikcous:rascunho-da-devolucao~conta-1:p1"],
  ])("a chave vizinha %s (fim do prefixo trocado) é apagada", (vizinha) => {
    expect(chaveDeSessaoSobreviveAPurga(vizinha)).toBe(false);
  });

  it.each(SESSIONSTORAGE_PURGE_WHITELIST.map((p) => [p]))(
    "o prefixo %s só vale no COMEÇO da chave",
    (prefixo) => {
      expect(chaveDeSessaoSobreviveAPurga(`zz-${prefixo}resto`)).toBe(false);
    },
  );
});
