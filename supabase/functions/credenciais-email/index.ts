// @ts-nocheck
// ============================================================================
// Edge function credenciais-email (14/10/2026).
//
// A LOJISTA CADASTRA O GMAIL DA LOJA no painel (Ajustes), sem depender de
// ninguém colar segredo no servidor: esta function GUARDA, VERIFICA e TESTA o
// Gmail + a senha de app que ela digitar. É o mesmo desenho de
// `credenciais-mercado-pago`, com e-mail no lugar do Mercado Pago. Quem LÊ o
// que ela guardou, na hora de enviar, é `_shared/email-da-loja.ts`
// (`resolverRemetente`) — o login por código, o comprovante e o aviso de
// pagamento atrasado passam por lá.
//
// Ações (POST, corpo JSON `{ acao, ... }`), TODAS só para o admin de AGORA:
//   status  -> o que a tela mostra: Gmail, se há senha guardada, quem está
//              enviando de fato (`origem`), se o cofre está pronto, o último
//              teste e a SAÚDE do envio. Nunca a senha.
//   salvar  -> { usuario, senha }. Valida, VERIFICA o login no Google com a
//              senha nova (transporter.verify) e SÓ ENTÃO grava, cifrada. Login
//              recusado = nada gravado, e a credencial anterior segue de pé.
//   testar  -> manda UM e-mail, SÓ para o próprio Gmail cadastrado.
//   remover -> apaga o registro (volta ao ambiente, se existir).
//
// O QUE PROTEGE ESTA FUNCTION
//   * Admin-only duas vezes: verify_jwt = true no portão (config.toml) E a
//     porta interna: o admin de AGORA (`_shared/admin-atual.ts`, a mesma do
//     estornar-pagamento e da credenciais-mercado-pago) — papel 'admin' em
//     profiles E em app_metadata. service_role puro e anon não têm usuário e
//     caem em 401. NUNCA publicar com --no-verify-jwt.
//   * A SENHA NUNCA VOLTA: nem na resposta, nem em log, nem em mensagem de
//     erro. O erro do SMTP e o do banco carregam configuração e linha inteira
//     — por isso daqui só saem palavras fixas (`MENSAGEM_DA_FALHA`) e recados
//     escritos à mão. A senha dorme CIFRADA (AES-256-GCM, a chave de 32 bytes
//     da env MP_CHAVES_ENCRYPTION_KEY, o mesmo cofre do Mercado Pago); sem o
//     cofre, salvar falha FECHADO (503) em vez de gravar em claro.
//   * O TESTE NÃO É RELÉ: o destinatário é SEMPRE o usuário do registro; nada
//     do corpo da requisição escolhe para quem vai.
//   * LIMITE DE FREQUÊNCIA: salvar (que fala com o Google) e testar dividem o
//     mesmo contador — 1 por minuto, 10 por dia — guardado na saúde
//     (`email_da_loja_saude`, SEPARADA do registro para `salvar` não brigar com
//     quem grava saúde a qualquer hora). A tentativa é RESERVADA antes de falar
//     com o Google; se a reserva não grava, não fala. O contador sobrevive a
//     `remover`. O que NÃO é atômico: duas chamadas simultâneas leem o mesmo
//     contador e as duas passam — no pior caso, dois e-mails de teste para o
//     próprio Gmail da lojista (inofensivo, e só admin chega aqui).
//   * app_settings é fechada a anon/authenticated (migration 20261218000100) e
//     só o service_role lê e grava; nenhuma migration nova é necessária.
//
// IDEMPOTÊNCIA: `salvar` repetido regrava o mesmo registro (nova iv, mesmo
// efeito); `remover` repetido é 200; `testar` repetido só consome a cota.
// ============================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminAtualDaSessao } from "../_shared/admin-atual.ts";
import { chaveDeCifra, cifrar, decifrar } from "../_shared/credenciais-mp.ts";
import {
  avaliarLimiteDeTeste,
  classificarFalhaDeEnvio,
  comTempoLimite,
  gravarRegistroEmail,
  gravarSaudeDoEnvio,
  lerRegistroEmail,
  lerSaudeDoEnvio,
  mensagemDaFalha,
  type MotivoDaFalha,
  normalizarSenhaDeApp,
  registrarSaudeDoEnvio,
  type RegistroEmail,
  removerRegistroEmail,
  resolverRemetente,
  type SaudeDoEnvio,
  tentativasQueContam,
  validarUsuarioGmail,
} from "../_shared/email-da-loja.ts";
import { enviarEmail, verificarRemetente } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Quanto esperar pelo Google antes de desistir (a function não fica presa). */
const TEMPO_DO_GOOGLE_MS = 25_000;

const json = (corpo: unknown, status: number): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** MESMA cópia da credenciais-mercado-pago: lê a chave nova e cai para a legada. */
function readKey(newVar: string, legacyVar: string): string {
  try {
    const parsed = JSON.parse(Deno.env.get(newVar) ?? "{}");
    if (parsed?.default) return parsed.default;
  } catch {
    // variável ausente ou JSON inválido — segue para o fallback
  }
  return Deno.env.get(legacyVar) ?? "";
}

/**
 * Costura de teste (padrão da casa): tudo que fala com o mundo é injetável.
 * Em produção ninguém passa nada.
 */
export type CredenciaisEmailDeps = {
  supabase?: any;
  /** Devolve o uid do admin de AGORA, ou null. */
  adminAtual?: (authorization: string | null) => Promise<string | null>;
  /** Só para a porta real de admin (`adminAtualDaSessao`): o fetch do Auth/PostgREST. */
  fetchImpl?: typeof fetch;
  env?: { get(chave: string): string | undefined };
  enviarEmail?: typeof enviarEmail;
  verificarRemetente?: typeof verificarRemetente;
  /** Relógio em ms. */
  agora?: () => number;
  tempoDoEnvioMs?: number;
};

/** O que a lojista lê quando o Google responde "tudo certo" ao teste. */
const MENSAGEM_DO_TESTE_OK =
  "O Google aceitou o envio. O e-mail de teste foi para o próprio Gmail da loja. O Gmail nem sempre mostra na Caixa de Entrada o que você manda para você mesma: olhe a pasta Enviados e, se não achar, a de Spam.";

const MENSAGEM_NAO_LI_A_SENHA =
  "Não consegui ler a senha guardada. Salve o Gmail e a senha de app de novo.";
const MENSAGEM_SEM_COFRE =
  "O cofre de chaves desta loja ainda não está configurado. Fale com o suporte.";
const MENSAGEM_FALHA_INTERNA =
  "Algo saiu do previsto aqui dentro. Tente de novo em instantes.";

export async function handler(
  req: Request,
  deps: CredenciaisEmailDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(
      { erro: "Use POST com { acao: status | salvar | testar | remover }." },
      405,
    );
  }

  const env = deps.env ?? Deno.env;
  const agora = deps.agora ?? Date.now;
  const tempoDoEnvioMs = deps.tempoDoEnvioMs ?? TEMPO_DO_GOOGLE_MS;
  const enviar = deps.enviarEmail ?? enviarEmail;
  const verificar = deps.verificarRemetente ?? verificarRemetente;

  // Porta de admin ANTES de qualquer leitura, escrita ou conversa com o Google.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const adminAtual = deps.adminAtual ??
    ((authorization: string | null) =>
      adminAtualDaSessao(authorization, {
        url: supabaseUrl,
        chavePublica: readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
        chaveDeServico: serviceRoleKey,
        fetchImpl: deps.fetchImpl,
        rotulo: "[credenciais-email]",
      }));
  const uidAdmin = await adminAtual(req.headers.get("Authorization"));
  if (!uidAdmin) {
    return json(
      { erro: "Não autorizado: só o dono da loja mexe no e-mail da loja." },
      401,
    );
  }

  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "Corpo inválido: esperado JSON." }, 400);
  }

  const supabase = deps.supabase ?? createClient(supabaseUrl, serviceRoleKey);

  // ── o que a tela mostra ───────────────────────────────────────────────────
  async function montarStatus() {
    let registro: RegistroEmail | null = null;
    let problema: string | null = null;
    try {
      registro = await lerRegistroEmail(supabase);
    } catch (erro) {
      if (erro instanceof Error && erro.message === "registro_ilegivel") {
        problema = "registro_ilegivel";
      } else {
        throw erro;
      }
    }
    // A MESMA definição de quem envia (um lugar só): `origem` sai do resolvedor.
    const remetente = await resolverRemetente(supabase, { env });
    let saude: SaudeDoEnvio | null = null;
    try {
      saude = await lerSaudeDoEnvio(supabase);
    } catch {
      saude = null;
    }
    const cofrePronto = (await chaveDeCifra(env).catch(() => null)) !== null;
    return {
      usuario: registro?.usuario ?? null,
      senha_guardada: registro !== null,
      ultimo_teste: registro?.ultimo_teste ?? null,
      atualizado_em: registro?.atualizado_em ?? null,
      origem: remetente.origem === "nenhum" ? "nenhuma" : remetente.origem,
      painel_legivel: remetente.origem === "painel",
      cofre_pronto: cofrePronto,
      problema,
      saude: saude
        ? {
          ultimo_envio_ok_em: saude.ultimo_envio_ok_em,
          ultimo_envio_ok_origem: saude.ultimo_envio_ok_origem,
          ultima_falha_em: saude.ultima_falha_em,
          ultima_falha_origem: saude.ultima_falha_origem,
          codigo_falha: saude.codigo_falha,
          mensagem_da_falha: saude.codigo_falha
            ? mensagemDaFalha(saude.codigo_falha)
            : null,
        }
        : null,
    };
  }

  /**
   * Confere o limite e RESERVA a tentativa (grava antes de falar com o
   * Google). Devolve a Response de recusa, ou null quando pode seguir.
   */
  async function reservarTentativa(): Promise<Response | null> {
    const saude = await lerSaudeDoEnvio(supabase);
    const agoraMs = agora();
    const limite = avaliarLimiteDeTeste(saude.tentativas_em, agoraMs);
    if (!limite.permitido) {
      return json(
        {
          erro: `Calma: dá para tentar de novo em ${limite.esperaSegundos} segundos (o Google bloqueia a conta quando recebe tentativas demais).`,
          espere_segundos: limite.esperaSegundos,
        },
        429,
      );
    }
    saude.tentativas_em = [
      ...tentativasQueContam(saude.tentativas_em, agoraMs),
      new Date(agoraMs).toISOString(),
    ];
    await gravarSaudeDoEnvio(supabase, saude); // se não grava, lança: não fala com o Google
    return null;
  }

  /** Tira da saúde a falha do PAINEL (credencial nova ou removida: história nova). Melhor esforço. */
  async function limparFalhaDoPainel() {
    try {
      const saude = await lerSaudeDoEnvio(supabase);
      if (saude.ultima_falha_origem !== "painel") return;
      saude.ultima_falha_em = null;
      saude.ultima_falha_origem = null;
      saude.codigo_falha = null;
      await gravarSaudeDoEnvio(supabase, saude);
    } catch {
      console.error("[credenciais-email] não consegui limpar a saúde do envio");
    }
  }

  try {
    // ── status ───────────────────────────────────────────────────────────────
    if (corpo?.acao === "status") {
      return json(await montarStatus(), 200);
    }

    // ── salvar: valida, VERIFICA o login com a senha nova, e só então grava ──
    if (corpo?.acao === "salvar") {
      const usuario = validarUsuarioGmail(corpo.usuario);
      if (!usuario.ok) return json({ erro: usuario.erro }, 400);
      const senha = normalizarSenhaDeApp(corpo.senha);
      if (!senha.ok) return json({ erro: senha.erro }, 400);

      const chave = await chaveDeCifra(env);
      if (!chave) return json({ erro: MENSAGEM_SEM_COFRE }, 503);

      const recusa = await reservarTentativa();
      if (recusa) return recusa;

      const remetente = {
        origem: "painel",
        usuario: usuario.usuario,
        senha: senha.senha,
        motivo: null,
        reserva: null,
      };
      try {
        await comTempoLimite(verificar(remetente), tempoDoEnvioMs);
      } catch (erro) {
        // Só a causa, em palavra fixa: o erro do SMTP carrega a configuração.
        const motivo: MotivoDaFalha = erro instanceof Error &&
            erro.message === "tempo_esgotado"
          ? "sem_conexao"
          : classificarFalhaDeEnvio(erro);
        return json({ erro: mensagemDaFalha(motivo), motivo }, 422);
      }

      const { cifrado, iv } = await cifrar(senha.senha, chave);
      const em = new Date(agora()).toISOString();
      await gravarRegistroEmail(supabase, {
        usuario: usuario.usuario,
        senha_cifrada: cifrado,
        iv,
        atualizado_em: em,
        // O login foi aceito agora há pouco: é o primeiro "teste" desta credencial.
        ultimo_teste: { ok: true, em, motivo: null },
      });
      await limparFalhaDoPainel();
      return json(await montarStatus(), 200);
    }

    // ── testar: UM e-mail, só para o próprio Gmail cadastrado ────────────────
    if (corpo?.acao === "testar") {
      const registro = await lerRegistroEmail(supabase);
      if (!registro) {
        return json(
          { erro: "Salve o Gmail e a senha de app antes de mandar o e-mail de teste." },
          409,
        );
      }
      const chave = await chaveDeCifra(env);
      if (!chave) return json({ erro: MENSAGEM_SEM_COFRE }, 503);
      let senha: string;
      try {
        senha = await decifrar(registro.senha_cifrada, registro.iv, chave);
      } catch {
        return json({ erro: MENSAGEM_NAO_LI_A_SENHA }, 500);
      }

      const recusa = await reservarTentativa();
      if (recusa) return recusa;

      // Destinatário = o usuário do REGISTRO. Nada do corpo da requisição entra.
      const remetente = {
        origem: "painel",
        usuario: registro.usuario,
        senha,
        motivo: null,
        // Sem reserva: o teste prova a credencial do PAINEL, não a do ambiente.
        reserva: null,
        registrarSaude: (resultado) =>
          registrarSaudeDoEnvio(supabase, resultado, { agora }),
      };
      let motivo: MotivoDaFalha | null = null;
      try {
        await comTempoLimite(
          enviar(
            {
              para: registro.usuario,
              assunto: "Teste do e-mail da loja",
              html: htmlDoTeste(),
            },
            remetente,
          ),
          tempoDoEnvioMs,
        );
      } catch (erro) {
        motivo = erro instanceof Error && erro.message === "tempo_esgotado"
          ? "sem_conexao"
          : classificarFalhaDeEnvio(erro);
      }

      // A credencial pode ter sido trocada (outra aba salvou) durante o envio:
      // o resultado deste teste fala da senha ANTIGA e não pode ficar por cima.
      let fresco: RegistroEmail | null;
      try {
        fresco = await lerRegistroEmail(supabase);
      } catch {
        fresco = null;
      }
      if (!fresco || fresco.iv !== registro.iv) {
        return json(
          { erro: "O Gmail ou a senha foram trocados enquanto o teste rodava. Mande o teste de novo." },
          409,
        );
      }
      const em = new Date(agora()).toISOString();
      await gravarRegistroEmail(supabase, {
        ...fresco,
        ultimo_teste: { ok: motivo === null, em, motivo },
      });
      return json(
        motivo === null
          ? { ok: true, motivo: null, em, mensagem: MENSAGEM_DO_TESTE_OK }
          : { ok: false, motivo, em, mensagem: mensagemDaFalha(motivo) },
        200,
      );
    }

    // ── remover: apaga o registro; o que vale volta a ser o ambiente ─────────
    if (corpo?.acao === "remover") {
      await removerRegistroEmail(supabase);
      await limparFalhaDoPainel();
      return json(await montarStatus(), 200);
    }

    return json(
      { erro: "Ação desconhecida: use status, salvar, testar ou remover." },
      400,
    );
  } catch (erro) {
    // Só uma palavra fixa e o nome da função: nada do corpo da requisição, e o
    // texto de erro do banco (que pode carregar a linha) nunca sobe.
    const prefixo = erro instanceof Error ? erro.message.split(":")[0] : "erro";
    console.error(
      `[credenciais-email] falha interna (${prefixo.startsWith("storage_") || prefixo === "registro_ilegivel" ? prefixo : "inesperada"})`,
    );
    return json({ erro: MENSAGEM_FALHA_INTERNA }, 500);
  }
}

/** O corpo do e-mail de teste: sem dado nenhum, só diz que funcionou. */
function htmlDoTeste(): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="font-size: 14px; line-height: 20px; color: #3f3f46; margin: 0;">
        Este é um e-mail de teste do painel da sua loja. Se você o está lendo, o Gmail da loja já consegue enviar e-mails aos seus clientes.
      </p>
    </div>
  `;
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`. Em teste não
// sobe servidor (mesmo padrão da credenciais-mercado-pago).
const isTesting = Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");
if (!isTesting) serve((req: Request) => handler(req));
