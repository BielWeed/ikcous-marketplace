// Defeito 3 da revisão de contexto limpo (26/08/2026) sobre GlobalErrorBoundary:
// a Nuclear Purge de `useUpdateCheck.ts` (dispara SOZINHA no boot, quando
// `minAppVersion` exige, e na auto-recuperação de ChunkLoadError) tinha uma
// lista branca de localStorage SEPARADA da de `GlobalErrorBoundary.tsx` — 7
// prefixos contra 11 — e continuava sem cobrir as filas de escrita PENDENTE
// do lojista (`orders_offline_updates_queue`, `products_offline_updates_queue`)
// nem o rascunho de banner (`admin_banner_form_draft`). Como a Nuclear Purge
// dispara sozinha, isso é pior que o botão do boundary: pedido marcado como
// enviado ou preço/estoque editado offline somem sem ninguém decidir nada.
//
// A correção move as duas listas — e o CRITÉRIO de comparação, não só o
// array — para uma função pura compartilhada
// (`chaveSobreviveAPurga`, @/lib/localStoragePurgeWhitelist). `useUpdateCheck.ts`
// e `GlobalErrorBoundary.tsx` chamam a MESMA função; divergir de novo exigiria
// duplicar código, não só esquecer de copiar um prefixo — e este teste é o
// que garante que a função em si cobre os casos que causaram o defeito.
//
// Testável sem DOM, sem localStorage fake e sem os módulos virtuais do PWA
// que `useUpdateCheck.ts` importa (`virtual:pwa-register/react` não resolve
// neste runner — ver vitest.config.ts, "POR QUE `environment: node`" — então
// testar o hook inteiro exigiria mexer no config compartilhado do projeto,
// fora do escopo desta correção): só string in, boolean out.
//
// Vermelho contra o código antigo da Nuclear Purge (a lista de 7 prefixos
// que `useUpdateCheck.ts` tinha até 26/08/2026, sem as filas offline nem o
// rascunho de banner): as três chaves de escrita pendente reprovariam.
import { describe, expect, it } from "vitest";

import {
  LOCALSTORAGE_PURGE_WHITELIST,
  chaveSobreviveAPurga,
} from "@/lib/localStoragePurgeWhitelist";

describe("chaveSobreviveAPurga — critério ÚNICO usado pela Nuclear Purge e pelo recovery do boundary", () => {
  it("preserva as filas de escrita pendente do lojista e o rascunho de banner", () => {
    expect(chaveSobreviveAPurga("orders_offline_updates_queue")).toBe(true);
    expect(chaveSobreviveAPurga("products_offline_updates_queue")).toBe(true);
    expect(chaveSobreviveAPurga("admin_banner_form_draft")).toBe(true);
  });

  it("preserva sessão, carrinho, favoritos e aviso lido — o que a Nuclear Purge original já cobria", () => {
    expect(chaveSobreviveAPurga("sb-projeto-auth-token")).toBe(true);
    expect(chaveSobreviveAPurga("supabase.auth.token")).toBe(true);
    expect(chaveSobreviveAPurga("pwa_reload_reason")).toBe(true);
    expect(chaveSobreviveAPurga("marketplace_cart_v1")).toBe(true);
    expect(chaveSobreviveAPurga("ikcous_favorites")).toBe(true);
    expect(chaveSobreviveAPurga("cart_backup")).toBe(true);
    expect(chaveSobreviveAPurga("favorites_backup")).toBe(true);
    expect(chaveSobreviveAPurga("notificacoes-campanha-estado:u1")).toBe(true);
  });

  it("não preserva lixo fora da lista branca", () => {
    expect(chaveSobreviveAPurga("algum_state_corrompido")).toBe(false);
    expect(chaveSobreviveAPurga("cache_antigo_de_terceiro")).toBe(false);
  });

  // Prova que a função É o critério (não um atalho que sempre devolve
  // true/false): ela reflete exatamente `LOCALSTORAGE_PURGE_WHITELIST`, o
  // MESMO array que os dois arquivos importam — se algum dia um dos dois
  // voltar a manter uma cópia própria, este teste não pega a divergência
  // (é justamente o que os outros dois testes acima cobrem), mas prova que
  // hoje a função não está desalinhada da lista publicada.
  it("concorda com LOCALSTORAGE_PURGE_WHITELIST para cada prefixo publicado", () => {
    for (const prefixo of LOCALSTORAGE_PURGE_WHITELIST) {
      expect(chaveSobreviveAPurga(prefixo)).toBe(true);
      expect(chaveSobreviveAPurga(`${prefixo}qualquer-sufixo`)).toBe(true);
    }
  });
});
