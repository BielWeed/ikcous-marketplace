// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `dono-da-loja.ts`: o único mutante que
 * sobrevivia (`||` virando `&&` na escolha do nome da falha) mexia no que a
 * edge GRAVA NO LOG quando não consegue ler o dono. O contrato do comentário é
 * "só o nome da falha, nunca a mensagem do banco (pode carregar a linha)": os
 * dois nomes conhecidos aparecem, qualquer outro erro vira `inesperada` SEM a
 * mensagem original, e a resposta é sempre `indisponivel` (falha fechada).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirDono } from "./dono-da-loja.ts";

async function comLog(leitor: () => Promise<string | null>) {
  const linhas: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void linhas.push(a.map(String).join(" "));
  try {
    const resposta = await conferirDono("uid-de-quem-chama", leitor, "[teste-dono]");
    return { resposta, linhas };
  } finally {
    console.error = original;
  }
}

Deno.test("conferirDono: dono_ilegivel e dono_ambiguo aparecem pelo NOME no log; a resposta é indisponivel", async () => {
  for (const nome of ["dono_ilegivel", "dono_ambiguo"]) {
    const { resposta, linhas } = await comLog(() => Promise.reject(new Error(nome)));
    assertEquals(resposta, "indisponivel", nome);
    assertEquals(linhas, [`[teste-dono] não consegui ler o dono da loja (${nome})`], nome);
  }
});

Deno.test("conferirDono: qualquer outro erro vira 'inesperada' e a mensagem do banco NÃO vai para o log", async () => {
  const casos: unknown[] = [
    new Error('duplicate key value violates unique constraint (user_id)=(11111111-1111-4111-8111-111111111111)'),
    "texto solto com user_id=abc",
    { message: "dono_ilegivel" },
    null,
  ];
  for (const erro of casos) {
    const { resposta, linhas } = await comLog(() => Promise.reject(erro));
    assertEquals(resposta, "indisponivel");
    assertEquals(linhas, ["[teste-dono] não consegui ler o dono da loja (inesperada)"]);
  }
});
