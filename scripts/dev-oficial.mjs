// Sobe o app local (vite) ligado ao banco OFICIAL da loja IKCOUS, sem ler nem
// editar nenhum `.env`.
//
// POR QUE EXISTE: o `.env.local` do projeto original ainda aponta para o
// Supabase ANTIGO (`dekxab...`, ver a memoria "ikcous-loja-supabase-dekxab").
// `npm run dev` abre um app de titulo certo, com produtos carregados, mas que
// fala com o banco velho (produtos de teste, faltam banner e migrations). Esse
// engano ja custou tempo em 10/10 e 19/10/2026 e o dono viu de novo em 23/10.
//
// COMO FUNCIONA: pede a pagina publicada da IKCOUS, le dali a ficha publica da
// loja (URL do Supabase e a chave PUBLICA, a mesma que qualquer visitante recebe
// no HTML), CONFERE o projeto contra o canal versionado em
// scripts/frota/canais-de-backend.json e so entao sobe o vite com essas duas
// variaveis no ambiente DO PROCESSO (variavel ja existente ao subir o vite vence
// o `.env.local`). A chave nunca e impressa; segredo de servidor nunca passa por
// aqui. Nada e gravado em disco. Pagamento online e demais variaveis publicas
// continuam vindo do `.env.local`, que o lancador nao toca.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PAGINA_OFICIAL = "https://ickous-marketplace.vercel.app/";

/** Le `{supabaseUrl, publishableKey}` da ficha embutida no HTML publicado. */
export function extrairConexaoDaFicha(html) {
  const achado = /"conexao"\s*:\s*\{([^}]*)\}/.exec(String(html));
  if (!achado) return null;
  let conexao;
  try {
    conexao = JSON.parse(`{${achado[1]}}`);
  } catch {
    return null;
  }
  const { supabaseUrl, publishableKey } = conexao;
  if (typeof supabaseUrl !== "string" || typeof publishableKey !== "string") {
    return null;
  }
  if (!supabaseUrl || !publishableKey) return null;
  return { supabaseUrl, publishableKey };
}

/** Ref (20 letras) do projeto Supabase que a loja de nome `nome` usa, no canal versionado. */
export function refDoCanal(canais, nome) {
  const entrada = Object.entries(canais?.canais ?? {}).find(
    ([, canal]) => canal?.nome === nome,
  );
  return entrada ? entrada[0] : null;
}

/** Recusa (com motivo) tudo que nao seja exatamente o projeto oficial; devolve null se ok. */
export function motivoDeRecusa(conexao, refEsperado) {
  if (!conexao) return "a pagina publicada nao trouxe a ficha da loja";
  if (!refEsperado) return "a IKCOUS nao esta no canais-de-backend.json";
  let host;
  try {
    host = new URL(conexao.supabaseUrl).host;
  } catch {
    return "a URL do Supabase da ficha nao e valida";
  }
  if (host !== `${refEsperado}.supabase.co`) {
    return `a ficha aponta para ${host}, mas o banco oficial e ${refEsperado}.supabase.co`;
  }
  return null;
}

async function main() {
  const canais = JSON.parse(
    readFileSync(join(RAIZ, "scripts/frota/canais-de-backend.json"), "utf8"),
  );
  const refEsperado = refDoCanal(canais, "IKCOUS");
  const resposta = await fetch(PAGINA_OFICIAL, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!resposta.ok) {
    throw new Error(`${PAGINA_OFICIAL} respondeu HTTP ${resposta.status}`);
  }
  const conexao = extrairConexaoDaFicha(await resposta.text());
  const recusa = motivoDeRecusa(conexao, refEsperado);
  if (recusa) throw new Error(recusa);

  console.log(
    `[dev:oficial] banco oficial confirmado: ${new URL(conexao.supabaseUrl).host} (ref do canal IKCOUS)`,
  );
  const filho = spawn(
    process.execPath,
    [join(RAIZ, "node_modules/vite/bin/vite.js"), ...process.argv.slice(2)],
    {
      cwd: RAIZ,
      stdio: "inherit",
      env: {
        ...process.env,
        // A trava de identidade do vite exige o endereco publico da loja.
        VITE_APP_URL: PAGINA_OFICIAL.replace(/\/$/, ""),
        VITE_SUPABASE_URL: conexao.supabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: conexao.publishableKey,
        VITE_SUPABASE_ANON_KEY: conexao.publishableKey,
      },
    },
  );
  const parar = () => filho.kill();
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
  filho.on("exit", (codigo) => process.exit(codigo ?? 0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((erro) => {
    console.error(`[dev:oficial] NAO subiu: ${erro.message}`);
    process.exit(1);
  });
}
