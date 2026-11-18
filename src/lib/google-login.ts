import { destinoPosLogin, idDoDestinoPosLogin } from "@/lib/destinoPosLogin";
import { lerChaveSupabase, lerSupabaseUrl } from "@/lib/env-valores";

let sonda: Promise<boolean> | undefined;
let googleConfirmado = false;

/** Cache só desta página: falha/timeout nunca liga um provedor. */
export function googleLigadoNestaLoja(): Promise<boolean> {
  sonda ??= consultarGoogle().then((ligado) => {
    googleConfirmado = ligado;
    return ligado;
  });
  return sonda;
}

async function consultarGoogle(): Promise<boolean> {
  const controle = new AbortController();
  let prazo: ReturnType<typeof setTimeout> | undefined;
  try {
    const consulta = async () => {
      const resposta = await fetch(
        `${lerSupabaseUrl().replace(/\/$/, "")}/auth/v1/settings`,
        { headers: { apikey: lerChaveSupabase() }, signal: controle.signal },
      );
      if (!resposta.ok) return false;
      const dados = await resposta.json();
      return dados?.external?.google === true;
    };
    // O prazo cobre também a leitura do corpo e fetches que ignoram abort.
    return await Promise.race([
      consulta(),
      new Promise<boolean>((resolve) => {
        prazo = setTimeout(() => {
          controle.abort();
          resolve(false);
        }, 3000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(prazo);
  }
}

export function navegadorInternoDaMeta(agente = navigator.userAgent): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB|BytedanceWebview|musical_ly|Line\/|Snapchat|; wv\)/i.test(
    agente,
  );
}

/** Só anuncia um botão disponível; não espera a rede nem olha o e-mail informado. */
export function mensagemComDicaGoogle(mensagem: string): string {
  return googleConfirmado && !navegadorInternoDaMeta()
    ? `${mensagem} Se você criou a conta com o Google, use o botão do Google.`
    : mensagem;
}

const CHAVE_RETORNO = "ikcous_google_retorno_v1";
const VALIDADE_MS = 30 * 60 * 1000;

/** Só o estado mínimo do roteador; nenhum token ou dado pessoal na URL. */
export function guardarDestinoGoogle(): string {
  const origem = history.state;
  const destino = destinoPosLogin(origem) ?? "profile";
  // Google é entrada de cliente, não um atalho para o painel.
  const seguro = destino.startsWith("admin") ? "profile" : destino;
  try {
    sessionStorage.setItem(
      CHAVE_RETORNO,
      JSON.stringify({
        quando: Date.now(),
        estado: {
          view: "auth",
          from: seguro,
          requested: seguro,
          id: idDoDestinoPosLogin(seguro, origem),
        },
      }),
    );
  } catch {
    // Guardar o destino é um extra: sem armazenamento (cheio ou bloqueado) a
    // volta só não lembra de onde a cliente veio; entrar com o Google não pode
    // ser impedido.
  }
  return `${location.origin}/auth`;
}

export function esquecerDestinoGoogle(): void {
  try {
    sessionStorage.removeItem(CHAVE_RETORNO);
  } catch {
    /* bloqueado */
  }
}

export interface RetornoGoogle {
  iniciado: boolean;
  checkout: boolean;
  mensagem: string | null;
  estado: {
    view: string;
    from?: string;
    requested?: string;
    id?: string;
  } | null;
}

/** Chamado antes de montar o App: devolve o state que sobrevive à saída da loja. */
export function retomarDestinoGoogle(): RetornoGoogle {
  const vazio: RetornoGoogle = {
    iniciado: false,
    checkout: false,
    mensagem: null,
    estado: null,
  };
  if (typeof window === "undefined" || location.pathname !== "/auth")
    return vazio;
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  let pendente: { quando?: number; estado?: unknown } | null = null;
  try {
    pendente = JSON.parse(sessionStorage.getItem(CHAVE_RETORNO) ?? "null");
  } catch {
    /* indisponível ou corrompido */
  }
  const valido =
    typeof pendente?.quando === "number" &&
    Date.now() >= pendente.quando &&
    Date.now() - pendente.quando < VALIDADE_MS;
  const erro = url.searchParams.get("error") ?? hash.get("error");
  const descricao =
    url.searchParams.has("error_description") || hash.has("error_description");
  const erroDeEmail =
    url.searchParams.has("type") ||
    hash.has("type") ||
    (url.searchParams.get("error_code") ?? hash.get("error_code")) ===
      "otp_expired";
  if (!valido && (!(erro || descricao) || erroDeEmail)) return vazio;
  esquecerDestinoGoogle();
  const destino = valido ? destinoPosLogin(pendente?.estado) : "profile";
  const estado =
    destino && !destino.startsWith("admin")
      ? {
          view: "auth",
          from: destino,
          requested: destino,
          id: idDoDestinoPosLogin(destino, pendente?.estado),
        }
      : { view: "auth" };
  let mensagem: string | null = null;
  if (erro || descricao) {
    mensagem =
      erro === "access_denied"
        ? "Tudo bem, a entrada com o Google foi cancelada. Você pode tentar de novo ou usar e-mail e senha."
        : "Não foi possível entrar com o Google. Use e-mail e senha ou tente de novo.";
    for (const chave of ["error", "error_code", "error_description"]) {
      url.searchParams.delete(chave);
      hash.delete(chave);
    }
    url.hash = hash.toString();
  }
  // Preserva o hash de SUCESSO: quem lê os tokens é o SDK (detectSessionInUrl).
  history.replaceState(estado, "", url.pathname + url.search + url.hash);
  return {
    iniciado: valido,
    checkout: destino === "checkout",
    mensagem,
    estado: valido ? estado : null,
  };
}
