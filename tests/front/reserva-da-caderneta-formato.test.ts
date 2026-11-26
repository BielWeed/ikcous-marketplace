// A RESERVA DA CADERNETA (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T2): o
// documento `reserva_v1` que o porteiro lê quando a caderneta central falha e
// não há ficha. Este teste trava o FORMATO na leitura — versão, padrão de `u`,
// `k` só pública, host já normalizado — porque é daqui que nasceria "loja A
// abrindo com o banco de B" se a leitura fosse frouxa. Domínios, refs e
// chaves são INVENTADOS (repositório público).
import { describe, expect, it } from "vitest";

import { normalizarHost } from "@/hospedagem/porteiro";
import {
  CHAVE_DA_RESERVA,
  ENDERECO_DA_RESERVA_REGEX,
  entradaDaReserva,
  validarReserva,
} from "@/hospedagem/reservaDaCaderneta";

// JWT legado sintético (mesma receita de `porteiro-resolver-conexao.test.ts`):
// só para o classificador de chave reconhecer o papel; assinatura fictícia.
function jwtDeTeste(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.assinatura`;
}

// Montado por partes para nenhum detector de segredo confundir o fixture.
const CHAVE_SECRETA_INVENTADA = ["sb", "secret", "inventada"].join("_");

const REF_A = "lojaalojaalojaalojaa"; // 20 letras, inventado
const REF_B = "lojablojablojablojab"; // 20 letras, inventado
const U_A = `https://${REF_A}.supabase.co`;
const U_B = `https://${REF_B}.supabase.co`;
const K_PUBLICAVEL = "sb_publishable_inventada_da_loja_a";

function documento(hosts: unknown): Record<string, unknown> {
  return {
    v: 1,
    gerada_em: "2026-11-26T12:00:00.000Z",
    sha: "0123456789abcdef0123456789abcdef01234567",
    hosts,
  };
}

const VALIDO = documento({
  "loja-a.exemplo": { u: U_A, k: K_PUBLICAVEL },
  "loja-b.exemplo": { u: U_B, k: jwtDeTeste("anon") },
});

describe("reserva da caderneta — o documento v1", () => {
  it("a chave do documento na Global Config é reserva_v1", () => {
    expect(CHAVE_DA_RESERVA).toBe("reserva_v1");
  });

  it("aceita o documento v1 válido (publishable e anon JWT) sem perder entrada", () => {
    const reserva = validarReserva(VALIDO);
    expect(reserva).not.toBeNull();
    expect(reserva?.v).toBe(1);
    expect(reserva?.gerada_em).toBe("2026-11-26T12:00:00.000Z");
    expect(reserva?.sha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(Object.keys(reserva?.hosts ?? {}).sort()).toEqual([
      "loja-a.exemplo",
      "loja-b.exemplo",
    ]);
    // A saída é ela mesma um documento v1 válido (idempotente).
    expect(validarReserva(reserva)).toEqual(reserva);
  });

  it("aceita o documento vindo de JSON (o caminho real: texto da Global Config)", () => {
    const reserva = validarReserva(JSON.parse(JSON.stringify(VALIDO)));
    expect(Object.keys(reserva?.hosts ?? {})).toHaveLength(2);
  });

  it.each([
    ["v = 2", { ...VALIDO, v: 2 }],
    ["v = '1' (texto)", { ...VALIDO, v: "1" }],
    ["sem v", { ...VALIDO, v: undefined }],
    ["hosts = null", documento(null)],
    ["hosts = lista", documento([{ u: U_A, k: K_PUBLICAVEL }])],
    ["hosts = texto", documento("loja-a.exemplo")],
    ["sem gerada_em", { ...VALIDO, gerada_em: undefined }],
    ["sha vazio", { ...VALIDO, sha: "" }],
    ["documento null", null],
    ["documento lista", []],
    ["documento texto", "reserva"],
  ])("recusa o documento inteiro: %s", (_rotulo, doc) => {
    expect(validarReserva(doc)).toBeNull();
    expect(entradaDaReserva(doc, "loja-a.exemplo")).toBeNull();
  });
});

describe("reserva da caderneta — cada entrada", () => {
  function soComEntrada(entrada: unknown): Record<string, unknown> {
    return documento({ "loja-a.exemplo": entrada });
  }

  it.each([
    ["http em vez de https", `http://${REF_A}.supabase.co`],
    ["outro domínio", `https://${REF_A}.supabase.co.exemplo`],
    ["domínio parecido", `https://${REF_A}.supabase.com`],
    ["subdomínio de terceiro", `https://${REF_A}.atacante.exemplo`],
    ["ref com 19 letras", `https://${REF_A.slice(1)}.supabase.co`],
    ["ref com 21 letras", `https://${REF_A}x.supabase.co`],
    ["ref com maiúscula", `https://${REF_A.toUpperCase()}.supabase.co`],
    ["ref com dígito", `https://${REF_A.slice(1)}1.supabase.co`],
    ["caminho extra", `${U_A}/rest/v1`],
    ["barra final", `${U_A}/`],
    ["porta", `${U_A}:443`],
    ["credencial no endereço", `https://x@${REF_A}.supabase.co`],
    ["quebra de linha no fim", `${U_A}\n`],
    ["u não é texto", 42],
  ])("recusa u fora do padrão: %s", (_rotulo, u) => {
    const doc = soComEntrada({ u, k: K_PUBLICAVEL });
    expect(validarReserva(doc)?.hosts).toEqual({});
    expect(entradaDaReserva(doc, "loja-a.exemplo")).toBeNull();
  });

  it("o padrão do endereço é exatamente ^https://[a-z]{20}\\.supabase\\.co$", () => {
    expect(ENDERECO_DA_RESERVA_REGEX.source).toBe(
      String.raw`^https:\/\/[a-z]{20}\.supabase\.co$`,
    );
    expect(ENDERECO_DA_RESERVA_REGEX.flags).toBe("");
  });

  it.each([
    ["service_role (JWT legado)", jwtDeTeste("service_role")],
    ["papel desconhecido (JWT)", jwtDeTeste("supabase_admin")],
    ["JWT sem papel", jwtDeTeste("")],
    ["chave secreta nova", CHAVE_SECRETA_INVENTADA],
    ["texto qualquer", "nao-e-chave"],
    ["vazia", ""],
    ["k não é texto", { role: "anon" }],
  ])("recusa k que não é pública: %s", (_rotulo, k) => {
    const doc = soComEntrada({ u: U_A, k });
    expect(validarReserva(doc)?.hosts).toEqual({});
    expect(entradaDaReserva(doc, "loja-a.exemplo")).toBeNull();
  });

  it.each([
    ["campo a mais (nome)", { u: U_A, k: K_PUBLICAVEL, nome: "Loja A" }],
    ["campo a mais (estado)", { u: U_A, k: K_PUBLICAVEL, estado: "ativa" }],
    ["sem k", { u: U_A }],
    ["sem u", { k: K_PUBLICAVEL }],
    ["entrada null", null],
    ["entrada lista", [U_A, K_PUBLICAVEL]],
  ])("recusa entrada fora do formato {u, k}: %s", (_rotulo, entrada) => {
    const doc = soComEntrada(entrada);
    expect(validarReserva(doc)?.hosts).toEqual({});
    expect(entradaDaReserva(doc, "loja-a.exemplo")).toBeNull();
  });

  it.each([
    ["maiúscula", "Loja-A.exemplo"],
    ["porta", "loja-a.exemplo:443"],
    ["barra", "loja-a.exemplo/"],
    ["caminho", "loja-a.exemplo/x"],
    ["ponto final", "loja-a.exemplo."],
    ["protocolo", "https://loja-a.exemplo"],
    ["credencial", "x@loja-a.exemplo"],
    ["espaço", " loja-a.exemplo"],
    ["sem ponto", "localhost"],
    ["sublinhado", "loja_a.exemplo"],
    ["__proto__", "__proto__"],
    ["IPv4 em hexadecimal (URL reescreve)", "0x7f.1"],
    ["hífen no fim do rótulo (fora da forma DNS)", "loja-.exemplo"],
    ["hífen no começo do rótulo (fora da forma DNS)", "-loja.exemplo"],
    ["rótulo vazio", "loja..exemplo"],
    ["vazio", ""],
  ])("recusa host que não está normalizado: %s", (_rotulo, host) => {
    // `JSON.parse` cria `__proto__` como chave PRÓPRIA (o caminho real).
    const doc = JSON.parse(
      JSON.stringify(documento({})).replace(
        '"hosts":{}',
        `"hosts":${JSON.stringify({ [host]: { u: U_A, k: K_PUBLICAVEL } })}`,
      ),
    );
    expect(Object.keys(doc.hosts)).toEqual([host]);
    expect(validarReserva(doc)?.hosts).toEqual({});
    expect(entradaDaReserva(doc, host)).toBeNull();
  });

  it("o host normalizado aqui é o MESMO que o porteiro calcula (normalizarHost)", () => {
    const aceitos = ["loja-a.exemplo", "www.loja-a.exemplo", "1.2.3.4"];
    for (const host of aceitos) {
      expect(normalizarHost(new URL(`https://${host}`))).toBe(host);
      expect(
        entradaDaReserva(
          documento({ [host]: { u: U_A, k: K_PUBLICAVEL } }),
          host,
        ),
      ).not.toBeNull();
    }
    // E o que o porteiro reescreve, a reserva recusa como chave.
    for (const host of ["Loja-A.exemplo", "loja-a.exemplo.", "0x7f.1"]) {
      expect(normalizarHost(new URL(`https://${host}`))).not.toBe(host);
    }
  });
});

describe("reserva da caderneta — uma entrada ruim não derruba as boas", () => {
  it("a entrada inválida some e as válidas continuam", () => {
    const doc = documento({
      "loja-a.exemplo": { u: U_A, k: K_PUBLICAVEL },
      "loja-ruim.exemplo": { u: U_B, k: jwtDeTeste("service_role") },
      "LOJA-C.exemplo": { u: U_B, k: K_PUBLICAVEL },
      "loja-b.exemplo": { u: U_B, k: jwtDeTeste("anon") },
    });
    const reserva = validarReserva(doc);
    expect(Object.keys(reserva?.hosts ?? {}).sort()).toEqual([
      "loja-a.exemplo",
      "loja-b.exemplo",
    ]);
    expect(entradaDaReserva(doc, "loja-a.exemplo")).toEqual({
      supabaseUrl: U_A,
      publishableKey: K_PUBLICAVEL,
    });
    expect(entradaDaReserva(doc, "loja-ruim.exemplo")).toBeNull();
  });
});

describe("entradaDaReserva — só o host exato", () => {
  it("devolve a conexão do host pedido, no formato ConexaoDaLoja", () => {
    expect(entradaDaReserva(VALIDO, "loja-b.exemplo")).toEqual({
      supabaseUrl: U_B,
      publishableKey: jwtDeTeste("anon"),
    });
  });

  it("funciona igual sobre o documento cru e sobre a saída de validarReserva", () => {
    const reserva = validarReserva(VALIDO);
    expect(entradaDaReserva(reserva, "loja-a.exemplo")).toEqual(
      entradaDaReserva(VALIDO, "loja-a.exemplo"),
    );
  });

  it.each([
    ["subdomínio", "www.loja-a.exemplo"],
    ["domínio pai", "exemplo"],
    ["maiúscula no pedido", "LOJA-A.exemplo"],
    ["ponto final no pedido", "loja-a.exemplo."],
    ["porta no pedido", "loja-a.exemplo:443"],
    ["host desconhecido", "loja-z.exemplo"],
    ["herdado do protótipo", "constructor"],
    ["herdado do protótipo (toString)", "toString"],
  ])("não devolve nada para host que não é o exato: %s", (_rotulo, host) => {
    expect(entradaDaReserva(VALIDO, host)).toBeNull();
  });

  it("sem documento (reserva desligada ou não lida) devolve null", () => {
    expect(entradaDaReserva(undefined, "loja-a.exemplo")).toBeNull();
    expect(entradaDaReserva(null, "loja-a.exemplo")).toBeNull();
  });

  it("host __proto__ no documento não contamina o protótipo de ninguém", () => {
    const doc = JSON.parse(
      `{"v":1,"gerada_em":"x","sha":"y","hosts":{"__proto__":{"u":"${U_A}","k":"${K_PUBLICAVEL}"}}}`,
    );
    const reserva = validarReserva(doc);
    expect(Object.keys(reserva?.hosts ?? {})).toEqual([]);
    expect(({} as Record<string, unknown>).u).toBeUndefined();
  });
});

describe("reserva da caderneta — custo", () => {
  it("2000 hosts são validados em menos de 50 ms", () => {
    const anon = jwtDeTeste("anon");
    const hosts: Record<string, { u: string; k: string }> = {};
    for (let i = 0; i < 2000; i++) {
      hosts[`loja-${i}.exemplo`] = {
        u: U_A,
        k: i % 2 === 0 ? `${K_PUBLICAVEL}_${i}` : anon,
      };
    }
    const doc = JSON.parse(JSON.stringify(documento(hosts)));
    const inicio = performance.now();
    const reserva = validarReserva(doc);
    const gasto = performance.now() - inicio;
    expect(Object.keys(reserva?.hosts ?? {})).toHaveLength(2000);
    expect(gasto).toBeLessThan(50);
  });
});
