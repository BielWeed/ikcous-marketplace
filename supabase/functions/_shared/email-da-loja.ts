// @ts-nocheck
// ============================================================================
// E-mail da loja — de onde sai o Gmail que envia os e-mails do pedido e o
// código de login por e-mail (14/10/2026).
//
// POR QUE ESTE ARQUIVO EXISTE
//
// Até aqui o remetente vinha só de dois segredos do AMBIENTE (SMTP_USER e
// SMTP_PASSWORD), colados à mão no projeto do Supabase. A Savy nunca os teve:
// o comprovante do pedido respondia `sem_remetente` e nenhum cliente recebia
// e-mail. O dono decidiu que a LOJISTA cadastra o Gmail da loja no próprio
// painel (edge `credenciais-email`) e que nós nunca vemos a senha dela.
//
// A REGRA DE ESCOLHA (uma só, usada por quem envia e por quem mostra o estado):
//   1. Registro do painel (app_settings, chave `email_da_loja`) que dá para
//      decifrar -> vale ESSE (origem "painel"). Se o ambiente também estiver
//      completo, ele vai junto como `reserva`: o envio tenta UMA vez por ele
//      quando o Google recusa o login do painel (a lojista trocou a senha da
//      conta e o Google revogou a senha de app — o que funcionava não pode
//      parar por isso).
//   2. Qualquer outra coisa — sem registro, sem cofre, cofre com chave trocada,
//      banco fora do ar ou pendurado, valor ilegível -> o AMBIENTE (origem
//      "ambiente"), como era antes.
//   3. Nem um nem outro -> origem "nenhum". Quem chama PARA antes de gastar
//      qualquer coisa (gerar código, reservar o aviso do pedido).
//
// Isto é o OPOSTO da regra do Mercado Pago (`credenciais-mp.ts`), que FECHA
// quando não decifra, e de propósito: lá o erro é dinheiro na conta errada; aqui
// o pior erro é o e-mail sair por outro remetente, e fechar derrubaria o login
// por código da loja que já funciona pelo ambiente (IKCOUS).
//
// O RESOLVEDOR É ASSÍNCRONO E POR ISSO O ANTIGO `remetenteConfigurado()` (que
// era síncrono e devolvia boolean) FOI APAGADO, não adaptado: um chamador que
// esquecesse o `await` testaria `!Promise` — sempre "configurado" — e gastaria
// o código e a janela de 60 s do login antes de o envio falhar. Agora o
// resolvedor devolve UM objeto por pedido, e `enviarEmail` EXIGE esse objeto.
//
// O COFRE É O MESMO DO MERCADO PAGO. A cifra (AES-256-GCM, chave de 32 bytes na
// env MP_CHAVES_ENCRYPTION_KEY) é a de `credenciais-mp.ts`, importada de lá sem
// copiar. Sem a variável, o painel nem consegue salvar (a edge responde 503), e
// este resolvedor nem chega a ler o banco.
//
// O CLIENT TEM DE SER DE SERVICE ROLE (mesma trava `client_sem_service_role` do
// Mercado Pago). app_settings é só-admin por RLS e RLS não devolve erro: um
// client de usuário leria VAZIO e a loja cairia no ambiente (na Savy, sem
// nenhum remetente) sem uma linha de log. Com a chave do client PROVADAMENTE
// de outro papel, a resolução devolve "nenhum" com esse motivo.
//
// NADA DE SEGREDO EM LOG: daqui só sai uma palavra fixa de motivo.
// ============================================================================
import {
  type AmbienteLeitura,
  chaveDeCifra,
  decifrar,
  papelDaChaveDoClient,
} from "./credenciais-mp.ts";

/** Linha única da loja em app_settings (app único, banco por cliente). */
export const CHAVE_SETTINGS_EMAIL = "email_da_loja";
/**
 * Saúde do envio + contador de tentativas de teste. SEPARADA do registro de
 * propósito: `salvar` reescreve o registro inteiro, e quem envia grava saúde a
 * qualquer hora — no mesmo valor uma gravação apagaria a outra.
 */
export const CHAVE_SETTINGS_SAUDE = "email_da_loja_saude";

/** Quanto esperar pelo banco antes de seguir (o OTP não espera para sempre). */
const TEMPO_DO_BANCO_MS = 3000;
/** Sucesso repetido não precisa regravar a saúde a cada e-mail. */
const REGRAVAR_SUCESSO_APOS_MS = 6 * 3_600_000;

export type Origem = "painel" | "ambiente";

/** A lista FECHADA de causas de falha: nunca o texto do erro do SMTP. */
export type MotivoDaFalha =
  | "senha_errada" // 535 5.7.8: usuário/senha não aceitos
  | "precisa_senha_de_app" // 534 5.7.9: colou a senha normal da conta
  | "acesso_bloqueado" // 534 5.7.14 e bloqueios temporários: o Google travou o acesso
  | "limite_diario" // 5.4.5: acabou a cota de envios do dia
  | "sem_conexao"
  | "recusado";

/** O que a lojista lê para cada causa — uma definição só (a edge e a tela usam esta). */
export const MENSAGEM_DA_FALHA: Record<MotivoDaFalha, string> = {
  senha_errada:
    "O Google recusou a senha. Confira se colou a senha de app de 16 letras (não a senha normal do Gmail) e se a verificação em duas etapas está ligada nessa conta. Se você trocou a senha do Gmail há pouco, o Google cancela as senhas de app: crie uma nova.",
  precisa_senha_de_app:
    "Parece que foi colada a senha normal do Gmail. Aqui é preciso uma senha de app: crie uma na sua Conta Google (passo a passo nesta tela) e cole as 16 letras.",
  acesso_bloqueado:
    "O Google bloqueou o acesso vindo do servidor. Abra o Gmail dessa conta, procure o alerta de segurança e toque em «Fui eu»; depois tente de novo. Se não houver alerta, espere alguns minutos.",
  limite_diario:
    "O Google atingiu o limite de envios desta conta por hoje. O envio volta ao normal em até 24 horas.",
  sem_conexao:
    "Não consegui falar com o Google agora. Tente de novo em instantes.",
  recusado:
    "O Google não aceitou o envio. Tente de novo; se continuar, confira a senha de app.",
};

/** A frase da causa; causa desconhecida cai na mais genérica. */
export function mensagemDaFalha(motivo: MotivoDaFalha | null | undefined): string {
  return new Map(Object.entries(MENSAGEM_DA_FALHA)).get(String(motivo)) ??
    MENSAGEM_DA_FALHA.recusado;
}

export type UltimoTesteEmail = {
  ok: boolean;
  em: string;
  motivo: MotivoDaFalha | null;
};

/** O que dorme em app_settings — a senha só em ciphertext + iv. */
export type RegistroEmail = {
  usuario: string;
  senha_cifrada: string;
  iv: string;
  atualizado_em: string;
  ultimo_teste: UltimoTesteEmail | null;
};

export type SaudeDoEnvio = {
  ultimo_envio_ok_em: string | null;
  ultimo_envio_ok_origem: Origem | null;
  ultima_falha_em: string | null;
  ultima_falha_origem: Origem | null;
  codigo_falha: MotivoDaFalha | null;
  /** Quando cada tentativa de teste/verificação foi feita (só as últimas 24 h importam). */
  tentativas_em: string[];
};

export type ResultadoDoEnvio =
  | { ok: true; origem: Origem }
  | { ok: false; origem: Origem; motivo: MotivoDaFalha };

/** O que `enviarEmail` recebe — resolvido UMA vez por pedido. */
export type Remetente = {
  origem: Origem | "nenhum";
  usuario: string | null;
  senha: string | null;
  /** Por que o painel não foi usado (palavra fixa); null quando o painel é o remetente. */
  motivo: string | null;
  /** O ambiente completo, quando o painel é o remetente: uma segunda chance no login recusado. */
  reserva: { usuario: string; senha: string } | null;
  /** Registra a saúde do envio (melhor esforço: nunca lança). Ausente em dublê. */
  registrarSaude?: (resultado: ResultadoDoEnvio) => Promise<void>;
};

// ── Validação do que a lojista digita ───────────────────────────────────────

// Duas partes simples (sem quantificador aninhado): nome antes da arroba e
// domínio com pelo menos um ponto e um final de 2+ letras.
const PARTE_LOCAL = /^[a-z0-9._%+-]+$/;
const PARTE_DO_DOMINIO = /^[a-z0-9.-]+\.[a-z]{2,}$/;

function formatoDeEmailValido(usuario: string): boolean {
  const partes = usuario.split("@");
  return (
    partes.length === 2 &&
    PARTE_LOCAL.test(partes[0]) &&
    PARTE_DO_DOMINIO.test(partes[1])
  );
}
const DOMINIOS_ACEITOS = ["@gmail.com", "@googlemail.com"];

export function validarUsuarioGmail(
  entrada: unknown,
): { ok: true; usuario: string } | { ok: false; erro: string } {
  const usuario = typeof entrada === "string" ? entrada.trim().toLowerCase() : "";
  if (!usuario || usuario.length > 254 || !formatoDeEmailValido(usuario)) {
    return {
      ok: false,
      erro: "Esse endereço de e-mail não parece certo. Confira se digitou o Gmail inteiro, como nomedaloja@gmail.com.",
    };
  }
  if (!DOMINIOS_ACEITOS.some((dominio) => usuario.endsWith(dominio))) {
    return {
      ok: false,
      erro: "Só Gmail por enquanto: o endereço tem de terminar em @gmail.com. Contas de outros provedores, como Outlook ou Yahoo, não funcionam aqui — outros provedores não são aceitos nesta versão.",
    };
  }
  return { ok: true, usuario };
}

/**
 * Tudo que o Google ou o copiar-e-colar podem ter metido entre as letras:
 * espaço comum, espaço que não quebra (U+00A0), os outros espaços Unicode
 * (`\s` cobre U+1680, U+2000\u2013200A, U+202F, U+205F, U+3000, U+FEFF), os
 * invisíveis de largura zero (U+200B\u2013200D, U+2060), hífen e seus parentes.
 */
const RUIDO_DA_COLAGEM = /[\s\u200b-\u200d\u2060\u00ad\u2010-\u2015\u2212-]/g;

/** A senha de app do Google: 16 letras minúsculas, mostradas em 4 grupos. */
export function normalizarSenhaDeApp(
  entrada: unknown,
): { ok: true; senha: string } | { ok: false; erro: string } {
  const senha = typeof entrada === "string"
    ? entrada.replace(RUIDO_DA_COLAGEM, "").toLowerCase()
    : "";
  if (!/^[a-z]{16}$/.test(senha)) {
    return {
      ok: false,
      erro: "A senha de app tem 16 letras (o Google mostra em 4 grupos de 4). Confira se copiou inteira — não é a senha normal do seu Gmail.",
    };
  }
  return { ok: true, senha };
}

// ── Limite de frequência de teste/verificação ───────────────────────────────

const INTERVALO_MINIMO_MS = 60_000;
const JANELA_MS = 86_400_000;
const MAXIMO_NA_JANELA = 10;

/**
 * Salvar (verifica o login) e testar (manda um e-mail para o próprio Gmail)
 * falam com o Google. Sem freio, o botão vira martelo (o Google bloqueia a
 * conta por tentativas de login demais) e caixa cheia de lixo. Regra: pelo
 * menos 1 minuto entre tentativas e no máximo 10 por dia. Função pura.
 *
 * Data inválida no registro é ignorada; data do FUTURO (relógio mexido) conta
 * como recente — nunca libera por isso.
 */
export function avaliarLimiteDeTeste(
  tentativasEm: unknown,
  agoraMs: number,
): { permitido: true } | { permitido: false; esperaSegundos: number } {
  const instantes = (Array.isArray(tentativasEm) ? tentativasEm : [])
    .map((valor) => (typeof valor === "string" ? Date.parse(valor) : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  const naJanela = instantes.filter((ms) => ms > agoraMs - JANELA_MS);
  let esperaMs = 0;
  if (naJanela.length > 0) {
    esperaMs = Math.max(esperaMs, Math.max(...naJanela) + INTERVALO_MINIMO_MS - agoraMs);
  }
  if (naJanela.length >= MAXIMO_NA_JANELA) {
    // O que sai primeiro da janela é o mais velho: libera uma vaga.
    esperaMs = Math.max(esperaMs, Math.min(...naJanela) + JANELA_MS - agoraMs);
  }
  if (esperaMs <= 0) return { permitido: true };
  return { permitido: false, esperaSegundos: Math.ceil(esperaMs / 1000) };
}

// ── Falha de envio -> uma palavra fixa ──────────────────────────────────────

/**
 * Recebe o que o `ErroDeEnvio` de `smtp.ts` expõe (código do transporte, código
 * numérico da resposta SMTP e o código estendido, só quando está numa lista
 * fechada) e devolve UMA palavra fixa. O texto do erro do SMTP nunca passa por
 * aqui: ele carrega a configuração, e com ela a senha.
 */
export function classificarFalhaDeEnvio(erro: unknown): MotivoDaFalha {
  const codigo = typeof erro?.codigo === "string" ? erro.codigo : null;
  const resposta = Number.isInteger(erro?.respostaSmtp) ? erro.respostaSmtp : null;
  const estendido = typeof erro?.codigoEstendido === "string" ? erro.codigoEstendido : null;
  if (estendido === "5.7.14") return "acesso_bloqueado";
  if (estendido === "5.7.9") return "precisa_senha_de_app";
  if (estendido === "5.7.8") return "senha_errada";
  if (estendido === "5.4.5") return "limite_diario";
  if ([421, 450, 451, 452, 454].includes(resposta)) return "acesso_bloqueado";
  if (codigo === "EAUTH") return "senha_errada";
  if (
    codigo === "ECONNECTION" ||
    codigo === "ETIMEDOUT" ||
    codigo === "ESOCKET" ||
    codigo === "EDNS" ||
    codigo === "ECONNRESET"
  ) {
    return "sem_conexao";
  }
  return "recusado";
}

// ── app_settings (via supabase client injetável) ────────────────────────────

export function comTempoLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout>;
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error("tempo_esgotado")), ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(relogio));
}

async function lerValor(supabaseServiceRole: any, chave: string): Promise<string | null> {
  const { data, error } = await supabaseServiceRole
    .from("app_settings")
    .select("value")
    .eq("key", chave)
    .maybeSingle();
  // Mensagem fixa: o texto do banco nunca sobe.
  if (error) throw new Error("storage_leitura");
  return data?.value ? String(data.value) : null;
}

async function gravarValor(supabaseServiceRole: any, chave: string, valor: unknown) {
  const { error } = await supabaseServiceRole.from("app_settings").upsert(
    {
      key: chave,
      value: JSON.stringify(valor),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  // Mensagem fixa: o detalhe de um erro de escrita pode trazer a linha inteira.
  if (error) throw new Error("storage_escrita");
}

/**
 * Lê o registro da loja. `null` = nunca cadastrou. Falhas viram erro com
 * mensagem FIXA: `storage_leitura` quando o banco recusa, `registro_ilegivel`
 * quando o valor não é um registro.
 */
export async function lerRegistroEmail(
  supabaseServiceRole: any,
): Promise<RegistroEmail | null> {
  const valor = await lerValor(supabaseServiceRole, CHAVE_SETTINGS_EMAIL);
  if (valor === null) return null;
  let bruto: any;
  try {
    bruto = JSON.parse(valor);
  } catch {
    throw new Error("registro_ilegivel");
  }
  const textoOk = (v: unknown) => typeof v === "string" && v.length > 0;
  if (
    !bruto ||
    typeof bruto !== "object" ||
    !textoOk(bruto.usuario) ||
    !textoOk(bruto.senha_cifrada) ||
    !textoOk(bruto.iv)
  ) {
    throw new Error("registro_ilegivel");
  }
  return {
    usuario: bruto.usuario,
    senha_cifrada: bruto.senha_cifrada,
    iv: bruto.iv,
    atualizado_em: typeof bruto.atualizado_em === "string" ? bruto.atualizado_em : "",
    ultimo_teste: bruto.ultimo_teste ?? null,
  };
}

export async function gravarRegistroEmail(
  supabaseServiceRole: any,
  registro: RegistroEmail,
): Promise<void> {
  await gravarValor(supabaseServiceRole, CHAVE_SETTINGS_EMAIL, registro);
}

export async function removerRegistroEmail(
  supabaseServiceRole: any,
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from("app_settings")
    .delete()
    .eq("key", CHAVE_SETTINGS_EMAIL);
  if (error) throw new Error("storage_escrita");
}

function saudeVazia(): SaudeDoEnvio {
  return {
    ultimo_envio_ok_em: null,
    ultimo_envio_ok_origem: null,
    ultima_falha_em: null,
    ultima_falha_origem: null,
    codigo_falha: null,
    tentativas_em: [],
  };
}

/** Lê a saúde. Ausente OU ilegível = vazia (a saúde se refaz sozinha no próximo envio). Erro de banco lança. */
export async function lerSaudeDoEnvio(supabaseServiceRole: any): Promise<SaudeDoEnvio> {
  const valor = await lerValor(supabaseServiceRole, CHAVE_SETTINGS_SAUDE);
  if (valor === null) return saudeVazia();
  try {
    const bruto = JSON.parse(valor);
    if (!bruto || typeof bruto !== "object") return saudeVazia();
    const origem = (v: unknown) => (v === "painel" || v === "ambiente" ? v : null);
    const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      ultimo_envio_ok_em: texto(bruto.ultimo_envio_ok_em),
      ultimo_envio_ok_origem: origem(bruto.ultimo_envio_ok_origem),
      ultima_falha_em: texto(bruto.ultima_falha_em),
      ultima_falha_origem: origem(bruto.ultima_falha_origem),
      codigo_falha: bruto.codigo_falha in MENSAGEM_DA_FALHA ? bruto.codigo_falha : null,
      tentativas_em: Array.isArray(bruto.tentativas_em)
        ? bruto.tentativas_em.filter((v: unknown) => typeof v === "string")
        : [],
    };
  } catch {
    return saudeVazia();
  }
}

export async function gravarSaudeDoEnvio(
  supabaseServiceRole: any,
  saude: SaudeDoEnvio,
): Promise<void> {
  await gravarValor(supabaseServiceRole, CHAVE_SETTINGS_SAUDE, saude);
}

/** Guarda só as tentativas que ainda contam (últimas 24 h), no máximo 20. */
export function tentativasQueContam(tentativasEm: string[], agoraMs: number): string[] {
  return tentativasEm
    .filter((valor) => {
      const ms = Date.parse(valor);
      return Number.isFinite(ms) && ms > agoraMs - JANELA_MS;
    })
    .slice(-20);
}

/**
 * Registra o resultado de um envio na saúde. MELHOR ESFORÇO: falha ao ler ou
 * gravar a saúde NUNCA derruba o envio (nem lança), e não espera o banco mais
 * que `tempoMs`. Sucesso repetido do mesmo remetente não regrava a cada e-mail
 * (a cada 6 h, ou se havia uma falha dessa origem para limpar).
 */
export async function registrarSaudeDoEnvio(
  supabaseServiceRole: any,
  resultado: ResultadoDoEnvio,
  opcoes: { agora?: () => number; tempoMs?: number } = {},
): Promise<void> {
  const agoraMs = (opcoes.agora ?? Date.now)();
  const em = new Date(agoraMs).toISOString();
  try {
    await comTempoLimite(
      (async () => {
        const saude = await lerSaudeDoEnvio(supabaseServiceRole);
        if (resultado.ok) {
          const haFalhaParaLimpar = saude.ultima_falha_origem === resultado.origem;
          const recente = saude.ultimo_envio_ok_origem === resultado.origem &&
            Date.parse(saude.ultimo_envio_ok_em ?? "") > agoraMs - REGRAVAR_SUCESSO_APOS_MS;
          if (recente && !haFalhaParaLimpar) return;
          saude.ultimo_envio_ok_em = em;
          saude.ultimo_envio_ok_origem = resultado.origem;
          if (haFalhaParaLimpar) {
            saude.ultima_falha_em = null;
            saude.ultima_falha_origem = null;
            saude.codigo_falha = null;
          }
        } else {
          saude.ultima_falha_em = em;
          saude.ultima_falha_origem = resultado.origem;
          saude.codigo_falha = resultado.motivo;
        }
        await gravarSaudeDoEnvio(supabaseServiceRole, saude);
      })(),
      opcoes.tempoMs ?? TEMPO_DO_BANCO_MS,
    );
  } catch {
    // Só uma palavra fixa: a saúde é um aviso, não pode virar outra falha.
    console.error("[email-da-loja] não consegui registrar a saúde do envio");
  }
}

// ── O resolvedor ────────────────────────────────────────────────────────────

type DoAmbiente = { usuario: string; senha: string } | null;

/** O remetente dos segredos do ambiente: os DOIS presentes (meio configurado conta como não configurado). */
function ambienteCompleto(env: AmbienteLeitura): DoAmbiente {
  const usuario = env.get("SMTP_USER");
  const senha = env.get("SMTP_PASSWORD");
  return usuario && senha ? { usuario, senha } : null;
}

type TentativaDoPainel =
  | { remetente: { usuario: string; senha: string } }
  | { remetente: null; motivo: string };

async function tentarOPainel(
  supabaseServiceRole: any,
  env: AmbienteLeitura,
  tempoMs: number,
): Promise<TentativaDoPainel> {
  const falhou = (motivo: string) => {
    // Só a palavra fixa. Sem cofre/sem registro é o estado normal de quem nunca
    // cadastrou: não é falha, não faz barulho.
    console.error(
      `[email-da-loja] painel indisponível, usando o ambiente (motivo: ${motivo})`,
    );
    return { remetente: null, motivo } as const;
  };

  let chave: CryptoKey | null = null;
  try {
    chave = await chaveDeCifra(env);
  } catch {
    chave = null;
  }
  if (!chave) return { remetente: null, motivo: "sem_cofre" };

  let registro: RegistroEmail | null;
  try {
    registro = await comTempoLimite(lerRegistroEmail(supabaseServiceRole), tempoMs);
  } catch (erro) {
    return falhou(
      erro instanceof Error && erro.message === "registro_ilegivel"
        ? "registro_ilegivel"
        : "leitura_falhou",
    );
  }
  if (!registro) return { remetente: null, motivo: "sem_registro" };

  try {
    const senha = await decifrar(registro.senha_cifrada, registro.iv, chave);
    if (!senha) return falhou("senha_ilegivel");
    return { remetente: { usuario: registro.usuario, senha } };
  } catch {
    return falhou("senha_ilegivel");
  }
}

/**
 * Quem envia: o painel (se legível) ou o ambiente; "nenhum" quando não há
 * nenhum dos dois (ou o client não é de service role). Nunca lança. Devolve o
 * objeto que `enviarEmail` exige, e o `motivo` de o painel não ter sido usado.
 *
 * **O client TEM de ser de SERVICE ROLE** (ver o cabeçalho). Quando a chave do
 * client DIZ que não é, a resolução FECHA ("nenhum", `client_sem_service_role`)
 * em vez de adivinhar; quando a chave não diz nada (dublê de teste), segue.
 */
export async function resolverRemetente(
  supabaseServiceRole: any,
  opcoes: { env?: AmbienteLeitura; tempoMs?: number } = {},
): Promise<Remetente> {
  const env = opcoes.env ?? Deno.env;
  const papel = papelDaChaveDoClient(supabaseServiceRole);
  if (papel !== null && papel !== "service_role") {
    console.error(
      "[email-da-loja] remetente indisponível (motivo: client_sem_service_role)",
    );
    return {
      origem: "nenhum",
      usuario: null,
      senha: null,
      motivo: "client_sem_service_role",
      reserva: null,
    };
  }

  const doAmbiente = ambienteCompleto(env);
  const doPainel = await tentarOPainel(
    supabaseServiceRole,
    env,
    opcoes.tempoMs ?? TEMPO_DO_BANCO_MS,
  );
  const registrarSaude = (resultado: ResultadoDoEnvio) =>
    registrarSaudeDoEnvio(supabaseServiceRole, resultado);

  if (doPainel.remetente) {
    return {
      origem: "painel",
      usuario: doPainel.remetente.usuario,
      senha: doPainel.remetente.senha,
      motivo: null,
      reserva: doAmbiente,
      registrarSaude,
    };
  }
  if (doAmbiente) {
    return {
      origem: "ambiente",
      usuario: doAmbiente.usuario,
      senha: doAmbiente.senha,
      motivo: doPainel.motivo,
      reserva: null,
      registrarSaude,
    };
  }
  return {
    origem: "nenhum",
    usuario: null,
    senha: null,
    motivo: doPainel.motivo,
    reserva: null,
  };
}
