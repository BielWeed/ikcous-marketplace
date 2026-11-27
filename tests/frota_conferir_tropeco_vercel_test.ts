// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/conferir-frota.mjs — UM TROPEÇO PASSAGEIRO NÃO DERRUBA A FROTA
 * (achados 4c e 2' da caça "frota com 300 lojas", 26/11/2026).
 *
 * 4c: com 300 lojas a lista de aliases da Vercel vem em ~7 páginas. Uma única
 * falha passageira do `vercel api` numa delas, DEPOIS do promote, deixava a
 * lista incompleta, 400-600 endereços "sondados antes, mas não depois", e a
 * conferência imprimia FALHOU com o rollback da frota inteira. Agora cada
 * leitura da Vercel que LANÇA é refeita (pausas de ESPERAS_DA_NOVA_TENTATIVA_MS);
 * resposta que chegou fora do contrato (`{}`) não se repete: é defeito, não
 * tropeço. A leitura do título no BANCO repete só rede, tempo esgotado e 5xx.
 *
 * 2': o workflow frota-conferir.yml tinha 10 min de teto; com 600 endereços e
 * 10% pendurados até o fim das novas tentativas, a conferência estourava.
 *
 * Dublês com dados inventados: nenhuma rede, nenhum CLI, nenhuma pausa real.
 */
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CONCORRENCIA_DA_SONDA,
  ESPERAS_DA_NOVA_TENTATIVA_MS,
  TIMEOUT_DA_SONDA_MS,
  comNovasTentativasNaVercel,
  conferirFrota,
  inventariar,
  lerTituloNoBanco,
} from "../scripts/frota/conferir-frota.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = join(RAIZ, ".github/workflows/frota-conferir.yml");

const SHA = "b".repeat(40);
const IDENT = "c".repeat(64);
const DPL = "dpl_NOVO123";
const PROJETO = "prj_X";
const POLITICA = {
  projetoVercel: { id: PROJETO, time: "team_Y" },
  enderecosEsperados: [],
  aliasesDePreview: [],
  enderecosDeReserva: [],
};

// ---------------------------------------------------------------- 300 lojas falsas

const LETRAS = "abcdefghijklmnopqrstuvwxyz";
/** Ref Supabase (20 minúsculas) único por loja. */
const refDa = (i) =>
  `loja${[3, 2, 1, 0].map((k) => LETRAS[Math.floor(i / 26 ** k) % 26]).join("")}${"z".repeat(12)}`;

function frota(n = 300, { titulos = {} } = {}) {
  const lojas = new Map();
  const dominios = [];
  for (let i = 0; i < n; i++) {
    const canonico = `loja-${i}.com.br`;
    const loja = {
      i,
      ref: refDa(i),
      canonico,
      titulo: titulos[i] ?? `Loja ${i} | Cidade${i}, SP`,
    };
    for (const d of [canonico, `loja-${i}.vercel.app`]) {
      lojas.set(d, loja);
      dominios.push(d);
    }
  }
  return { lojas, dominios };
}

/** Os endereços respondem como o porteiro; o banco, como o PostgREST. */
function fetchDaFrota(lojas, { bancos = {} } = {}) {
  return async (url) => {
    const u = new URL(url);
    if (u.hostname.endsWith(".supabase.co")) {
      const banco = bancos[u.hostname.split(".")[0]];
      if (typeof banco === "function") return banco();
      return new Response("[]", { status: 200 });
    }
    const loja = lojas.get(u.hostname);
    if (!loja) return new Response("x", { status: 404 });
    if (u.pathname === "/version.json")
      return new Response(
        JSON.stringify({
          codeVersion: "1.5.240",
          codeSha: SHA,
          identityRevision: IDENT,
          version: `1.5.240-sha.${SHA.slice(0, 7)}-identity.${IDENT}`,
          source: "database",
          promotable: true,
        }),
      );
    const ficha = JSON.stringify({
      identidade: { publicUrl: `https://${loja.canonico}` },
      conexao: { publishableKey: `sb_publishable_${loja.ref}` },
    });
    return new Response(
      `<title>${loja.titulo}</title><img src="https://${loja.ref}.supabase.co/a"><script id="ikcous-loja">${ficha}</script>`,
      {
        headers: { "x-ikcous-caderneta": "hit", "x-ikcous-porteiro": "ok" },
      },
    );
  };
}

/**
 * A Vercel como ela é: ordem decrescente por createdAt, `until` = "estritamente
 * menor que", `limit` itens por página, next = createdAt do último. A página é
 * decidida pelo `until` do pedido (nunca pela contagem de chamadas), então a
 * nova tentativa recebe a MESMA página. `falhasPorPagina[n]` = quantas vezes a
 * n-ésima página (1 = a primeira) LANÇA antes de responder; `respostaDaPagina[n]`
 * troca a resposta dela (fora do contrato).
 */
function vercelFalsa(
  dominios,
  { falhasPorPagina = {}, falhasDoProjeto = 0, respostaDaPagina = {} } = {},
) {
  const itens = dominios.map((alias, k) => ({
    alias,
    deploymentId: DPL,
    projectId: PROJETO,
    createdAt: 1e12 - k,
  }));
  const paginas = []; // caminhos distintos, na ordem em que foram pedidos
  const tentativas = new Map();
  const chamadas = { paginas: [], projeto: 0 };
  const executor = async (caminho) => {
    if (caminho.startsWith("/v9/projects/")) {
      chamadas.projeto++;
      if (chamadas.projeto <= falhasDoProjeto)
        throw new Error("vercel api falhou: socket hang up");
      return { targets: { production: { id: DPL } } };
    }
    if (!caminho.startsWith("/v4/aliases?"))
      throw new Error(`caminho inesperado ${caminho}`);
    chamadas.paginas.push(caminho);
    if (!paginas.includes(caminho)) paginas.push(caminho);
    const numero = paginas.indexOf(caminho) + 1;
    const vez = (tentativas.get(caminho) ?? 0) + 1;
    tentativas.set(caminho, vez);
    if (vez <= (falhasPorPagina[numero] ?? 0))
      throw new Error("vercel api falhou: socket hang up");
    if (numero in respostaDaPagina) return respostaDaPagina[numero];
    const q = new URL(`https://x${caminho}`).searchParams;
    const limite = Number(q.get("limit"));
    const ate = q.has("until")
      ? Number(q.get("until"))
      : Number.POSITIVE_INFINITY;
    const resto = itens.filter((a) => a.createdAt < ate);
    const pagina = resto.slice(0, limite);
    return {
      aliases: pagina,
      pagination: {
        next: resto.length > limite ? pagina.at(-1).createdAt : null,
      },
    };
  };
  return { executor, chamadas, tentativas: () => [...tentativas.values()] };
}

function relogio() {
  const esperas = [];
  return { esperas, esperar: async (ms) => void esperas.push(ms) };
}

const TERCEIRA = 3;

// ---------------------------------------------------------------- T1 o embrulho

Deno.test("comNovasTentativasNaVercel: repete SÓ quando o executor lança, com as pausas da lista, e relança o último erro", async () => {
  const { esperas, esperar } = relogio();
  let n = 0;
  const instavel = async (caminho) => {
    n++;
    if (n < 3) throw new Error(`tropeço ${n}`);
    return { caminho };
  };
  const embrulhado = comNovasTentativasNaVercel(
    instavel,
    [2000, 5000],
    esperar,
  );
  assertEquals(await embrulhado("/a"), { caminho: "/a" });
  assertEquals(n, 3);
  assertEquals(esperas, [2000, 5000]);

  // sempre lança: 3 tentativas, e o erro que sai é o da ÚLTIMA
  const outro = relogio();
  let m = 0;
  const morto = comNovasTentativasNaVercel(
    async () => {
      m++;
      throw new Error(`tropeço ${m}`);
    },
    [2000, 5000],
    outro.esperar,
  );
  await assertRejects(() => morto("/b"), Error, "tropeço 3");
  assertEquals(m, 3);
  assertEquals(outro.esperas, [2000, 5000]);

  // resposta fora do contrato ({}, null) NÃO se repete: volta como veio
  for (const resposta of [{}, null]) {
    const r = relogio();
    let chamadas = 0;
    const foraDoContrato = comNovasTentativasNaVercel(
      async () => {
        chamadas++;
        return resposta;
      },
      [2000, 5000],
      r.esperar,
    );
    assertEquals(await foraDoContrato("/c"), resposta);
    assertEquals(chamadas, 1);
    assertEquals(r.esperas, []);
  }
});

Deno.test("inventariar --vercel (300 lojas): a 3ª página lança 1 vez e a lista sai COMPLETA, com 1 pausa de 2 s", async () => {
  const { lojas, dominios } = frota();
  const vercel = vercelFalsa(dominios, { falhasPorPagina: { [TERCEIRA]: 1 } });
  const { esperas, esperar } = relogio();
  const inv = await inventariar(POLITICA, {
    pedirVercel: true,
    executorVercel: vercel.executor,
    fetchImpl: fetchDaFrota(lojas),
    esperar,
  });
  assertEquals(inv.vercel.ok, true, inv.vercel.erro);
  assertEquals(inv.vercel.listaCompleta, true);
  assertEquals(inv.completo, true);
  assertEquals(inv.motivoParcial, null);
  assertEquals(inv.dominios.length, 600);
  assertEquals(esperas, [2000]);
  assertEquals(inv.vercel.avisos, []);
});

Deno.test("inventariar --vercel: a produção oficial (/v9/projects) lança 1 vez e é lida na nova tentativa", async () => {
  const { lojas, dominios } = frota(5);
  const vercel = vercelFalsa(dominios, { falhasDoProjeto: 1 });
  const { esperas, esperar } = relogio();
  const inv = await inventariar(POLITICA, {
    pedirVercel: true,
    executorVercel: vercel.executor,
    fetchImpl: fetchDaFrota(lojas),
    esperar,
  });
  assertEquals(inv.vercel.ok, true, inv.vercel.erro);
  assertEquals(inv.vercel.producaoOficial, DPL);
  assertEquals(vercel.chamadas.projeto, 2);
  assertEquals(esperas, [2000]);
});

Deno.test("inventariar --vercel (300 lojas): a 3ª página lança 3 vezes = lista INCOMPLETA, pausas [2000, 5000], sem 4ª tentativa", async () => {
  const { lojas, dominios } = frota();
  const vercel = vercelFalsa(dominios, { falhasPorPagina: { [TERCEIRA]: 9 } });
  const { esperas, esperar } = relogio();
  const inv = await inventariar(POLITICA, {
    pedirVercel: true,
    executorVercel: vercel.executor,
    fetchImpl: fetchDaFrota(lojas),
    esperar,
  });
  assertEquals(inv.vercel.ok, true);
  assertEquals(inv.vercel.listaCompleta, false);
  assertEquals(inv.completo, false);
  assertEquals(
    inv.motivoParcial,
    "a lista de aliases da Vercel veio incompleta",
  );
  assertEquals(esperas, [...ESPERAS_DA_NOVA_TENTATIVA_MS]);
  // páginas 1 e 2 uma vez cada; a 3ª, exatamente 3 vezes; nenhuma depois dela
  assertEquals(vercel.tentativas(), [1, 1, 3]);
});

Deno.test("inventariar --vercel: página que chega fora do contrato ({}) NÃO se repete e reprova a lista", async () => {
  const { lojas, dominios } = frota(5);
  const vercel = vercelFalsa(dominios, { respostaDaPagina: { 1: {} } });
  const { esperas, esperar } = relogio();
  const inv = await inventariar(POLITICA, {
    pedirVercel: true,
    executorVercel: vercel.executor,
    fetchImpl: fetchDaFrota(lojas),
    esperar,
  });
  assertEquals(inv.vercel.ok, false);
  assertEquals(inv.origem, "reserva");
  assertEquals(vercel.chamadas.paginas.length, 1);
  assertEquals(esperas, []);
});

// ---------------------------------------------------------------- T2 ponta a ponta

async function conferirDepoisDoPromote(opcoesDaVercel) {
  const { lojas, dominios } = frota();
  const vercel = vercelFalsa(dominios, opcoesDaVercel);
  const { esperas, esperar } = relogio();
  const pos = await conferirFrota(POLITICA, {
    sha: SHA,
    pedirVercel: true,
    executorVercel: vercel.executor,
    fetchImpl: fetchDaFrota(lojas),
    esperar,
    dominiosDeLojasAntes: dominios,
    lojasObrigatorias: [],
  });
  return { pos, esperas };
}

Deno.test("conferirFrota depois do promote (600 endereços): 1 falha passageira na 3ª página = ok, nada 'não sondado', sem rollback", async () => {
  const { pos, esperas } = await conferirDepoisDoPromote({
    falhasPorPagina: { [TERCEIRA]: 1 },
  });
  assertEquals(pos.ok, true, pos.relatorio.slice(0, 2000));
  assertEquals(pos.inventario.completo, true);
  assertEquals(pos.vercel.producaoOficial, DPL);
  assertEquals(pos.cobertura.dominiosNaoSondados, []);
  assertEquals(esperas, [2000]);
});

Deno.test("conferirFrota depois do promote: controle — a 1ª página lança 3 vezes = NÃO ok (a nova tentativa não esconde Vercel fora do ar)", async () => {
  const { pos, esperas } = await conferirDepoisDoPromote({
    falhasPorPagina: { 1: 3 },
  });
  assertEquals(pos.ok, false);
  assertEquals(pos.vercel.ok, false);
  assertEquals(pos.inventario.origem, "reserva");
  assertEquals(pos.cobertura.dominiosNaoSondados.length, 600);
  assertEquals(esperas, [2000, 5000]);
});

// ---------------------------------------------------------------- T3 título no banco

const REF = refDa(7);
const CHAVE = `sb_publishable_${REF}`;
const LINHA = {
  store_name: "Bella Modas",
  store_city: null,
  store_state: null,
};
const linhas = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status });

/** fetch do banco: cada pedido consome a próxima resposta da lista (função = lança). */
function bancoEmSequencia(respostas) {
  const pedidos = [];
  const fetchImpl = async (url) => {
    pedidos.push(url);
    const r = respostas[Math.min(pedidos.length, respostas.length) - 1];
    return typeof r === "function" ? r() : r.clone();
  };
  return { fetchImpl, pedidos };
}

const semRede = () => {
  throw new TypeError("fetch failed");
};
const tempoEsgotado = () => {
  throw new DOMException("signal timed out", "TimeoutError");
};

Deno.test("lerTituloNoBanco: rede, tempo esgotado e 5xx são refeitos (pausas injetadas) e a 2ª resposta vale", async () => {
  const casos = {
    "rede caiu": semRede,
    "tempo esgotado": tempoEsgotado,
    "HTTP 503": linhas({ message: "x" }, 503),
    "HTTP 500": linhas({ message: "x" }, 500),
  };
  for (const [nome, primeira] of Object.entries(casos)) {
    const { fetchImpl, pedidos } = bancoEmSequencia([
      primeira,
      linhas([LINHA]),
    ]);
    const { esperas, esperar } = relogio();
    assertEquals(
      await lerTituloNoBanco(REF, CHAVE, { fetchImpl, esperar }),
      "Bella Modas",
      nome,
    );
    assertEquals(pedidos.length, 2, nome);
    assertEquals(esperas, [2000], nome);
  }
});

Deno.test("lerTituloNoBanco: 3 falhas seguidas = null, com as pausas [2000, 5000] e nenhuma 4ª tentativa", async () => {
  for (const falha of [semRede, linhas({}, 502)]) {
    const { fetchImpl, pedidos } = bancoEmSequencia([falha]);
    const { esperas, esperar } = relogio();
    assertEquals(
      await lerTituloNoBanco(REF, CHAVE, { fetchImpl, esperar }),
      null,
    );
    assertEquals(pedidos.length, 3);
    assertEquals(esperas, [2000, 5000]);
  }
  // esperas próprias valem
  const { fetchImpl, pedidos } = bancoEmSequencia([semRede]);
  const { esperas, esperar } = relogio();
  assertEquals(
    await lerTituloNoBanco(REF, CHAVE, {
      fetchImpl,
      esperar,
      esperasDeNovaTentativaMs: [10],
    }),
    null,
  );
  assertEquals(pedidos.length, 2);
  assertEquals(esperas, [10]);
});

Deno.test("lerTituloNoBanco: resposta que contradiz (401, 404, 0 linhas, 2 linhas, não-JSON) NÃO se repete: null de primeira", async () => {
  const casos = {
    "401 (chave de outro projeto)": linhas({ message: "Invalid API key" }, 401),
    "404": linhas({}, 404),
    "200 com 0 linhas": linhas([]),
    "200 com 2 linhas": linhas([LINHA, LINHA]),
    "200 que não é JSON": new Response("<html>", { status: 200 }),
  };
  for (const [nome, resposta] of Object.entries(casos)) {
    const { fetchImpl, pedidos } = bancoEmSequencia([
      resposta,
      linhas([LINHA]),
    ]);
    const { esperas, esperar } = relogio();
    assertEquals(
      await lerTituloNoBanco(REF, CHAVE, { fetchImpl, esperar }),
      null,
      nome,
    );
    assertEquals(pedidos.length, 1, nome);
    assertEquals(esperas, [], nome);
  }
});

Deno.test("conferirFrota passa `esperar` à leitura do banco: título repetido confirmado depois de 1 tropeço (503) do banco", async () => {
  // as lojas 0 e 1 se chamam igual; o banco de cada uma confirma o próprio título
  const { lojas, dominios } = frota(3, {
    titulos: { 0: "Bella Modas", 1: "Bella Modas" },
  });
  let tropecos = 0;
  const bancos = {
    [refDa(0)]: () => linhas([LINHA]),
    [refDa(1)]: () =>
      tropecos++ === 0 ? linhas({ message: "x" }, 503) : linhas([LINHA]),
  };
  const { esperas, esperar } = relogio();
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchDaFrota(lojas, { bancos }),
    esperar,
    enderecosExtras: dominios,
  });
  assertEquals(
    r.resultados.map((x) => x.classe),
    dominios.map(() => "OK"),
    r.relatorio.slice(0, 3000),
  );
  assertEquals(tropecos, 2);
  assertEquals(esperas, [2000]);
});

// ---------------------------------------------------------------- T4 teto do workflow

Deno.test("workflow frota-conferir: o teto de tempo cobre 600 endereços com 10% pendurados até o fim das novas tentativas", () => {
  const yaml = Deno.readTextFileSync(WORKFLOW);
  const tetos = [...yaml.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)].map(
    (m) => Number(m[1]),
  );
  assertEquals(tetos.length, 1, "um job só, com um teto só");
  // Endereço morto: cada pedido estoura o tempo, em todas as tentativas, com as
  // pausas entre elas (os pedidos de um endereço correm em paralelo).
  const tentativas = ESPERAS_DA_NOVA_TENTATIVA_MS.length + 1;
  const mortoMs =
    tentativas * TIMEOUT_DA_SONDA_MS +
    ESPERAS_DA_NOVA_TENTATIVA_MS.reduce((a, b) => a + b, 0);
  assertEquals(mortoMs, 52000);
  // Endereço vivo: ~1 ida e volta (suposição: 1 s). 600 endereços, 10% mortos,
  // CONCORRENCIA_DA_SONDA endereços por vez; margem de 100% sobre a estimativa.
  const enderecos = 600;
  const mortos = enderecos * 0.1;
  const estimativaMs =
    (mortos * mortoMs + (enderecos - mortos) * 1000) / CONCORRENCIA_DA_SONDA;
  assert(estimativaMs / 60000 > 10, "o teto antigo (10 min) não cabia");
  const minimo = Math.ceil((2 * estimativaMs) / 60000);
  assertEquals(minimo, 21);
  assert(tetos[0] >= minimo, `timeout-minutes ${tetos[0]} < ${minimo}`);
});
