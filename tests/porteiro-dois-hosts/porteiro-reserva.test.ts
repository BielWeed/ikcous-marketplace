// porteiro-reserva.test.ts — a prova ponta a ponta da RESERVA da caderneta
// (T11 do plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`): com a caderneta
// INALCANÇÁVEL, cada host abre a SUA loja pela reserva; a reserva que aponta um
// host para o banco de outra loja dá 503 `discorda`; quando a caderneta volta,
// `hit`. Tudo pelo `middleware()` REAL, no mesmo servidor de ensaio dos outros
// arquivos desta pasta (`servidor.ts`), com `node:http` por IP e o `Host` na
// própria requisição.
//
// Os dublês: a caderneta é a RPC do `servidor.ts`, que passa a lançar
// `TypeError: fetch failed` (o que o `fetch` do Node faz com um endereço que
// não resolve) enquanto `deixarCadernetaInalcancavel(true)`; os bancos das
// lojas são os de brinquedo do mesmo arquivo; a Global Config é o pacote
// `@vercel/global-config` dublado (`vi.mock`), atrás do leitor REAL
// (`src/hospedagem/leitorDaReserva.ts`: forma da conexão, `validarReserva`,
// cache). Nada sai para a rede.
//
// SUPOSIÇÕES DE ESTADO (em voz alta):
// - Os testes rodam em ORDEM e compartilham o cache de módulo do porteiro
//   (um registro de módulos por arquivo no Vitest): cada um parte do estado
//   que o anterior deixou, e é por isso que o relógio é controlado. Só o
//   `Date` é falso (`toFake: ["Date"]`): os temporizadores de verdade (prazo
//   da caderneta, prazo da reserva, `node:http`) seguem reais.
// - O leitor da reserva guarda um cliente e um cache POR CONEXÃO
//   (`leitorDaReservaDoAmbiente`): cada teste usa uma `GLOBAL_CONFIG` nova,
//   para o documento de um não responder pelo outro.
// - O `servidor.ts` chama `middleware()` sem `context`: sem `waitUntil`, a
//   ficha passada dos 60 s espera a caderneta na hora (é o que faz o `hit`
//   aparecer na primeira visita depois que ela volta).
// Domínios, refs e chaves são INVENTADOS (repositório público).

import { existsSync } from "node:fs";
import http from "node:http";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createClient, get } = vi.hoisted(() => {
  const get = vi.fn<(chave: string) => Promise<unknown>>();
  const createClient = vi.fn((_conexao: string, _opcoes?: unknown) => ({
    get,
  }));
  return { createClient, get };
});
vi.mock("@vercel/global-config", () => ({ createClient }));

import {
  CACHE_FRESCO_MS,
  CACHE_STALE_MAX_MS,
} from "../../src/hospedagem/porteiro.ts";
import { CHAVE_DA_RESERVA } from "../../src/hospedagem/reservaDaCaderneta.ts";
import { CAMINHO_DA_SONDA } from "../../src/hospedagem/sondaDoCandidato.ts";
import {
  DIST_TEST_DIR,
  FROTA_URL,
  HOSTS,
  ORIGEM_RESERVA_A,
  ORIGEM_RESERVA_B,
  deixarCadernetaInalcancavel,
  iniciarServidorDoisHosts,
  pedidosAoDuble,
} from "./servidor.ts";

const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST_TEST_DIR é a constante exportada por `servidor.ts`, nunca entrada externa.
if (!existsSync(DIST_TEST_DIR)) {
  throw new Error(
    `PORTEIRO_RESERVA_SEM_DIST_TEST: rode \`${COMANDO_DE_BUILD}\` na raiz ` +
      `do repositório antes desta suíte (dist-test/ não existe em ${DIST_TEST_DIR}).`,
  );
}

// O mesmo `pedir` dos outros arquivos desta pasta: `node:http` por IP com o
// `Host` escrito na requisição (`fetch` do Node recusa `Host`, e `*.localhost`
// não resolve por DNS no Node).
function pedir(
  porta: number,
  host: string,
  caminho: string,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  corpo: string;
}> {
  return new Promise((resolve, reject) => {
    const requisicao = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        method: "GET",
        headers: { Host: host },
      },
      (resposta) => {
        const pedacos: Buffer[] = [];
        resposta.on("data", (pedaco: Buffer) => pedacos.push(pedaco));
        resposta.on("end", () =>
          resolve({
            status: resposta.statusCode ?? 0,
            headers: resposta.headers,
            corpo: Buffer.concat(pedacos).toString("utf-8"),
          }),
        );
      },
    );
    requisicao.on("error", reject);
    requisicao.end();
  });
}

function lerDataBlock(html: string): {
  host: string;
  identidade: { identity: { storeName: string } };
  conexao: { supabaseUrl: string };
} {
  const casado = html.match(
    /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
  );
  expect(casado).not.toBeNull();
  return JSON.parse(casado![1]!);
}

// Montado por partes para nenhum detector de segredo confundir o fixture.
const TOKEN = ["tok", "inventado", "RESERVA", "e2e"].join("_");
let sequencia = 0;
/** Uma conexão NOVA por teste (o leitor guarda cliente e cache por conexão). */
function conexaoNova(): string {
  sequencia += 1;
  return `https://global-config.vercel.com/ecfg_reservae2e${sequencia}?token=${TOKEN}`;
}

/** Tira a variável (atribuir `undefined` a `process.env` grava o TEXTO
 * "undefined", que o leitor trataria como conexão). */
function desligarReserva(): void {
  Reflect.deleteProperty(process.env, "GLOBAL_CONFIG");
}

const LOJA_A = {
  host: HOSTS.RESERVA_A,
  nome: "Loja Reserva A",
  origem: ORIGEM_RESERVA_A,
  ref: "i".repeat(20),
  chave: "sb_publishable_loja_reserva_a",
} as const;
const LOJA_B = {
  host: HOSTS.RESERVA_B,
  nome: "Loja Reserva B",
  origem: ORIGEM_RESERVA_B,
  ref: "j".repeat(20),
  chave: "sb_publishable_loja_reserva_b",
} as const;
/** Um host que SÓ a reserva conhece, apontado para o banco de B. */
const HOST_TROCADO_SO_NA_RESERVA = "loja-reserva-trocada.localhost";

function documento(hosts: Record<string, { u: string; k: string }>) {
  return {
    v: 1,
    gerada_em: "2026-11-26T12:00:00.000Z",
    sha: "0123456789abcdef0123456789abcdef01234567",
    hosts,
  };
}
const RESERVA_CERTA = documento({
  [LOJA_A.host]: { u: LOJA_A.origem, k: LOJA_A.chave },
  [LOJA_B.host]: { u: LOJA_B.origem, k: LOJA_B.chave },
});

/** O que a página de B carregaria e o host de A nunca pode receber. */
function semNadaDeB(corpo: string): void {
  expect(corpo).not.toContain(LOJA_B.nome);
  expect(corpo).not.toContain(LOJA_B.origem);
  expect(corpo).not.toContain(LOJA_B.chave);
}

function abriuAPropriaLoja(
  resposta: Awaited<ReturnType<typeof pedir>>,
  loja: typeof LOJA_A | typeof LOJA_B,
  outra: typeof LOJA_A | typeof LOJA_B,
  caderneta: "reserva" | "hit",
): void {
  expect(resposta.status).toBe(200);
  expect(resposta.headers["x-ikcous-porteiro"]).toBe("ok");
  expect(resposta.headers["x-ikcous-caderneta"]).toBe(caderneta);
  expect(resposta.corpo).toContain(`<title>${loja.nome}</title>`);
  const ficha = lerDataBlock(resposta.corpo);
  expect(ficha.host).toBe(loja.host);
  expect(ficha.identidade.identity.storeName).toBe(loja.nome);
  expect(ficha.conexao.supabaseUrl).toBe(loja.origem);
  expect(resposta.corpo).not.toContain(outra.nome);
  expect(resposta.corpo).not.toContain(outra.origem);
  expect(resposta.corpo).not.toContain(outra.chave);
}

function perguntasACaderneta(): number {
  return pedidosAoDuble.filter((endereco) =>
    endereco.startsWith(`${FROTA_URL}/rest/v1/rpc/`),
  ).length;
}

/** O JSON da sonda do candidato para um host. */
async function sondar(porta: number, host: string) {
  const resposta = await pedir(
    porta,
    HOSTS.CANDIDATO,
    `${CAMINHO_DA_SONDA}?host=${host}`,
  );
  expect(resposta.status).toBe(200);
  return JSON.parse(resposta.corpo) as Record<string, string | null>;
}

describe("porteiro-reserva — a reserva da caderneta ponta a ponta (T11)", () => {
  let servidor: { porta: number; fechar(): Promise<void> };
  // O relógio do ensaio: só avança quando o teste manda.
  let agora = Date.UTC(2026, 11, 1, 12, 0, 0);
  const avancar = (ms: number) => {
    agora += ms;
    vi.setSystemTime(agora);
  };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(agora);
    servidor = await iniciarServidorDoisHosts();
  });

  afterAll(async () => {
    await servidor.fechar();
    desligarReserva();
    vi.useRealTimers();
  });

  beforeEach(() => {
    createClient.mockClear();
    get.mockReset();
    // O porteiro e o leitor escrevem uma linha por falha/recuo: esperado aqui.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });

  it("reserva que aponta o host A para o banco de B: 503 discorda, e nunca a página de B", async () => {
    deixarCadernetaInalcancavel(true);
    process.env.GLOBAL_CONFIG = conexaoNova();
    get.mockResolvedValue(
      documento({ [LOJA_A.host]: { u: LOJA_B.origem, k: LOJA_B.chave } }),
    );
    const antes = perguntasACaderneta();

    const resposta = await pedir(servidor.porta, LOJA_A.host, "/");

    expect(resposta.status).toBe(503);
    expect(resposta.headers["x-ikcous-porteiro"]).toBe("discorda");
    // A conexão desta tentativa veio da reserva (e a caderneta foi tentada).
    expect(resposta.headers["x-ikcous-caderneta"]).toBe("reserva");
    expect(perguntasACaderneta()).toBeGreaterThan(antes);
    expect(get).toHaveBeenCalledWith(CHAVE_DA_RESERVA);
    semNadaDeB(resposta.corpo);
    expect(resposta.corpo).not.toContain('id="ikcous-loja"');
  });

  it("caderneta fora + reserva válida: o host A abre a loja A e o host B abre a loja B, os dois por `reserva`", async () => {
    // Mesma caderneta fora; o `discorda` de antes não foi guardado.
    process.env.GLOBAL_CONFIG = conexaoNova();
    get.mockResolvedValue(RESERVA_CERTA);

    const a = await pedir(servidor.porta, LOJA_A.host, "/");
    const b = await pedir(servidor.porta, LOJA_B.host, "/");

    abriuAPropriaLoja(a, LOJA_A, LOJA_B, "reserva");
    abriuAPropriaLoja(b, LOJA_B, LOJA_A, "reserva");
    // Uma leitura da store para os dois hosts (cache de 5 min do leitor).
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("a caderneta volta: `hit` nos dois hosts, com a mesma loja de cada um", async () => {
    deixarCadernetaInalcancavel(false);
    // A ficha nascida da reserva vale 60 s; passada essa janela, a visita
    // pergunta de novo à caderneta.
    avancar(CACHE_FRESCO_MS + 1_000);
    const antes = perguntasACaderneta();

    const a = await pedir(servidor.porta, LOJA_A.host, "/");
    const b = await pedir(servidor.porta, LOJA_B.host, "/");

    abriuAPropriaLoja(a, LOJA_A, LOJA_B, "hit");
    abriuAPropriaLoja(b, LOJA_B, LOJA_A, "hit");
    expect(perguntasACaderneta()).toBe(antes + 2);
    // Com a caderneta respondendo, a reserva nem é lida.
    expect(get).not.toHaveBeenCalled();
  });

  it("reserva indisponível (o leitor rejeita): o 503 `banco-indisponivel`/`erro` de antes da reserva", async () => {
    deixarCadernetaInalcancavel(true);
    // Passada 1 h da última ficha boa, nenhum host tem ficha que valha: é o
    // único caso em que a reserva seria lida.
    avancar(CACHE_STALE_MAX_MS + 60_000);

    // Host A: reserva ligada, mas a store falha.
    process.env.GLOBAL_CONFIG = conexaoNova();
    get.mockRejectedValue(new Error("store fora do ar"));
    const comLeitorQueFalha = await pedir(servidor.porta, LOJA_A.host, "/");
    expect(get).toHaveBeenCalledTimes(1);

    // Host B: reserva DESLIGADA (sem `GLOBAL_CONFIG`) — o comportamento de
    // antes da reserva existir, para comparar.
    desligarReserva();
    const semReserva = await pedir(servidor.porta, LOJA_B.host, "/");

    for (const resposta of [comLeitorQueFalha, semReserva]) {
      expect(resposta.status).toBe(503);
      expect(resposta.headers["x-ikcous-porteiro"]).toBe("banco-indisponivel");
      expect(resposta.headers["x-ikcous-caderneta"]).toBe("erro");
      expect(resposta.corpo).not.toContain('id="ikcous-loja"');
      expect(resposta.corpo).not.toContain(LOJA_A.nome);
      expect(resposta.corpo).not.toContain(LOJA_B.nome);
    }
    expect(comLeitorQueFalha.headers["x-ikcous-reserva"]).toBeUndefined();
  });

  it("a sonda do candidato, com a caderneta fora, diz o mesmo: `reserva` com o ref de cada loja, `discorda` no host trocado, e `hit` quando a caderneta volta", async () => {
    deixarCadernetaInalcancavel(true);
    process.env.GLOBAL_CONFIG = conexaoNova();
    get.mockResolvedValue(
      documento({
        [LOJA_A.host]: { u: LOJA_A.origem, k: LOJA_A.chave },
        [LOJA_B.host]: { u: LOJA_B.origem, k: LOJA_B.chave },
        [HOST_TROCADO_SO_NA_RESERVA]: { u: LOJA_B.origem, k: LOJA_B.chave },
      }),
    );
    const destinoDaCaderneta = new URL(FROTA_URL).hostname;

    expect(await sondar(servidor.porta, LOJA_A.host)).toEqual({
      host: LOJA_A.host,
      porteiro: "ok",
      caderneta: "reserva",
      ref: LOJA_A.ref,
      destinoDaCaderneta,
    });
    expect(await sondar(servidor.porta, LOJA_B.host)).toEqual({
      host: LOJA_B.host,
      porteiro: "ok",
      caderneta: "reserva",
      ref: LOJA_B.ref,
      destinoDaCaderneta,
    });
    expect(await sondar(servidor.porta, HOST_TROCADO_SO_NA_RESERVA)).toEqual({
      host: HOST_TROCADO_SO_NA_RESERVA,
      porteiro: "discorda",
      caderneta: "reserva",
      ref: null,
      destinoDaCaderneta,
    });
    // Uma leitura da store para as três sondas (o mesmo leitor da instância).
    expect(get).toHaveBeenCalledTimes(1);

    deixarCadernetaInalcancavel(false);
    expect(await sondar(servidor.porta, LOJA_A.host)).toEqual({
      host: LOJA_A.host,
      porteiro: "ok",
      caderneta: "hit",
      ref: LOJA_A.ref,
      destinoDaCaderneta,
    });
    expect(await sondar(servidor.porta, LOJA_B.host)).toEqual({
      host: LOJA_B.host,
      porteiro: "ok",
      caderneta: "hit",
      ref: LOJA_B.ref,
      destinoDaCaderneta,
    });
    // O host que a caderneta não conhece (`miss`) e a reserva aponta para B
    // continua fechado: nunca abre a loja B.
    const trocado = await sondar(servidor.porta, HOST_TROCADO_SO_NA_RESERVA);
    expect(trocado.porteiro).toBe("discorda");
    expect(trocado.ref).toBeNull();
  });
});
