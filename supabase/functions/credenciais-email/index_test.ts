// @ts-nocheck
// Testes da edge credenciais-email (14/10/2026) — a lojista cadastra, no
// painel, o Gmail que envia os e-mails da loja. Padrão da casa
// (credenciais-mercado-pago): handler exportado com costura de deps, NENHUMA
// rede real — o envio e a verificação do login são DUBLÊS (o SMTP real só se
// prova no ar), o banco é dublê, e toda senha aqui é de MENTIRA e legível.
//
// Afirmativas nomeadas (o que erra caro, em ordem):
//   A1  só ADMIN, em todas as quatro ações (e sem sessão, e papéis em
//       contradição, e sessão de cliente): 401 e NADA lido, gravado nem enviado
//   A2  o teste só vai para o PRÓPRIO Gmail cadastrado — nenhum destinatário
//       do corpo da requisição é usado (senão vira relé aberto de spam)
//   A3  a senha NUNCA sai: nem na resposta, nem no log, nem no que dorme no
//       banco em claro; erro do SMTP/banco que a carregue não é ecoado
//   A4  `salvar` só GRAVA depois de o login ser verificado com a senha nova
//   A5  limite de frequência (1/min e 10/dia), reservado ANTES de falar com o Google
//   A6  credencial trocada no meio do teste não deixa resultado velho no registro
//   A7  validação (só Gmail, senha de app de 16 letras), cofre ausente = 503
//   A8  `status` conta a verdade: origem, cofre pronto, saúde, sem segredo
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CHAVE_SETTINGS_EMAIL,
  lerSaudeDoEnvio,
  resolverRemetente,
} from "../_shared/email-da-loja.ts";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  capturandoLogs,
  CHAVE_CIFRA_TESTE,
  env,
  OUTRA_CHAVE_CIFRA,
  registroCifrado,
  SENHA_DO_AMBIENTE,
  SENHA_DO_PAINEL,
  USUARIO_DO_PAINEL,
} from "../_shared/email-da-loja_fixtures.ts";
import { ErroDeEnvio } from "../_shared/smtp.ts";
import { handler } from "./index.ts";

const COFRE = { MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE };
const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const GMAIL_NOVO = "Nova.Loja@Gmail.com";
// Como o Google mostra a senha de app: 4 grupos, com espaço que não quebra.
const SENHA_NOVA_COLADA = "abcd\u00a0efgh\u00a0ijkl\u00a0mnop";
const SENHA_NOVA = "abcdefghijklmnop";

function requisicao(corpo: unknown, opcoes: { auth?: string | null; metodo?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opcoes.auth !== null) headers.Authorization = opcoes.auth ?? "Bearer jwt-de-teste";
  return new Request("http://local/credenciais-email", {
    method: opcoes.metodo ?? "POST",
    headers,
    body: opcoes.metodo === "GET" ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

/** Monta o cenário: banco, relógio, dublês de envio/verificação e as deps do handler. */
function cenario(
  opcoes: {
    banco?: Parameters<typeof bancoFalso>[0];
    ambiente?: Record<string, string>;
    admin?: boolean;
    enviar?: (mensagem: any, remetente: any) => Promise<unknown>;
    verificar?: (remetente: any) => Promise<unknown>;
    tempoDoEnvioMs?: number;
  } = {},
) {
  const banco = bancoFalso(opcoes.banco);
  const relogio = { agora: T0 };
  const enviados: Array<{ mensagem: any; remetente: any }> = [];
  const verificados: any[] = [];
  const ordem: string[] = [];
  const deps = {
    supabase: banco,
    adminAtual: async () => (opcoes.admin === false ? null : "uid-admin"),
    env: env(opcoes.ambiente ?? COFRE),
    agora: () => relogio.agora,
    tempoDoEnvioMs: opcoes.tempoDoEnvioMs,
    enviarEmail: async (mensagem: any, remetente: any) => {
      ordem.push("enviar");
      enviados.push({ mensagem, remetente });
      if (opcoes.enviar) return await opcoes.enviar(mensagem, remetente);
      return { origem: remetente.origem };
    },
    verificarRemetente: async (remetente: any) => {
      ordem.push("verificar");
      verificados.push(remetente);
      if (opcoes.verificar) await opcoes.verificar(remetente);
    },
  };
  return { banco, relogio, enviados, verificados, ordem, deps };
}

async function chamar(c: ReturnType<typeof cenario>, corpo: unknown, opcoes = {}) {
  const resposta = await handler(requisicao(corpo, opcoes), c.deps);
  const texto = await resposta.text();
  let json: any = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // resposta sem JSON (OPTIONS)
  }
  return { status: resposta.status, texto, json, headers: resposta.headers };
}

const registroDoBanco = (c: ReturnType<typeof cenario>) => {
  const v = c.banco.estado.valores.get(CHAVE_SETTINGS_EMAIL);
  return v ? JSON.parse(v) : null;
};

const ACOES = ["status", "salvar", "testar", "remover"];
const SALVAR_BOM = { acao: "salvar", usuario: GMAIL_NOVO, senha: SENHA_NOVA_COLADA };

// ── A1: só admin ────────────────────────────────────────────────────────────

Deno.test("A1 — sem ser admin, NENHUMA das quatro ações faz nada: 401, nada lido, gravado, verificado nem enviado", async () => {
  for (const acao of ACOES) {
    const c = cenario({ admin: false, banco: { registro: await registroCifrado() } });
    const r = await chamar(c, { ...SALVAR_BOM, acao });
    assertEquals(r.status, 401, acao);
    assertEquals(c.banco.estado.leituras, [], acao);
    assertEquals(c.banco.estado.escritas, [], acao);
    assertEquals(c.ordem, [], acao);
    assertEquals(r.texto.includes(SENHA_DO_PAINEL), false, acao);
  }
});

Deno.test("A1 — admin NÃO é conferido por quem chama: sem Authorization o padrão (admin-atual) recusa", async () => {
  // Sem `adminAtual` injetado: vale a regra real, que sem header nem sai da máquina.
  const c = cenario();
  delete c.deps.adminAtual;
  const r = await chamar(c, { acao: "status" }, { auth: null });
  assertEquals(r.status, 401);
  assertEquals(c.banco.estado.leituras, []);
});

// A porta REAL de admin (`_shared/admin-atual.ts`) contra um Auth/PostgREST falso:
// sessão de cliente, service_role puro (sem usuário), papéis em contradição e
// o admin de verdade. É o que mata o mutante "sem checagem de admin".
function fetchDoSupabase(papelNoAuth: string | null, papelNoPerfil: string | null, userExiste = true) {
  return (async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (corpo: unknown, status = 200) =>
      new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/auth/v1/user")) {
      if (!userExiste) return json({ message: "invalid JWT" }, 401);
      return json({
        id: "uid-1",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: papelNoAuth ? { role: papelNoAuth } : {},
      });
    }
    if (url.includes("/rest/v1/profiles")) {
      return papelNoPerfil ? json({ id: "uid-1", role: papelNoPerfil }) : json({ message: "nada" }, 406);
    }
    return json({ message: "fora do roteiro" }, 404);
  }) as typeof fetch;
}

Deno.test("A1 — a porta REAL de admin: cliente, service_role sem usuário e papéis em contradição são 401; admin de verdade passa", async () => {
  const anteriores = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS"].map(
    (n) => [n, Deno.env.get(n)] as const,
  );
  Deno.env.set("SUPABASE_URL", "https://supa-fake.local");
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" }));
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" }));
  try {
    const casos: Array<[string, typeof fetch, number]> = [
      ["cliente comum", fetchDoSupabase("customer", "customer"), 401],
      ["service_role / JWT sem usuário", fetchDoSupabase(null, null, false), 401],
      ["admin só no Auth", fetchDoSupabase("admin", "customer"), 401],
      ["admin só no perfil", fetchDoSupabase("customer", "admin"), 401],
      ["admin de verdade", fetchDoSupabase("admin", "admin"), 200],
    ];
    for (const [nome, fetchImpl, esperado] of casos) {
      const c = cenario();
      delete c.deps.adminAtual;
      c.deps.fetchImpl = fetchImpl;
      const r = await chamar(c, { acao: "status" });
      assertEquals(r.status, esperado, nome);
      if (esperado === 401) assertEquals(c.banco.estado.leituras, [], nome);
    }
  } finally {
    for (const [n, v] of anteriores) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
});

// ── Forma da requisição ─────────────────────────────────────────────────────

Deno.test("método, corpo e ação: OPTIONS responde CORS; GET é 405; corpo que não é JSON é 400; ação desconhecida é 400 — e todas levam os cabeçalhos CORS", async () => {
  const c = cenario();
  const opcoes = await handler(requisicao("", { metodo: "OPTIONS" }), c.deps);
  assertEquals(opcoes.status, 200);
  assertStringIncludes(opcoes.headers.get("Access-Control-Allow-Headers") ?? "", "authorization");
  const get = await handler(requisicao("", { metodo: "GET" }), c.deps);
  assertEquals(get.status, 405);
  for (const r of [await chamar(c, "{nao-e-json"), await chamar(c, { acao: "apagar_tudo" }), await chamar(c, null)]) {
    assertEquals(r.status, 400);
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  }
});

// ── A8: status ──────────────────────────────────────────────────────────────

Deno.test("A8 status — loja sem nada: origem 'nenhuma', sem senha guardada, e diz se o cofre está pronto", async () => {
  const semCofre = await chamar(cenario({ ambiente: {} }), { acao: "status" });
  assertEquals(semCofre.status, 200);
  assertEquals(semCofre.json.origem, "nenhuma");
  assertEquals(semCofre.json.usuario, null);
  assertEquals(semCofre.json.senha_guardada, false);
  assertEquals(semCofre.json.cofre_pronto, false);
  const comCofre = await chamar(cenario(), { acao: "status" });
  assertEquals(comCofre.json.cofre_pronto, true);
  assertEquals(comCofre.json.origem, "nenhuma");
});

Deno.test("A8 status — só o ambiente (IKCOUS): origem 'ambiente', e nada do ambiente vaza", async () => {
  const r = await chamar(cenario({ ambiente: { ...COFRE, ...AMBIENTE_COMPLETO } }), { acao: "status" });
  assertEquals(r.json.origem, "ambiente");
  assertEquals(r.json.senha_guardada, false);
  assertEquals(r.texto.includes(SENHA_DO_AMBIENTE), false);
});

Deno.test("A8 status — registro do painel: usuário, senha_guardada, origem 'painel', último teste; NUNCA senha nem ciphertext nem iv", async () => {
  const registro = {
    ...(await registroCifrado()),
    ultimo_teste: { ok: true, em: "2026-10-14T11:00:00.000Z", motivo: null },
  };
  const r = await chamar(cenario({ banco: { registro } }), { acao: "status" });
  assertEquals(r.json.origem, "painel");
  assertEquals(r.json.usuario, USUARIO_DO_PAINEL);
  assertEquals(r.json.senha_guardada, true);
  assertEquals(r.json.painel_legivel, true);
  assertEquals(r.json.ultimo_teste, registro.ultimo_teste);
  for (const proibido of [SENHA_DO_PAINEL, registro.senha_cifrada, registro.iv, "senha_cifrada"]) {
    assertEquals(r.texto.includes(proibido), false, proibido);
  }
});

Deno.test("A8 status — registro existe mas o cofre sumiu: cofre_pronto false, painel_legivel false, e a origem NÃO mente 'painel'", async () => {
  const r = await chamar(
    cenario({ ambiente: {}, banco: { registro: await registroCifrado() } }),
    { acao: "status" },
  );
  assertEquals(r.json.cofre_pronto, false);
  assertEquals(r.json.senha_guardada, true);
  assertEquals(r.json.painel_legivel, false);
  assertEquals(r.json.origem, "nenhuma");
});

Deno.test("A8 status — a saúde do envio vai junto, com a frase pronta da causa (e sem texto cru)", async () => {
  const saude = {
    ultimo_envio_ok_em: "2026-10-10T10:00:00.000Z",
    ultimo_envio_ok_origem: "painel",
    ultima_falha_em: "2026-10-13T09:00:00.000Z",
    ultima_falha_origem: "painel",
    codigo_falha: "senha_errada",
    tentativas_em: ["2026-10-13T08:00:00.000Z"],
  };
  const r = await chamar(cenario({ banco: { registro: await registroCifrado(), saude } }), { acao: "status" });
  assertEquals(r.json.saude.codigo_falha, "senha_errada");
  assertEquals(r.json.saude.ultima_falha_em, saude.ultima_falha_em);
  assertEquals(r.json.saude.ultimo_envio_ok_origem, "painel");
  assertStringIncludes(r.json.saude.mensagem_da_falha, "senha");
  assertEquals("tentativas_em" in r.json.saude, false);
});

Deno.test("A8 status — banco que falha vira 500 com recado FIXO (nada do banco)", async () => {
  const c = cenario({ banco: { leitura: "erro" } });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, { acao: "status" });
  });
  assertEquals(r.status, 500);
  assertEquals(r.texto.includes("permission denied"), false);
  assertEquals(logs.includes("permission denied"), false);
});

// ── A4/A7: salvar ───────────────────────────────────────────────────────────

Deno.test("A4 salvar (caminho feliz) — verifica o login com a senha NOVA normalizada, só então grava CIFRADO, e a resposta não tem a senha", async () => {
  const c = cenario();
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, SALVAR_BOM);
  });
  assertEquals(r.status, 200);
  // A verificação usou o usuário em minúsculas e a senha limpa de espaços.
  assertEquals(c.verificados.length, 1);
  assertEquals(c.verificados[0].usuario, "nova.loja@gmail.com");
  assertEquals(c.verificados[0].senha, SENHA_NOVA);
  assertEquals(c.verificados[0].origem, "painel");
  // E ela veio ANTES de qualquer gravação do registro.
  const escritaDoRegistro = c.banco.estado.escritas.findIndex((e) => e.key === CHAVE_SETTINGS_EMAIL);
  assert(escritaDoRegistro >= 0);
  // O que dorme no banco: usuário em claro, senha SÓ cifrada.
  const dormindo = c.banco.estado.valores.get(CHAVE_SETTINGS_EMAIL);
  assertEquals(dormindo.includes(SENHA_NOVA), false);
  assertEquals(registroDoBanco(c).usuario, "nova.loja@gmail.com");
  assertEquals(registroDoBanco(c).ultimo_teste.ok, true);
  // Resposta: status novo, sem segredo.
  assertEquals(r.json.origem, "painel");
  assertEquals(r.json.senha_guardada, true);
  assertEquals(r.json.usuario, "nova.loja@gmail.com");
  for (const proibido of [SENHA_NOVA, SENHA_NOVA_COLADA, registroDoBanco(c).senha_cifrada, registroDoBanco(c).iv]) {
    assertEquals(r.texto.includes(proibido), false);
    assertEquals(logs.includes(proibido), false);
  }
  // Ida e volta: quem envia lê a MESMA senha de volta.
  const remetente = await resolverRemetente(c.banco, { env: c.deps.env });
  assertEquals(remetente.senha, SENHA_NOVA);
  assertEquals(remetente.usuario, "nova.loja@gmail.com");
});

Deno.test("A4 salvar — a verificação do login ACONTECE ANTES de gravar: ordem registrada, e a gravação do registro vem depois do verificar", async () => {
  const c = cenario();
  const fromOriginal = c.banco.from.bind(c.banco);
  c.banco.from = (t: string) => {
    const tabela = fromOriginal(t);
    return {
      ...tabela,
      upsert: (linha: any) => {
        c.ordem.push(`gravar:${linha.key}`);
        return tabela.upsert(linha);
      },
    };
  };
  await chamar(c, SALVAR_BOM);
  const iVerificar = c.ordem.indexOf("verificar");
  const iRegistro = c.ordem.indexOf(`gravar:${CHAVE_SETTINGS_EMAIL}`);
  assert(iVerificar >= 0 && iRegistro > iVerificar, c.ordem.join(" > "));
});

Deno.test("A4 salvar — o Google recusa a senha nova: 422 com a CAUSA, NADA é gravado no registro e a credencial anterior segue de pé", async () => {
  const anterior = await registroCifrado();
  const c = cenario({
    banco: { registro: anterior },
    verificar: async () => {
      throw new ErroDeEnvio({
        code: "EAUTH",
        responseCode: 535,
        response: `535-5.7.8 Username and Password not accepted ${SENHA_NOVA}`,
        message: `Invalid login ${SENHA_NOVA}`,
      });
    },
  });
  const antes = c.banco.estado.valores.get(CHAVE_SETTINGS_EMAIL);
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, SALVAR_BOM);
  });
  assertEquals(r.status, 422);
  assertEquals(r.json.motivo, "senha_errada");
  assertStringIncludes(r.json.erro, "senha");
  assertEquals(c.banco.estado.valores.get(CHAVE_SETTINGS_EMAIL), antes);
  assertEquals(
    c.banco.estado.escritas.filter((e) => e.key === CHAVE_SETTINGS_EMAIL),
    [],
  );
  for (const proibido of [SENHA_NOVA, SENHA_NOVA_COLADA]) {
    assertEquals(r.texto.includes(proibido), false);
    assertEquals(logs.includes(proibido), false);
    assertEquals([...c.banco.estado.valores.values()].join("\n").includes(proibido), false);
  }
});

Deno.test("A4 salvar — cada causa de recusa do Google vira a frase certa (senha normal, bloqueio, limite, rede)", async () => {
  const casos: Array<[any, string]> = [
    [{ code: "EAUTH", responseCode: 534, response: "534-5.7.9 Application-specific password required" }, "precisa_senha_de_app"],
    [{ code: "EAUTH", responseCode: 534, response: "534-5.7.14 Please log in via your web browser" }, "acesso_bloqueado"],
    [{ code: "ETIMEDOUT" }, "sem_conexao"],
    [{ code: "EMESSAGE", responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded" }, "limite_diario"],
  ];
  for (const [erro, motivo] of casos) {
    const c = cenario({ verificar: async () => { throw new ErroDeEnvio(erro); } });
    const r = await chamar(c, SALVAR_BOM);
    assertEquals(r.status, 422, motivo);
    assertEquals(r.json.motivo, motivo);
  }
});

Deno.test("A7 salvar — validação: só Gmail, formato e senha de app de 16 letras; nada é verificado nem gravado nem conta como tentativa", async () => {
  const ruins = [
    { usuario: "loja@outlook.com", senha: SENHA_NOVA },
    { usuario: "semarroba", senha: SENHA_NOVA },
    { usuario: "", senha: SENHA_NOVA },
    { usuario: GMAIL_NOVO, senha: "abcdefghijklmno" },
    { usuario: GMAIL_NOVO, senha: "minhasenhanormal1!" },
    { usuario: GMAIL_NOVO, senha: "" },
    { usuario: GMAIL_NOVO },
    { usuario: 42, senha: 99 },
  ];
  for (const corpo of ruins) {
    const c = cenario();
    const r = await chamar(c, { acao: "salvar", ...corpo });
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assert(typeof r.json.erro === "string" && r.json.erro.length > 10);
    assertEquals(c.ordem, []);
    assertEquals(c.banco.estado.escritas, []);
  }
  const outro = await chamar(cenario(), { acao: "salvar", usuario: "loja@outlook.com", senha: SENHA_NOVA });
  assertStringIncludes(outro.json.erro, "Gmail");
});

Deno.test("A7 salvar — senha com espaços, traços, maiúsculas e invisíveis é aceita e normalizada", async () => {
  for (const colada of ["ABCD-EFGH-IJKL-MNOP", "abcd efgh ijkl mnop\n", "\u200babcd\u00a0efgh\u2009ijkl\u3000mnop"]) {
    const c = cenario();
    const r = await chamar(c, { acao: "salvar", usuario: GMAIL_NOVO, senha: colada });
    assertEquals(r.status, 200, JSON.stringify(colada));
    assertEquals(c.verificados[0].senha, SENHA_NOVA);
  }
});

Deno.test("A7 salvar — sem cofre de chaves: 503, falha FECHADA (nada verificado, nada gravado, nada em claro)", async () => {
  const c = cenario({ ambiente: {} });
  const r = await chamar(c, SALVAR_BOM);
  assertEquals(r.status, 503);
  assertEquals(c.ordem, []);
  assertEquals(c.banco.estado.escritas, []);
});

Deno.test("A3 salvar — erro de escrita do banco (que carrega a linha inteira) NÃO é ecoado: recado fixo, e a senha não vai ao log", async () => {
  // A 1ª escrita (a tentativa) passa; a do registro estoura com texto perigoso.
  const c = cenario({ banco: { escritasPermitidas: 1, textoDoErroDeEscrita: `duplicate key ${SENHA_NOVA}` } });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, SALVAR_BOM);
  });
  assertEquals(r.status, 500);
  for (const proibido of [SENHA_NOVA, "Failing row", "duplicate key", "senha_cifrada"]) {
    assertEquals(r.texto.includes(proibido), false, proibido);
    assertEquals(logs.includes(proibido), false, proibido);
  }
});

Deno.test("A4 salvar com sucesso limpa a falha antiga do PAINEL na saúde (credencial nova, história nova) e preserva as tentativas", async () => {
  const saude = {
    ultimo_envio_ok_em: null,
    ultimo_envio_ok_origem: null,
    ultima_falha_em: "2026-10-13T09:00:00.000Z",
    ultima_falha_origem: "painel",
    codigo_falha: "senha_errada",
    tentativas_em: [],
  };
  const c = cenario({ banco: { saude } });
  await chamar(c, SALVAR_BOM);
  const depois = await lerSaudeDoEnvio(c.banco);
  assertEquals(depois.codigo_falha, null);
  assertEquals(depois.ultima_falha_em, null);
  assertEquals(depois.tentativas_em.length, 1, "a tentativa deste salvar continua contada");
});

// ── A5: limite de frequência ────────────────────────────────────────────────

Deno.test("A5 salvar — segunda tentativa em menos de 1 minuto: 429 com quanto esperar, e o Google NÃO é tocado; passado 1 minuto, passa", async () => {
  const c = cenario();
  assertEquals((await chamar(c, SALVAR_BOM)).status, 200);
  c.relogio.agora += 30_000;
  const barrada = await chamar(c, SALVAR_BOM);
  assertEquals(barrada.status, 429);
  assertEquals(barrada.json.espere_segundos, 30);
  assertEquals(c.verificados.length, 1);
  c.relogio.agora += 31_000;
  assertEquals((await chamar(c, SALVAR_BOM)).status, 200);
  assertEquals(c.verificados.length, 2);
});

Deno.test("A5 — salvar e testar dividem o MESMO limite (10 por dia): a 11ª tentativa é barrada, qualquer que seja a ação", async () => {
  const c = cenario({ banco: { registro: await registroCifrado() } });
  for (let i = 0; i < 10; i++) {
    c.relogio.agora += 61_000;
    const acao = i % 2 === 0 ? "testar" : "salvar";
    const r = await chamar(c, acao === "salvar" ? SALVAR_BOM : { acao });
    assertEquals(r.status, 200, `${i} ${acao}`);
  }
  c.relogio.agora += 61_000;
  const antes = c.ordem.length;
  assertEquals((await chamar(c, { acao: "testar" })).status, 429);
  assertEquals((await chamar(c, SALVAR_BOM)).status, 429);
  assertEquals(c.ordem.length, antes, "nada foi enviado nem verificado");
  c.relogio.agora += 86_400_000;
  assertEquals((await chamar(c, { acao: "testar" })).status, 200);
});

Deno.test("A5 — a tentativa é RESERVADA antes de falar com o Google: se gravar a reserva falha, não verifica nem envia", async () => {
  for (const acao of ["salvar", "testar"]) {
    const c = cenario({ banco: { registro: await registroCifrado(), escritasPermitidas: 0 } });
    const r = await chamar(c, acao === "salvar" ? SALVAR_BOM : { acao });
    assertEquals(r.status, 500, acao);
    assertEquals(c.ordem, [], acao);
  }
});

Deno.test("A5 — o limite sobrevive a REMOVER (não dá para burlar apagando e salvando de novo)", async () => {
  const c = cenario();
  await chamar(c, SALVAR_BOM);
  c.relogio.agora += 5_000;
  await chamar(c, { acao: "remover" });
  c.relogio.agora += 5_000;
  assertEquals((await chamar(c, SALVAR_BOM)).status, 429);
});

// ── A2/A3/A6: testar ────────────────────────────────────────────────────────

Deno.test("A2 testar — o e-mail vai SÓ para o Gmail cadastrado, ignorando qualquer destinatário do corpo; o remetente é o do painel, sem reserva; resposta honesta sobre onde olhar", async () => {
  const c = cenario({ banco: { registro: await registroCifrado() } });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, {
      acao: "testar",
      para: "vitima@exemplo.com",
      to: "vitima@exemplo.com",
      destinatario: "vitima@exemplo.com",
      cc: "vitima@exemplo.com",
      bcc: "vitima@exemplo.com",
      usuario: "vitima@gmail.com",
    });
  });
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, true);
  assertEquals(c.enviados.length, 1);
  const { mensagem, remetente } = c.enviados[0];
  assertEquals(mensagem.para, USUARIO_DO_PAINEL);
  assertEquals(Object.keys(mensagem).sort(), ["assunto", "html", "para"]);
  assertEquals(remetente.origem, "painel");
  assertEquals(remetente.usuario, USUARIO_DO_PAINEL);
  assertEquals(remetente.senha, SENHA_DO_PAINEL);
  assertEquals(remetente.reserva, null, "o teste prova a credencial DO PAINEL, nunca cai no ambiente");
  assertEquals(typeof remetente.registrarSaude, "function");
  // Honesto sobre o que o Google garante: aceitou o envio; a mensagem pode estar em Enviados.
  assertStringIncludes(r.json.mensagem, "O Google aceitou o envio");
  assertStringIncludes(r.json.mensagem, "Enviados");
  assertStringIncludes(r.json.mensagem, "Spam");
  // Resultado gravado.
  assertEquals(registroDoBanco(c).ultimo_teste.ok, true);
  assertEquals(registroDoBanco(c).ultimo_teste.motivo, null);
  for (const proibido of [SENHA_DO_PAINEL, "vitima"]) {
    assertEquals(r.texto.includes(proibido), false, proibido);
    assertEquals(logs.includes(proibido), false, proibido);
  }
});

Deno.test("A3 testar — o Google recusa e o erro CARREGA a senha: a resposta traz só a causa em palavra fixa; nada vai a resposta, log, registro ou saúde", async () => {
  const c = cenario({
    banco: { registro: await registroCifrado() },
    enviar: async () => {
      throw new ErroDeEnvio({
        code: "EAUTH",
        responseCode: 534,
        response: `534-5.7.14 Please log in ${SENHA_DO_PAINEL}`,
        message: SENHA_DO_PAINEL,
      });
    },
  });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, { acao: "testar" });
  });
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, false);
  assertEquals(r.json.motivo, "acesso_bloqueado");
  assertStringIncludes(r.json.mensagem, "Fui eu");
  assertEquals(registroDoBanco(c).ultimo_teste.ok, false);
  assertEquals(registroDoBanco(c).ultimo_teste.motivo, "acesso_bloqueado");
  for (const texto of [r.texto, logs, [...c.banco.estado.valores.values()].join("\n")]) {
    assertEquals(texto.includes(SENHA_DO_PAINEL), false);
  }
});

Deno.test("A3 testar — erro que NÃO é do SMTP (exceção qualquer) também vira só 'recusado', sem texto", async () => {
  const c = cenario({
    banco: { registro: await registroCifrado() },
    enviar: async () => {
      throw new Error(`explodiu com ${SENHA_DO_PAINEL}`);
    },
  });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await chamar(c, { acao: "testar" });
  });
  assertEquals(r.json.motivo, "recusado");
  assertEquals(r.texto.includes(SENHA_DO_PAINEL), false);
  assertEquals(logs.includes(SENHA_DO_PAINEL), false);
});

Deno.test("A2 testar — sem Gmail cadastrado: 409 e nada é enviado", async () => {
  const c = cenario();
  const r = await chamar(c, { acao: "testar" });
  assertEquals(r.status, 409);
  assertEquals(c.ordem, []);
});

Deno.test("A7 testar — sem cofre: 503; cofre com chave TROCADA (não decifra): 500 com recado fixo; nada enviado nos dois", async () => {
  const semCofre = cenario({ ambiente: {}, banco: { registro: await registroCifrado() } });
  assertEquals((await chamar(semCofre, { acao: "testar" })).status, 503);
  assertEquals(semCofre.ordem, []);
  const trocada = cenario({
    ambiente: { MP_CHAVES_ENCRYPTION_KEY: OUTRA_CHAVE_CIFRA },
    banco: { registro: await registroCifrado() },
  });
  let r;
  await capturandoLogs(async () => {
    r = await chamar(trocada, { acao: "testar" });
  });
  assertEquals(r.status, 500);
  assertStringIncludes(r.json.erro, "Salve");
  assertEquals(trocada.ordem, []);
});

Deno.test("A5 testar — segundo teste em menos de 1 minuto: 429 e o envio NÃO acontece", async () => {
  const c = cenario({ banco: { registro: await registroCifrado() } });
  assertEquals((await chamar(c, { acao: "testar" })).status, 200);
  c.relogio.agora += 10_000;
  const r = await chamar(c, { acao: "testar" });
  assertEquals(r.status, 429);
  assertEquals(r.json.espere_segundos, 50);
  assertEquals(c.enviados.length, 1);
});

Deno.test("A6 testar — a credencial foi TROCADA enquanto o teste rodava: 409, e o resultado velho NÃO é gravado por cima do registro novo", async () => {
  const antigo = await registroCifrado();
  const novo = await registroCifrado("zzzzyyyyxxxxwwww", CHAVE_CIFRA_TESTE, "nova@gmail.com");
  const c = cenario({
    banco: { registro: antigo },
    enviar: async () => {
      // Outra aba salva a credencial nova no meio do envio.
      c.banco.estado.valores.set(CHAVE_SETTINGS_EMAIL, JSON.stringify(novo));
    },
  });
  const r = await chamar(c, { acao: "testar" });
  assertEquals(r.status, 409);
  assertEquals(registroDoBanco(c), novo);
});

Deno.test("A5 testar — o envio que PENDURA é cortado no tempo limite e vira 'sem_conexao' (a função não fica presa)", async () => {
  const c = cenario({
    banco: { registro: await registroCifrado() },
    enviar: () => new Promise(() => {}),
    tempoDoEnvioMs: 30,
  });
  const inicio = Date.now();
  const r = await chamar(c, { acao: "testar" });
  assertEquals(r.json.motivo, "sem_conexao");
  assert(Date.now() - inicio < 2000);
});

// ── remover ─────────────────────────────────────────────────────────────────

Deno.test("remover — apaga o registro (a senha cifrada some), volta ao ambiente quando existe, e a falha antiga do painel sai da saúde sem apagar as tentativas", async () => {
  const saude = {
    ultimo_envio_ok_em: null,
    ultimo_envio_ok_origem: null,
    ultima_falha_em: "2026-10-13T09:00:00.000Z",
    ultima_falha_origem: "painel",
    codigo_falha: "senha_errada",
    tentativas_em: ["2026-10-14T11:59:00.000Z"],
  };
  const c = cenario({
    ambiente: { ...COFRE, ...AMBIENTE_COMPLETO },
    banco: { registro: await registroCifrado(), saude },
  });
  const r = await chamar(c, { acao: "remover" });
  assertEquals(r.status, 200);
  assertEquals(c.banco.estado.valores.has(CHAVE_SETTINGS_EMAIL), false);
  assertEquals(r.json.origem, "ambiente");
  assertEquals(r.json.senha_guardada, false);
  assertEquals(r.json.usuario, null);
  const depois = await lerSaudeDoEnvio(c.banco);
  assertEquals(depois.codigo_falha, null);
  assertEquals(depois.tentativas_em, saude.tentativas_em);
});

Deno.test("remover — sem nada cadastrado também é 200 (idempotente) e diz 'nenhuma'", async () => {
  const c = cenario();
  const r = await chamar(c, { acao: "remover" });
  assertEquals(r.status, 200);
  assertEquals(r.json.origem, "nenhuma");
  const de_novo = await chamar(c, { acao: "remover" });
  assertEquals(de_novo.status, 200);
});

// ── A3: varredura geral ─────────────────────────────────────────────────────

Deno.test("A3 — passeio completo (salvar, status, testar, remover) com falha no meio: a senha em claro não aparece em NENHUMA resposta nem log; e o banco só tem a senha CIFRADA", async () => {
  const c = cenario({ ambiente: { ...COFRE, ...AMBIENTE_COMPLETO } });
  const respostas: string[] = [];
  const logs = await capturandoLogs(async () => {
    for (const corpo of [SALVAR_BOM, { acao: "status" }, { acao: "testar" }, { acao: "remover" }]) {
      c.relogio.agora += 61_000;
      respostas.push((await chamar(c, corpo)).texto);
    }
  });
  const tudo = respostas.join("\n") + "\n" + logs;
  for (const proibido of [SENHA_NOVA, SENHA_NOVA_COLADA, SENHA_DO_AMBIENTE]) {
    assertEquals(tudo.includes(proibido), false, proibido);
  }
  for (const gravacao of c.banco.estado.escritas) {
    assertEquals((gravacao.value ?? "").includes(SENHA_NOVA), false);
  }
});
