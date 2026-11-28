// A RESERVA DA CADERNETA (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T8):
// quem GRAVA é `scripts/frota/reserva-da-caderneta.mjs` (Node puro, não
// importa TypeScript) e quem LÊ é `validarReserva` de
// `src/hospedagem/reservaDaCaderneta.ts` (borda, sem extensão nos imports).
// Os dois não podem ser o mesmo arquivo; este teste trava a concordância:
//  - o que o script monta passa INTEIRO na leitura (nenhuma entrada some);
//  - a régua de recusa do script (`entradaInvalida`) aceita e recusa
//    exatamente o que o porteiro aceita e recusa, caso a caso;
//  - a chave da política é a CHAVE_DA_RESERVA do porteiro.
// Se o porteiro apertar a régua e o script não, o script gravaria uma reserva
// em que a loja some calada na leitura. Domínios, refs e chaves INVENTADOS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHAVE_DA_RESERVA,
  validarReserva,
} from "@/hospedagem/reservaDaCaderneta";

// Módulo JS sem declaração de tipos, mesmo padrão de mapa-do-site.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração; confronto com o contrato TypeScript.
import * as script from "../../scripts/frota/reserva-da-caderneta.mjs";

const REF_A = "lojaalojaalojaalojaa"; // 20 letras, inventado
const REF_B = "lojablojablojablojab"; // 20 letras, inventado
const K_A = "sb_publishable_inventada_da_loja_a";
const K_B = "sb_publishable_inventada_da_loja_b";
const SHA = "0123456789abcdef0123456789abcdef01234567";
// Montado por partes para nenhum detector de segredo confundir o fixture.
const CHAVE_SECRETA_INVENTADA = ["sb", "secret", "inventada"].join("_");

function jwtDeTeste(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.assinatura`;
}

function sonda(
  dominio: string,
  ref: string,
  chave: string,
  caderneta = "hit",
): Record<string, unknown> {
  return {
    dominio,
    ficha: { status: 200, caderneta, refs: [ref], estavel: true },
    chavePublica: chave,
  };
}

describe("o que o script monta passa inteiro no porteiro", () => {
  it("validarReserva devolve o MESMO documento, sem perder entrada", () => {
    const doc = script.montarReserva(
      {
        completo: true,
        sondas: [
          sonda("loja-a.exemplo.test", REF_A, K_A),
          sonda("www.loja-a.exemplo.test", REF_A, K_A),
          sonda("loja-b.exemplo.test", REF_B, jwtDeTeste("anon")),
          sonda("so-reserva.exemplo.test", REF_B, K_B, "reserva"),
        ],
      },
      { sha: SHA, agora: Date.parse("2026-11-26T15:00:00Z") },
    );
    expect(Object.keys(doc.hosts)).toHaveLength(3);
    expect(validarReserva(doc)).toEqual(doc);
    expect(script.problemasDaReserva(doc)).toEqual([]);
  });

  it("a chave da política é a CHAVE_DA_RESERVA do porteiro", () => {
    const politica = JSON.parse(
      readFileSync("scripts/frota/politica.json", "utf8"),
    );
    expect(politica.reservaDaCaderneta.chave).toBe(CHAVE_DA_RESERVA);
  });
});

describe("a régua de recusa do script é a régua do porteiro", () => {
  const U = `https://${REF_A}.supabase.co`;
  const hosts: string[] = [
    "loja.exemplo.test",
    "www.loja.exemplo.test",
    "xn--loja-9qa.exemplo.test",
    "1.2.3.4",
    "Loja.exemplo.test",
    "loja.exemplo.test.",
    "loja.exemplo.test:443",
    "localhost",
    "-loja.exemplo.test",
    "loja-.exemplo.test",
    "loja_x.exemplo.test",
    "0x7f.1",
    `${"a".repeat(64)}.exemplo.test`,
    "",
    "__proto__",
  ];
  const entradas: unknown[] = [
    { u: U, k: K_A },
    { u: U, k: jwtDeTeste("anon") },
    { u: U, k: jwtDeTeste("service_role") },
    { u: U, k: CHAVE_SECRETA_INVENTADA },
    { u: U, k: null },
    { u: U, k: 42 },
    { u: `${U}/`, k: K_A },
    { u: `http://${REF_A}.supabase.co`, k: K_A },
    { u: `https://${REF_A.slice(1)}.supabase.co`, k: K_A },
    { u: "https://loja.exemplo.test", k: K_A },
    { u: U, k: K_A, nome: "Loja" },
    { u: U },
    null,
    [U, K_A],
    "texto",
  ];

  for (const host of hosts) {
    for (const [i, entrada] of entradas.entries()) {
      it(`host ${JSON.stringify(host)} × entrada ${i}`, () => {
        const hostsDoDoc: Record<string, unknown> = {};
        Object.defineProperty(hostsDoDoc, host, {
          value: entrada,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        const lido = validarReserva({
          v: 1,
          gerada_em: "2026-11-26T12:00:00.000Z",
          sha: SHA,
          hosts: hostsDoDoc,
        });
        const porteiroAceita = Object.hasOwn(lido?.hosts ?? {}, host);
        const scriptAceita = script.entradaInvalida(host, entrada) === null;
        expect(scriptAceita).toBe(porteiroAceita);
      });
    }
  }

  it("a tabela tem casos aceitos E recusados (não concorda no vazio)", () => {
    const veredictos = hosts.flatMap((h) =>
      entradas.map((e) => script.entradaInvalida(h, e) === null),
    );
    expect(veredictos.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(veredictos.filter((v) => !v).length).toBeGreaterThan(100);
  });
});
