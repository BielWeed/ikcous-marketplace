// @ts-nocheck
/**
 * Testes do módulo `_shared/email-da-loja.ts` — de onde sai o Gmail que envia
 * os e-mails da loja (o que a lojista cadastrou no painel, e, na falta dele, os
 * segredos do ambiente).
 *
 * O que decide a nota deste arquivo, em ordem de importância:
 *   1. O CAMINHO DO AMBIENTE não muda (loja IKCOUS, que nunca cadastrou nada):
 *      sem registro no painel, o remetente é exatamente SMTP_USER/SMTP_PASSWORD,
 *      como era antes — é o login por código de e-mail que depende disso.
 *   2. Nada que dê errado no painel (cofre ausente, chave trocada, banco fora,
 *      banco pendurado, JSON ruim) derruba o envio: cai no ambiente, sem lançar
 *      e sem segredo no log.
 *   3. O resolvedor devolve QUEM respondeu (`origem`), e "nenhum" quando não há
 *      remetente — é com isso que os chamadores param antes de gastar algo.
 *   4. A senha nunca aparece em log.
 *
 * Nenhuma rede: o banco é dublê, a senha de teste é FALSA e legível.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avaliarLimiteDeTeste,
  CHAVE_SETTINGS_EMAIL,
  CHAVE_SETTINGS_SAUDE,
  classificarFalhaDeEnvio,
  lerSaudeDoEnvio,
  mensagemDaFalha,
  MENSAGEM_DA_FALHA,
  normalizarSenhaDeApp,
  registrarSaudeDoEnvio,
  resolverRemetente,
  tentativasQueContam,
  validarUsuarioGmail,
} from "./email-da-loja.ts";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  capturandoLogs,
  CHAVE_CIFRA_TESTE,
  chaveLegada,
  env,
  OUTRA_CHAVE_CIFRA,
  registroCifrado,
  SENHA_DO_AMBIENTE,
  SENHA_DO_PAINEL,
  USUARIO_DO_AMBIENTE,
  USUARIO_DO_PAINEL,
} from "./email-da-loja_fixtures.ts";

const ENV_COM_COFRE_E_AMBIENTE = {
  ...AMBIENTE_COMPLETO,
  MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
};
const SO_COFRE = { MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE };

// ── 1. O caminho do ambiente NÃO muda ───────────────────────────────────────

Deno.test("sem registro no painel, o remetente é o do AMBIENTE, igualzinho a antes", async () => {
  const banco = bancoFalso();
  const r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
  assertEquals(r.origem, "ambiente");
  assertEquals(r.usuario, USUARIO_DO_AMBIENTE);
  assertEquals(r.senha, SENHA_DO_AMBIENTE);
  assertEquals(r.motivo, "sem_registro");
  assertEquals(r.reserva, null);
  assertEquals(banco.estado.leituras, [CHAVE_SETTINGS_EMAIL]);
});

Deno.test("loja que nunca teve cofre (sem MP_CHAVES_ENCRYPTION_KEY) NEM TOCA o banco: vai direto ao ambiente", async () => {
  const banco = bancoFalso({ registro: await registroCifrado() });
  const r = await resolverRemetente(banco, { env: env(AMBIENTE_COMPLETO) });
  assertEquals(r.origem, "ambiente");
  assertEquals(r.usuario, USUARIO_DO_AMBIENTE);
  assertEquals(r.motivo, "sem_cofre");
  // É isso que mantém a IKCOUS e os testes antigos sem rede nova.
  assertEquals(banco.estado.leituras, []);
});

Deno.test("ambiente MEIO configurado (só um dos dois) continua sendo 'nenhum', como o antigo remetenteConfigurado() sempre foi", async () => {
  for (const meio of [
    { SMTP_USER: USUARIO_DO_AMBIENTE },
    { SMTP_PASSWORD: SENHA_DO_AMBIENTE },
    { SMTP_USER: "", SMTP_PASSWORD: SENHA_DO_AMBIENTE },
  ]) {
    const r = await resolverRemetente(bancoFalso(), { env: env(meio) });
    assertEquals(r.origem, "nenhum");
    assertEquals(r.usuario, null);
    assertEquals(r.senha, null);
  }
});

Deno.test("nem painel nem ambiente: origem 'nenhum', e o motivo diz por quê", async () => {
  const r = await resolverRemetente(bancoFalso(), { env: env(SO_COFRE) });
  assertEquals(r.origem, "nenhum");
  assertEquals(r.motivo, "sem_registro");
  assertEquals(r.registrarSaude, undefined);
});

// ── 2. O painel vence quando está de pé ─────────────────────────────────────

Deno.test("registro do painel legível: o remetente é o do PAINEL (a senha sai decifrada), vence o ambiente, e o ambiente vai de reserva", async () => {
  const banco = bancoFalso({ registro: await registroCifrado() });
  const r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
  assertEquals(r.origem, "painel");
  assertEquals(r.usuario, USUARIO_DO_PAINEL);
  assertEquals(r.senha, SENHA_DO_PAINEL);
  assertEquals(r.motivo, null);
  assertEquals(r.reserva, { usuario: USUARIO_DO_AMBIENTE, senha: SENHA_DO_AMBIENTE });
});

Deno.test("painel sem ambiente: também funciona (é o caso da Savy), sem reserva", async () => {
  const r = await resolverRemetente(bancoFalso({ registro: await registroCifrado() }), {
    env: env(SO_COFRE),
  });
  assertEquals(r.origem, "painel");
  assertEquals(r.usuario, USUARIO_DO_PAINEL);
  assertEquals(r.reserva, null);
});

// ── 3. O que dá errado no painel cai no ambiente, sem lançar e sem segredo ──

Deno.test("chave de cifra TROCADA (não decifra): cai no ambiente, sem lançar e sem a senha no log", async () => {
  const banco = bancoFalso({ registro: await registroCifrado(SENHA_DO_PAINEL, OUTRA_CHAVE_CIFRA) });
  let r;
  const logs = await capturandoLogs(async () => {
    r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
  });
  assertEquals(r.origem, "ambiente");
  assertEquals(r.motivo, "senha_ilegivel");
  assertEquals(logs.includes(SENHA_DO_PAINEL), false);
  assertEquals(logs.includes(SENHA_DO_AMBIENTE), false);
});

Deno.test("ciphertext corrompido: mesmo caminho, sem lançar", async () => {
  const registro = await registroCifrado();
  registro.senha_cifrada = "isto-nao-e-base64-valido!!!";
  const r = await resolverRemetente(bancoFalso({ registro }), {
    env: env(ENV_COM_COFRE_E_AMBIENTE),
  });
  assertEquals(r.origem, "ambiente");
  assertEquals(r.motivo, "senha_ilegivel");
});

Deno.test("banco recusa a leitura, LANÇA ou fica PENDURADO: cai no ambiente (o pendurado solta no tempo limite — o login por e-mail não espera para sempre)", async () => {
  for (const leitura of ["erro", "lanca", "pendura"] as const) {
    const inicio = Date.now();
    const r = await resolverRemetente(bancoFalso({ leitura }), {
      env: env(ENV_COM_COFRE_E_AMBIENTE),
      tempoMs: 30,
    });
    assertEquals(r.origem, "ambiente", leitura);
    assertEquals(r.motivo, "leitura_falhou", leitura);
    assert(Date.now() - inicio < 2000, `${leitura}: esperou tempo demais`);
  }
});

Deno.test("valor ilegível (JSON quebrado ou forma errada): cai no ambiente", async () => {
  for (const cru of ["{nao-e-json", "[]", '"texto"', "null", '{"usuario":"a@gmail.com"}']) {
    const r = await resolverRemetente(bancoFalso({ registroCru: cru }), {
      env: env(ENV_COM_COFRE_E_AMBIENTE),
    });
    assertEquals(r.origem, "ambiente", cru);
    assertEquals(r.motivo, "registro_ilegivel", cru);
  }
});

Deno.test("registro ilegível SEM ambiente: 'nenhum' (a loja fica sem remetente, e diz isso), sem lançar", async () => {
  const r = await resolverRemetente(bancoFalso({ registroCru: "{quebrado" }), {
    env: env(SO_COFRE),
  });
  assertEquals(r.origem, "nenhum");
  assertEquals(r.motivo, "registro_ilegivel");
});

Deno.test("nenhum caminho de falha põe a senha (do painel, do ambiente) nem a chave de cifra no log", async () => {
  const falhas = [
    bancoFalso({ registro: await registroCifrado(SENHA_DO_PAINEL, OUTRA_CHAVE_CIFRA) }),
    bancoFalso({ leitura: "erro" }),
    bancoFalso({ leitura: "lanca" }),
    bancoFalso({ registroCru: "{quebrado" }),
  ];
  const logs = await capturandoLogs(async () => {
    for (const banco of falhas) {
      await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
    }
  });
  assertEquals(logs.includes(SENHA_DO_PAINEL), false);
  assertEquals(logs.includes(SENHA_DO_AMBIENTE), false);
  assertEquals(logs.includes(CHAVE_CIFRA_TESTE), false);
});

// ── 4. Client que não é de service role: a trava do Mercado Pago ────────────

Deno.test("client PROVADAMENTE sem service role (publishable, legado anon): 'nenhum' com o motivo certo, sem ler o banco e SEM cair no ambiente", async () => {
  for (const supabaseKey of ["sb_publishable_abc", chaveLegada("anon"), chaveLegada("authenticated")]) {
    const banco = bancoFalso({ registro: await registroCifrado(), supabaseKey });
    let r;
    await capturandoLogs(async () => {
      r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
    });
    assertEquals(r.origem, "nenhum", supabaseKey);
    assertEquals(r.motivo, "client_sem_service_role", supabaseKey);
    assertEquals(r.senha, null);
    assertEquals(banco.estado.leituras, []);
  }
});

Deno.test("client de service role (sb_secret_, JWT legado) ou sem chave declarada (dublê) segue o fluxo normal", async () => {
  for (const supabaseKey of ["sb_secret_abc", chaveLegada("service_role"), undefined]) {
    const banco = bancoFalso({ registro: await registroCifrado(), supabaseKey });
    const r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
    assertEquals(r.origem, "painel", String(supabaseKey));
  }
});

// ── 5. Saúde do envio ───────────────────────────────────────────────────────

const AGORA = Date.parse("2026-10-14T12:00:00.000Z");
const agora = () => AGORA;

Deno.test("saúde: falha grava quando, de qual origem e a CAUSA (palavra fixa)", async () => {
  const banco = bancoFalso();
  await registrarSaudeDoEnvio(
    banco,
    { ok: false, origem: "painel", motivo: "senha_errada" },
    { agora },
  );
  const saude = await lerSaudeDoEnvio(banco);
  assertEquals(saude.ultima_falha_em, "2026-10-14T12:00:00.000Z");
  assertEquals(saude.ultima_falha_origem, "painel");
  assertEquals(saude.codigo_falha, "senha_errada");
  assertEquals(saude.ultimo_envio_ok_em, null);
});

Deno.test("saúde: sucesso grava; o seguinte do mesmo remetente dentro de 6 h NÃO regrava (nada de escrita por e-mail)", async () => {
  const banco = bancoFalso();
  await registrarSaudeDoEnvio(banco, { ok: true, origem: "ambiente" }, { agora });
  assertEquals(banco.estado.escritas.length, 1);
  await registrarSaudeDoEnvio(banco, { ok: true, origem: "ambiente" }, { agora: () => AGORA + 3_600_000 });
  assertEquals(banco.estado.escritas.length, 1);
  await registrarSaudeDoEnvio(banco, { ok: true, origem: "ambiente" }, { agora: () => AGORA + 7 * 3_600_000 });
  assertEquals(banco.estado.escritas.length, 2);
});

Deno.test("saúde: sucesso do MESMO remetente que tinha falha limpa a falha; de OUTRO remetente deixa a falha", async () => {
  const banco = bancoFalso();
  await registrarSaudeDoEnvio(banco, { ok: false, origem: "painel", motivo: "senha_errada" }, { agora });
  // O ambiente voltou a enviar, mas o painel segue recusado: a falha continua à vista.
  await registrarSaudeDoEnvio(banco, { ok: true, origem: "ambiente" }, { agora });
  let saude = await lerSaudeDoEnvio(banco);
  assertEquals(saude.codigo_falha, "senha_errada");
  assertEquals(saude.ultimo_envio_ok_origem, "ambiente");
  // O painel enviou: a falha dele some.
  await registrarSaudeDoEnvio(banco, { ok: true, origem: "painel" }, { agora });
  saude = await lerSaudeDoEnvio(banco);
  assertEquals(saude.codigo_falha, null);
  assertEquals(saude.ultima_falha_em, null);
  assertEquals(saude.ultimo_envio_ok_origem, "painel");
});

Deno.test("saúde: é MELHOR ESFORÇO — banco que recusa, lança ou pendura NÃO faz registrar lançar nem esperar", async () => {
  for (const leitura of ["erro", "lanca", "pendura"] as const) {
    const inicio = Date.now();
    const logs = await capturandoLogs(() =>
      registrarSaudeDoEnvio(
        bancoFalso({ leitura }),
        { ok: false, origem: "painel", motivo: "senha_errada" },
        { agora, tempoMs: 30 },
      )
    );
    assert(Date.now() - inicio < 2000, leitura);
    assertStringIncludes(logs, "não consegui registrar a saúde do envio");
  }
  // Escrita recusada também não lança.
  await registrarSaudeDoEnvio(
    bancoFalso({ escritasPermitidas: 0 }),
    { ok: false, origem: "painel", motivo: "senha_errada" },
    { agora },
  );
});

Deno.test("saúde: valor ilegível no banco é lido como vazio (se refaz sozinho)", async () => {
  const banco = bancoFalso();
  banco.estado.valores.set(CHAVE_SETTINGS_SAUDE, "{quebrado");
  assertEquals((await lerSaudeDoEnvio(banco)).codigo_falha, null);
});

Deno.test("o resolvedor entrega `registrarSaude` ligada ao MESMO client, e o resultado vai parar na saúde", async () => {
  const banco = bancoFalso({ registro: await registroCifrado() });
  const r = await resolverRemetente(banco, { env: env(ENV_COM_COFRE_E_AMBIENTE) });
  await r.registrarSaude({ ok: false, origem: "painel", motivo: "precisa_senha_de_app" });
  assertEquals((await lerSaudeDoEnvio(banco)).codigo_falha, "precisa_senha_de_app");
});

Deno.test("tentativasQueContam: descarta datas velhas e lixo, e guarda no máximo 20", () => {
  const dentro = new Date(AGORA - 3_600_000).toISOString();
  const fora = new Date(AGORA - 90_000_000).toISOString();
  assertEquals(tentativasQueContam([fora, dentro, "lixo"], AGORA), [dentro]);
  const muitas = Array.from({ length: 30 }, (_, i) => new Date(AGORA - i * 1000).toISOString());
  assertEquals(tentativasQueContam(muitas, AGORA).length, 20);
});

// ── 6. Validação do que a lojista digita ────────────────────────────────────

Deno.test("validarUsuarioGmail: aceita Gmail e Googlemail, normaliza caixa e espaços", () => {
  assertEquals(validarUsuarioGmail("  Loja.Teste@Gmail.com "), {
    ok: true,
    usuario: "loja.teste@gmail.com",
  });
  assertEquals(validarUsuarioGmail("loja@googlemail.com"), {
    ok: true,
    usuario: "loja@googlemail.com",
  });
});

Deno.test("validarUsuarioGmail: recusa outros provedores com mensagem honesta, e formato quebrado", () => {
  const outro = validarUsuarioGmail("loja@outlook.com");
  assertEquals(outro.ok, false);
  assertStringIncludes(outro.erro, "Gmail");
  assertStringIncludes(outro.erro, "outros provedores");
  for (const ruim of [
    "",
    "   ",
    "semarroba",
    "@gmail.com",
    "a@b@gmail.com",
    "dois espacos@gmail.com",
    "loja@gmail.com.br",
    "loja@gmail.com,outro@gmail.com",
    "loja@gmail.com\nbcc: alguem@x.com",
    "x".repeat(300) + "@gmail.com",
    null,
    undefined,
    42,
  ]) {
    assertEquals(validarUsuarioGmail(ruim).ok, false, String(ruim));
  }
});

Deno.test("normalizarSenhaDeApp: tira TODO espaço (inclusive U+00A0 e demais Unicode), traço e invisível; vira minúscula; só passa 16 letras", () => {
  const boa = { ok: true, senha: "abcdefghijklmnop" };
  assertEquals(normalizarSenhaDeApp("abcd efgh ijkl mnop"), boa);
  assertEquals(normalizarSenhaDeApp("abcd-efgh-ijkl-mnop"), boa);
  // O Google mostra a senha com espaço-que-não-quebra (U+00A0) entre os blocos.
  assertEquals(normalizarSenhaDeApp("abcd\u00a0efgh\u00a0ijkl\u00a0mnop"), boa);
  // Outros espaços Unicode, tab, quebra de linha e invisíveis de largura zero.
  assertEquals(normalizarSenhaDeApp("abcd\u2009efgh\u202fijkl\u3000mnop\n"), boa);
  assertEquals(normalizarSenhaDeApp("\ufeffabcd\u200befgh\u200cijkl\u2060mnop\t"), boa);
  assertEquals(normalizarSenhaDeApp("abcd\u2013efgh\u2212ijkl\u00admnop"), boa);
  // Maiúsculas viram minúsculas ANTES de validar.
  assertEquals(normalizarSenhaDeApp("ABCD EFGH IJKL MNOP"), boa);
  for (const ruim of [
    "",
    "abcdefghijklmno", // 15
    "abcdefghijklmnopq", // 17
    "abcdefghijklmno1", // número
    "minhasenhanormal!", // a senha comum da conta
    "abcdefghijklmnó", // acento
    null,
    undefined,
    1234567890123456,
  ]) {
    assertEquals(normalizarSenhaDeApp(ruim).ok, false, String(ruim));
  }
});

// ── 7. Limite de frequência (verificação do salvar + e-mail de teste) ───────

const T0 = AGORA;
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("limite: a primeira passa; menos de 1 min depois, não; 1 min depois, sim", () => {
  assertEquals(avaliarLimiteDeTeste([], T0).permitido, true);
  const bloqueado = avaliarLimiteDeTeste([iso(T0)], T0 + 59_000);
  assertEquals(bloqueado.permitido, false);
  assertEquals(bloqueado.esperaSegundos, 1);
  assertEquals(avaliarLimiteDeTeste([iso(T0)], T0 + 60_000).permitido, true);
});

Deno.test("limite: no máximo 10 por DIA, e o dia ROLA (o mais velho sai da conta)", () => {
  const dez = Array.from({ length: 10 }, (_, i) => iso(T0 + i * 120_000));
  const barrado = avaliarLimiteDeTeste(dez, T0 + 20 * 60_000);
  assertEquals(barrado.permitido, false);
  // O mais velho (T0) sai da janela em T0 + 24 h.
  assertEquals(barrado.esperaSegundos, 86_400 - 20 * 60);
  assertEquals(
    avaliarLimiteDeTeste(dez, T0 + 86_400_000).permitido,
    true,
    "passadas 24 h do mais velho, libera",
  );
});

Deno.test("limite: lixo no registro (datas inválidas, não-lista) não libera nem derruba", () => {
  assertEquals(avaliarLimiteDeTeste(undefined, T0).permitido, true);
  assertEquals(avaliarLimiteDeTeste(["lixo", 7, null], T0).permitido, true);
  // Data do FUTURO (relógio mexido) conta como recente: nunca libera por isso.
  assertEquals(avaliarLimiteDeTeste([iso(T0 + 600_000)], T0).permitido, false);
});

// ── 8. Classificação da falha de envio (nunca o texto cru) ──────────────────

Deno.test("classificarFalhaDeEnvio: devolve só uma palavra fixa, e cada uma tem a frase da lojista", () => {
  const caso = (codigo: string | null, respostaSmtp: number | null, codigoEstendido: string | null = null) =>
    classificarFalhaDeEnvio({ codigo, respostaSmtp, codigoEstendido });
  assertEquals(caso("EAUTH", 535, "5.7.8"), "senha_errada");
  assertEquals(caso("EAUTH", 534, "5.7.9"), "precisa_senha_de_app");
  assertEquals(caso("EAUTH", 534, "5.7.14"), "acesso_bloqueado");
  assertEquals(caso("EMESSAGE", 550, "5.4.5"), "limite_diario");
  // Sem o código estendido, o login recusado é "senha errada".
  assertEquals(caso("EAUTH", 535), "senha_errada");
  assertEquals(caso("EAUTH", 534), "senha_errada");
  assertEquals(caso("EAUTH", null), "senha_errada");
  assertEquals(caso("EAUTH", 454), "acesso_bloqueado");
  assertEquals(caso("ECONNECTION", null), "sem_conexao");
  assertEquals(caso("ETIMEDOUT", null), "sem_conexao");
  assertEquals(caso("ESOCKET", null), "sem_conexao");
  assertEquals(caso(null, null), "recusado");
  assertEquals(caso("QUALQUER", null), "recusado");
  // Entrada que não é erro de envio também não derruba.
  assertEquals(classificarFalhaDeEnvio(undefined), "recusado");
  assertEquals(classificarFalhaDeEnvio(new Error("senha=abc")), "recusado");
  assertEquals(Object.keys(MENSAGEM_DA_FALHA).sort(), [
    "acesso_bloqueado",
    "limite_diario",
    "precisa_senha_de_app",
    "recusado",
    "sem_conexao",
    "senha_errada",
  ]);
  for (const [motivo, frase] of Object.entries(MENSAGEM_DA_FALHA)) {
    assert(frase.length > 20, motivo);
  }
  assertEquals(mensagemDaFalha("inventado"), MENSAGEM_DA_FALHA.recusado);
  assertStringIncludes(MENSAGEM_DA_FALHA.acesso_bloqueado, "Fui eu");
});
