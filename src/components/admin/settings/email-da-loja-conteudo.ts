// Conteúdo e regras PURAS da seção "E-mail da loja" (14/10/2026): o passo a
// passo para a lojista cadastrar o Gmail da loja, as mensagens de erro em
// português de leigo e a validação do que ela digita. Sem React, sem rede.
//
// O SERVIDOR é a edge `credenciais-email` (supabase/functions/credenciais-email):
// ela é o CONTRATO. Esta tela nunca mostra o texto de erro que ela devolve (o
// campo `erro` pode vir de outra camada e não é a nossa redação): traduz pelo
// CÓDIGO (`motivo`, uma lista fechada) e pelo status HTTP, com frases escritas
// aqui. Código desconhecido cai numa frase genérica, nunca vaza.
//
// FONTES DO PASSO A PASSO, conferidas em 14/10/2026:
//  - https://support.google.com/accounts/answer/185833 — a senha de app só
//    existe com a verificação em duas etapas ligada; a opção NÃO aparece se a
//    conta usa a verificação em duas etapas só com chave de segurança, se é
//    conta de trabalho/escola/organização, ou se a Proteção Avançada está
//    ligada; o endereço é myaccount.google.com/apppasswords; a senha tem 16
//    caracteres e só se vê uma vez.
//  - https://support.google.com/accounts/answer/185839 — ativar a verificação
//    em duas etapas ("Ativar a verificação em duas etapas", em Segurança).
//  - O NOME do campo ("Nome do app") e o botão ("Criar") da página de senhas de
//    app NÃO constam do texto de ajuda do Google (a página exige login); vêm de
//    guias de terceiros (snov.io, bluemail.me). Por isso o texto da tela manda
//    procurar o botão "equivalente" se o nome estiver diferente.

export const LINK_CRIAR_GMAIL = "https://accounts.google.com/signup";
export const LINK_DUAS_ETAPAS =
  "https://myaccount.google.com/signinoptions/two-step-verification";
export const LINK_SENHA_DE_APP = "https://myaccount.google.com/apppasswords";

// ── O que a edge devolve ────────────────────────────────────────────────────

/** A lista FECHADA de causas de falha da edge (`MotivoDaFalha`). */
export type MotivoDaFalha =
  | "senha_errada"
  | "precisa_senha_de_app"
  | "acesso_bloqueado"
  | "limite_diario"
  | "sem_conexao"
  | "recusado";

const MOTIVOS: ReadonlySet<string> = new Set<MotivoDaFalha>([
  "senha_errada",
  "precisa_senha_de_app",
  "acesso_bloqueado",
  "limite_diario",
  "sem_conexao",
  "recusado",
]);

/** `valor` é um motivo que a tela conhece? (palavra solta do servidor nunca vira texto) */
export function comoMotivo(valor: unknown): MotivoDaFalha | null {
  return typeof valor === "string" && MOTIVOS.has(valor)
    ? (valor as MotivoDaFalha)
    : null;
}

export type OrigemDoRemetente = "painel" | "ambiente" | "nenhuma";

export interface StatusDoEmail {
  /** O Gmail guardado (não é segredo). */
  readonly usuario: string | null;
  /** Há senha guardada? A senha em si NUNCA chega aqui. */
  readonly senhaGuardada: boolean;
  readonly ultimoTeste: {
    readonly ok: boolean;
    readonly em: string;
    readonly motivo: MotivoDaFalha | null;
  } | null;
  /** Quem está enviando de verdade: o painel, o servidor ou ninguém. */
  readonly origem: OrigemDoRemetente;
  /** A loja tem o cofre que guarda a senha cifrada? Falso = nem dá para salvar. */
  readonly cofrePronto: boolean;
  /** O registro guardado existe mas não dá para ler. */
  readonly registroIlegivel: boolean;
  /** A falha mais recente do envio (a edge já limpa a que foi resolvida). */
  readonly falha: {
    readonly em: string | null;
    readonly motivo: MotivoDaFalha;
    readonly origem: "painel" | "ambiente" | null;
  } | null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * A resposta de `status`/`salvar`/`remover` vira o estado da tela. Defensivo:
 * `cofre_pronto` só vale se for `true` (na dúvida o cofre NÃO está pronto — a
 * tela não oferece o passo a passo), origem desconhecida vira "nenhuma".
 * Devolve `null` quando nem objeto é.
 */
export function lerStatusDoEmail(dados: unknown): StatusDoEmail | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Record<string, unknown>;
  const teste = d.ultimo_teste as Record<string, unknown> | null | undefined;
  const saude = d.saude as Record<string, unknown> | null | undefined;
  const motivoDaFalha = comoMotivo(saude?.codigo_falha);
  const origemDaFalha = saude?.ultima_falha_origem;
  return {
    usuario: texto(d.usuario),
    senhaGuardada: d.senha_guardada === true,
    ultimoTeste:
      teste && typeof teste === "object" && typeof teste.ok === "boolean"
        ? {
            ok: teste.ok,
            em: texto(teste.em) ?? "",
            motivo: comoMotivo(teste.motivo),
          }
        : null,
    origem:
      d.origem === "painel" || d.origem === "ambiente" ? d.origem : "nenhuma",
    cofrePronto: d.cofre_pronto === true,
    registroIlegivel: d.problema === "registro_ilegivel",
    falha: motivoDaFalha
      ? {
          em: texto(saude?.ultima_falha_em),
          motivo: motivoDaFalha,
          origem:
            origemDaFalha === "painel" || origemDaFalha === "ambiente"
              ? origemDaFalha
              : null,
        }
      : null,
  };
}

// ── Selo de estado e saúde do envio ─────────────────────────────────────────

export type TipoDoSelo =
  | "funcionando"
  | "salvo_sem_teste"
  | "problema"
  | "nao_configurado"
  | "servidor";

export interface SeloDoEmail {
  readonly tipo: TipoDoSelo;
  readonly titulo: string;
  readonly detalhe: string;
}

/** DD/MM no fuso do aparelho; data ausente ou inválida = `null`. */
export function dataCurta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const dia = new Date(ms);
  const dd = String(dia.getDate()).padStart(2, "0");
  const mm = String(dia.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/**
 * A falha do envio que ainda vale? A edge limpa a falha quando um envio da
 * mesma origem dá certo; aqui só descartamos a que é de OUTRA origem (o
 * remetente de agora não é aquele) e a que é mais velha que um teste aprovado
 * (a limpeza é melhor esforço e pode ter falhado).
 */
export function falhaQueAindaVale(
  status: StatusDoEmail,
): StatusDoEmail["falha"] {
  const falha = status.falha;
  if (!falha) return null;
  if (falha.origem !== null && falha.origem !== status.origem) return null;
  const teste = status.ultimoTeste;
  if (status.origem === "painel" && teste?.ok === true) {
    const falhou = Date.parse(falha.em ?? "");
    const testou = Date.parse(teste.em);
    if (Number.isFinite(falhou) && Number.isFinite(testou) && testou > falhou) {
      return null;
    }
  }
  return falha;
}

/**
 * O selo do topo. REGRA DE HONESTIDADE: "Funcionando" só existe com um teste
 * aprovado gravado (`ultimo_teste.ok`) e SEM falha de envio mais nova — o
 * teste aprovado significa que o Google ACEITOU O LOGIN; que o e-mail CHEGA só
 * o "Enviar e-mail de teste" prova, e o detalhe do selo diz isso.
 */
export function seloDoEmail(status: StatusDoEmail): SeloDoEmail {
  if (status.origem === "nenhuma") {
    return {
      tipo: "nao_configurado",
      titulo: "Não configurado",
      detalhe: "Seus clientes NÃO recebem e-mail do pedido.",
    };
  }
  if (status.origem === "ambiente") {
    return {
      tipo: "servidor",
      titulo: "Configurado no servidor",
      detalhe:
        "Os e-mails já saem por uma conta guardada no servidor da loja. Você só precisa cadastrar um Gmail aqui se quiser que saiam pelo da sua loja.",
    };
  }
  // origem === "painel"
  if (falhaQueAindaVale(status)) {
    return {
      tipo: "problema",
      titulo: "Com problema",
      detalhe: "O Google recusou o último envio. Veja o aviso abaixo.",
    };
  }
  if (status.ultimoTeste?.ok === false) {
    return {
      tipo: "problema",
      titulo: "Salvo, mas o último teste falhou",
      detalhe: "Veja o aviso abaixo e envie o e-mail de teste de novo.",
    };
  }
  if (status.ultimoTeste?.ok === true) {
    return {
      tipo: "funcionando",
      titulo: "Funcionando",
      detalhe:
        "O Google aceitou o login do Gmail da loja. Para ter certeza de que o e-mail CHEGA, use o botão «Enviar e-mail de teste».",
    };
  }
  return {
    tipo: "salvo_sem_teste",
    titulo: "Salvo, ainda não testado",
    detalhe:
      "Falta enviar o e-mail de teste para ter certeza de que está tudo certo.",
  };
}

const CAUSA_CURTA: ReadonlyMap<MotivoDaFalha, string> = new Map([
  ["senha_errada", "o Google recusou a senha"],
  ["precisa_senha_de_app", "o Google exige uma senha de app"],
  ["acesso_bloqueado", "o Google bloqueou o acesso"],
  ["limite_diario", "o Google atingiu o limite de envios da conta por hoje"],
  ["sem_conexao", "não foi possível falar com o Google"],
  ["recusado", "o Google não aceitou o envio"],
]);

/** "Seus e-mails pararam em 13/10 — o Google recusou a senha." (ou null, se está tudo bem) */
export function textoDaSaudeDoEnvio(status: StatusDoEmail): string | null {
  const falha = falhaQueAindaVale(status);
  if (!falha) return null;
  const quando = dataCurta(falha.em);
  const causa = CAUSA_CURTA.get(falha.motivo) ?? "o Google recusou o envio";
  return `Seus e-mails pararam${quando ? ` em ${quando}` : ""} — ${causa}.`;
}

// ── Mensagens de erro, em português de leigo ────────────────────────────────

/** O que fazer em cada causa. Frases nossas: nada do que o servidor escreveu. */
const O_QUE_FAZER: ReadonlyMap<MotivoDaFalha, string> = new Map([
  [
    "senha_errada",
    "O Google recusou a senha. Confira se você colou a senha de APP (as 16 letras), e não a senha normal do Gmail. Se você trocou a senha do Gmail há pouco, o Google cancela as senhas de app: crie uma nova no passo 3.",
  ],
  [
    "precisa_senha_de_app",
    "Parece que foi colada a senha normal do Gmail. Aqui precisa ser a senha de app: volte ao passo 3, crie uma e cole as 16 letras.",
  ],
  [
    "acesso_bloqueado",
    "O Google bloqueou o acesso vindo do servidor. Abra o Gmail dessa conta, procure o alerta de segurança e toque em «Fui eu»; depois tente de novo. Se não houver alerta, espere alguns minutos.",
  ],
  [
    "limite_diario",
    "O Google atingiu o limite de envios desta conta por hoje. O envio volta ao normal em até 24 horas.",
  ],
  [
    "sem_conexao",
    "Não consegui falar com o Google agora. Tente de novo em instantes.",
  ],
  [
    "recusado",
    "O Google não aceitou o envio. Tente de novo; se continuar, confira a senha de app no passo 3.",
  ],
]);

export const MENSAGEM_INDISPONIVEL =
  "Este recurso ainda não está disponível nesta loja. Fale com o suporte.";
export const MENSAGEM_SEM_COFRE =
  "Esta loja ainda não está preparada para guardar a senha com segurança. Fale com o suporte.";
export const MENSAGEM_SEM_INTERNET =
  "Sem conexão com a internet. Confira o sinal e tente de novo.";
const MENSAGEM_SEM_PERMISSAO =
  "Sua sessão no painel expirou, ou esta conta não pode mexer no e-mail da loja. Saia do painel e entre de novo.";
const MENSAGEM_MUDOU =
  "O Gmail ou a senha mudaram no meio do caminho, ou ainda não foram salvos. Salve de novo e refaça o teste.";
const MENSAGEM_RECUSADO_PELO_PAINEL =
  "O painel não aceitou o Gmail ou a senha digitados. Confira os dois e tente de novo.";
const MENSAGEM_GENERICA =
  "Algo saiu do previsto no servidor. Tente de novo em instantes.";

export function mensagemDoMotivo(motivo: MotivoDaFalha | null): string {
  return (
    (motivo && O_QUE_FAZER.get(motivo)) ||
    (O_QUE_FAZER.get("recusado") as string)
  );
}

/** "3 minutos", "1 hora"... Sem número útil, "alguns instantes". */
export function descreverEspera(segundos: unknown): string {
  if (
    typeof segundos !== "number" ||
    !Number.isFinite(segundos) ||
    segundos <= 0
  ) {
    return "alguns instantes";
  }
  if (segundos < 60) {
    const s = Math.ceil(segundos);
    return `${s} ${s === 1 ? "segundo" : "segundos"}`;
  }
  if (segundos < 3600) {
    const m = Math.ceil(segundos / 60);
    return `${m} ${m === 1 ? "minuto" : "minutos"}`;
  }
  const h = Math.ceil(segundos / 3600);
  return `${h} ${h === 1 ? "hora" : "horas"}`;
}

/** O que sabemos de uma chamada que falhou (lido pelo hook, sem o texto do servidor). */
export interface FalhaDaChamada {
  /** O `fetch` nem chegou a ter resposta HTTP (rede, ou função sem CORS por não existir). */
  readonly semResposta?: boolean;
  readonly offline?: boolean;
  readonly status?: number;
  readonly motivo?: unknown;
  readonly espereSegundos?: unknown;
}

export type AcaoDoEmail = "status" | "salvar" | "testar" | "remover";

export interface FalhaTraduzida {
  readonly mensagem: string;
  /** A função nem existe nesta loja (404, ou rede estando online). */
  readonly indisponivel: boolean;
}

/** Traduz uma falha de chamada para uma frase da casa. NUNCA usa texto do servidor. */
export function traduzirFalha(
  falha: FalhaDaChamada,
  acao: AcaoDoEmail,
): FalhaTraduzida {
  const nao = (mensagem: string): FalhaTraduzida => ({
    mensagem,
    indisponivel: false,
  });
  const indisponivel: FalhaTraduzida = {
    mensagem: MENSAGEM_INDISPONIVEL,
    indisponivel: true,
  };
  if (falha.semResposta) {
    return falha.offline ? nao(MENSAGEM_SEM_INTERNET) : indisponivel;
  }
  const status = falha.status;
  if (status === 404) return indisponivel;
  if (status === 401 || status === 403) return nao(MENSAGEM_SEM_PERMISSAO);
  if (status === 429) {
    const espera = descreverEspera(falha.espereSegundos);
    return nao(
      `Calma: o Google bloqueia a conta quando recebe tentativas demais, então o painel espera um pouco entre uma e outra. Dá para tentar de novo em ${espera}.`,
    );
  }
  const motivo = comoMotivo(falha.motivo);
  if (motivo) return nao(mensagemDoMotivo(motivo));
  if (status === 503)
    return acao === "status" ? indisponivel : nao(MENSAGEM_SEM_COFRE);
  if (status === 409) return nao(MENSAGEM_MUDOU);
  if (status === 400) return nao(MENSAGEM_RECUSADO_PELO_PAINEL);
  return nao(MENSAGEM_GENERICA);
}

// ── Validação do que a lojista digita (no navegador, antes de enviar) ───────

const GMAIL = /^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/;

export function validarGmailDaLoja(
  entrada: string,
): { ok: true; usuario: string } | { ok: false; erro: string } {
  const usuario = entrada.trim().toLowerCase();
  if (!usuario) {
    return {
      ok: false,
      erro: "Digite o Gmail da loja, como nomedaloja@gmail.com.",
    };
  }
  if (!GMAIL.test(usuario) || usuario.length > 254) {
    return {
      ok: false,
      erro: "Esse endereço não parece certo. Tem de ser um Gmail inteiro, terminando em @gmail.com (outros provedores, como Outlook ou Yahoo, não funcionam aqui).",
    };
  }
  return { ok: true, usuario };
}

/**
 * Tudo que o copiar-e-colar pode ter metido entre as letras: espaço comum, o
 * espaço que não quebra (U+00A0), os outros espaços Unicode (`\s`), os
 * invisíveis de largura zero, hífen e parentes. É a MESMA lista do servidor
 * (`normalizarSenhaDeApp`): a colagem boa não pode ser recusada aqui nem lá.
 */
const RUIDO_DA_COLAGEM = /[\s\u200b-\u200d\u2060\u00ad\u2010-\u2015\u2212-]/g;

/** A senha de app do Google: 16 letras minúsculas, que o Google mostra em 4 grupos. */
export function normalizarSenhaDeApp(
  entrada: string,
): { ok: true; senha: string } | { ok: false; erro: string } {
  const senha = entrada.replace(RUIDO_DA_COLAGEM, "").toLowerCase();
  if (!senha) {
    return { ok: false, erro: "Cole a senha de app de 16 letras (passo 3)." };
  }
  if (!/^[a-z]{16}$/.test(senha)) {
    return {
      ok: false,
      erro: "A senha de app tem 16 letras (o Google mostra em 4 grupos de 4), sem números nem símbolos. Se você colou a senha que usa para entrar no Gmail, ela não serve: crie a senha de app no passo 3.",
    };
  }
  return { ok: true, senha };
}

// ── O passo a passo ─────────────────────────────────────────────────────────

export interface LinkDoPasso {
  readonly rotulo: string;
  readonly href: string;
}

export interface PassoDoGuia {
  readonly titulo: string;
  /** O que fazer, em ordem. */
  readonly fazer: readonly string[];
  readonly aparece: string;
  readonly deuCerto: string;
  readonly seDiferente: string;
  readonly link?: LinkDoPasso;
}

/** Passos 1 a 5. O 4 (colar e salvar) e o 5 (testar) têm os botões na tela. */
export const PASSOS_DO_EMAIL: readonly PassoDoGuia[] = [
  {
    titulo: "Use um Gmail só da loja",
    fazer: [
      "Se a loja já tem um Gmail só dela, use esse e vá para o próximo passo.",
      "Se não tem, abra o link abaixo e siga as telas do Google para criar uma conta nova, com o nome da loja (por exemplo nomedaloja@gmail.com).",
      "Por que um Gmail só da loja: os e-mails do pedido saem COM esse endereço (o cliente vê esse Gmail como remetente), e a senha que você vai criar dá acesso a essa conta. Com o seu e-mail pessoal, isso expõe suas conversas e enche sua caixa de respostas de clientes.",
    ],
    aparece:
      "O Google mostra o formulário de conta nova e, no fim, abre o Gmail.",
    deuCerto:
      "Você consegue abrir o Gmail com esse endereço e ver a Caixa de Entrada.",
    seDiferente:
      "Se o Google pedir um número de celular ou um código por mensagem, é normal: é a segurança dele. Se disser que o endereço já existe, escolha outro nome.",
    link: { rotulo: "Criar um Gmail", href: LINK_CRIAR_GMAIL },
  },
  {
    titulo: "Ligue a verificação em duas etapas",
    fazer: [
      "Abra o link abaixo e entre com o Gmail da loja, se o Google pedir.",
      "Toque em «Ativar a verificação em duas etapas» e siga as telas (o Google manda um código para o seu celular).",
    ],
    aparece:
      "O Google pede o seu celular, manda um código e você digita o código para confirmar.",
    deuCerto:
      "A página passa a mostrar que a verificação em duas etapas está ativada.",
    seDiferente:
      "Se a conta for de trabalho ou de escola, o administrador pode ter bloqueado: use um Gmail comum (@gmail.com) só da loja.",
    link: {
      rotulo: "Ligar a verificação em duas etapas",
      href: LINK_DUAS_ETAPAS,
    },
  },
  {
    titulo: "Crie a senha de app",
    fazer: [
      "Abra o link abaixo. O Google pode pedir a senha da conta de novo.",
      "No campo «Nome do app», digite um nome qualquer, por exemplo Loja.",
      "Toque em «Criar» (se o botão tiver outro nome, procure o equivalente).",
      "O Google mostra uma senha de 16 letras, separadas em 4 grupos. Copie agora: ela só aparece esta vez.",
    ],
    aparece: "Uma janela com a senha de app, algo como «abcd efgh ijkl mnop».",
    deuCerto: "Você copiou as 16 letras.",
    seDiferente:
      "Se a opção não aparecer: a verificação em duas etapas precisa estar ligada (passo 2). Ela também não aparece se a conta usa só a chave de segurança como verificação, se é conta de trabalho ou de escola, ou se a Proteção Avançada do Google está ligada. Nesses casos, use outro Gmail (passo 1).",
    link: { rotulo: "Criar a senha de app", href: LINK_SENHA_DE_APP },
  },
  {
    titulo: "Cole aqui o Gmail e a senha de app",
    fazer: [
      "No primeiro campo, digite o Gmail da loja.",
      "No segundo, cole a senha de app. Pode colar com ou sem os espaços.",
      "Toque em «Salvar». O painel confere com o Google se o login funciona (leva alguns segundos).",
    ],
    aparece:
      "Um aviso verde de que o Gmail foi salvo. A senha vai direto para o servidor e fica guardada cifrada; ela nunca volta para esta tela.",
    deuCerto: "O selo lá em cima muda e o campo da senha some.",
    seDiferente:
      "Se aparecer um aviso vermelho, ele diz o que fazer: leia e tente de novo.",
  },
  {
    titulo: "Envie o e-mail de teste",
    fazer: [
      "Toque em «Enviar e-mail de teste». Ele vai para o próprio Gmail da loja.",
      "Abra o Gmail da loja. O e-mail de você para você costuma aparecer na pasta ENVIADOS, e não na Caixa de Entrada. Olhe também o Spam.",
    ],
    aparece: "Um aviso verde de que o e-mail de teste foi enviado.",
    deuCerto: "Você achou o e-mail de teste na pasta Enviados (ou no Spam).",
    seDiferente:
      "Se aparecer um aviso vermelho, ele diz o que fazer. O selo «Funcionando» só quer dizer que o Google aceitou o login: quem prova que o e-mail sai é este teste.",
  },
];

export const RECADO_DE_SEGURANCA =
  "A senha de app passa só pelo servidor da loja e fica guardada cifrada. Ela nunca volta para esta tela, nem para quem trabalha no sistema.";

export const MENSAGEM_DO_TESTE_OK =
  "E-mail de teste enviado para o Gmail da loja. Procure na pasta ENVIADOS (o e-mail de você para você costuma ficar lá) e, se não achar, no Spam.";
