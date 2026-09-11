/**
 * Leitura da FICHA DA LOJA — o que o app confere ANTES de qualquer outra
 * coisa, para saber se o porteiro (`middleware.ts`, na borda) escreveu uma
 * ficha no HTML que serviu. Ver o formato e o porquê em
 * `./fichaDaLojaContract.ts`.
 *
 * FALHA FECHADA por desenho (etapa 2 da escala, 11/09/2026):
 * - ficha AUSENTE (elemento `#ikcous-loja` não existe, ou não há `document`
 *   — caso do service worker) devolve `null`. Quem chama cai no que foi
 *   ASSADO no build (transição: build de loja única, sem porteiro).
 * - ficha PRESENTE e inválida (JSON quebrado, fora do contrato, ou chave
 *   de `service_role` disfarçada de chave pública) LANÇA
 *   `IDENTITY_FICHA_INVALID` — nunca cai no assado. Num build compartilhado
 *   por N lojas o assado é a fixture "de ninguém" (ou de OUTRA loja), então
 *   "tentar o assado" seria abrir a loja errada.
 *
 * Cacheia o resultado: o DOM só é lido uma vez por carregamento de página.
 * O elemento não muda depois que o navegador terminou de montar o HTML que
 * o porteiro serviu — reler a cada chamada custaria um `JSON.parse` e uma
 * revalidação inteira à toa.
 *
 * Quem PINTA a tela quando esta função lança `IDENTITY_FICHA_INVALID` não é
 * este arquivo: `src/config/buildIdentity.ts` tem uma cópia AUTÔNOMA e
 * mínima da pintura de falha (decisão aceita pela hub, rodada 2, 11/09/2026)
 * — de propósito, sem importar nenhum módulo (nem `@/lib/env`) que dependa
 * desta leitura, porque em ESM um módulo cuja avaliação lança nunca entrega
 * seu namespace a quem o importa. Ver o cabeçalho de `buildIdentity.ts`.
 */
import { assertPublicSupabaseKey } from "@/lib/publicSupabaseKey";
import {
  IDENTITY_ASSET_ROLES,
  type PublicStoreIdentity,
  cloneStoreIdentity,
  normalizeSupabaseOrigin,
} from "@/lib/storeIdentity";
import { FICHA_DA_LOJA_ID, type FichaDaLoja } from "./fichaDaLojaContract";

let fichaCacheada: FichaDaLoja | null | undefined;

export function lerFichaDaLoja(): FichaDaLoja | null {
  if (fichaCacheada !== undefined) return fichaCacheada;

  if (typeof document === "undefined") {
    fichaCacheada = null;
    return fichaCacheada;
  }

  const elemento = document.getElementById(FICHA_DA_LOJA_ID);
  if (!elemento) {
    fichaCacheada = null;
    return fichaCacheada;
  }

  fichaCacheada = validarFicha(elemento.textContent);
  return fichaCacheada;
}

function invalida(): never {
  throw new Error("IDENTITY_FICHA_INVALID");
}

/**
 * `localUrls` tem de ter TODOS os papéis de `IDENTITY_ASSET_ROLES`
 * (`src/lib/storeIdentity.ts:4`) como URL absoluta `https://…` — é o
 * Storage público da loja, nunca um caminho local (`/store-identity/…`, que
 * só existe no build de loja única). `originals` é o array (possivelmente
 * vazio) das variantes originais enviadas, também como strings.
 */
function localUrlsValidas(
  localUrls: unknown,
): localUrls is PublicStoreIdentity["urls"] {
  if (localUrls === null || typeof localUrls !== "object") return false;
  const registro = localUrls as Record<string, unknown>;
  if (
    !Array.isArray(registro.originals) ||
    !registro.originals.every((valor) => typeof valor === "string")
  ) {
    return false;
  }
  const papeisComUrlAbsoluta = new Set(
    Object.entries(registro)
      .filter(
        ([, valor]) => typeof valor === "string" && /^https:\/\//.test(valor),
      )
      .map(([papel]) => papel),
  );
  return IDENTITY_ASSET_ROLES.every((papel) => papeisComUrlAbsoluta.has(papel));
}

/**
 * `publicUrl` tem de ser `https://` ou `http://` + host, SEM barra final,
 * caminho, busca ou fragmento — é reconstruída como `${protocol}//${host}`
 * e comparada byte a byte com o valor recebido (mesma forma que o porteiro
 * usa para montá-la, T3b: `src/hospedagem/porteiro.ts`).
 */
function publicUrlValida(publicUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return `${url.protocol}//${url.host}` === publicUrl;
}

function validarFicha(textoBruto: string | null): FichaDaLoja {
  let bruta: unknown;
  try {
    bruta = JSON.parse(textoBruto ?? "");
  } catch {
    invalida();
  }

  if (bruta === null || typeof bruta !== "object") invalida();
  const ficha = bruta as Record<string, unknown>;

  if (ficha.schemaVersion !== 1) invalida();
  if (typeof ficha.host !== "string" || ficha.host.length === 0) invalida();

  const identidadeBruta = ficha.identidade;
  if (identidadeBruta === null || typeof identidadeBruta !== "object")
    invalida();
  const { identity, localUrls, publicUrl, identityRevision } =
    identidadeBruta as Record<string, unknown>;

  let identidadeValidada: PublicStoreIdentity;
  try {
    identidadeValidada = cloneStoreIdentity(identity as PublicStoreIdentity);
  } catch {
    invalida();
  }
  if (
    !localUrlsValidas(localUrls) ||
    typeof publicUrl !== "string" ||
    !publicUrlValida(publicUrl) ||
    typeof identityRevision !== "string" ||
    identityRevision.length === 0
  ) {
    invalida();
  }

  const conexaoBruta = ficha.conexao;
  if (conexaoBruta === null || typeof conexaoBruta !== "object") invalida();
  const { supabaseUrl, publishableKey } = conexaoBruta as Record<
    string,
    unknown
  >;

  let supabaseUrlValidada: string;
  try {
    supabaseUrlValidada = normalizeSupabaseOrigin(supabaseUrl);
  } catch {
    invalida();
  }
  if (typeof publishableKey !== "string" || publishableKey.length === 0)
    invalida();
  // A MESMA checagem que o porteiro usa (T1c, rodada C, 11/09/2026): a
  // versão anterior deste arquivo tinha uma checagem PRÓPRIA e MAIS FRACA
  // (decodificava JWT e olhava só `role === "service_role"`), que existia
  // por causa de um bug no resolvedor de
  // `tests/front/perf-entrada-sem-animacao-no-1o-paint.test.ts` (não
  // normalizava `..`) — a hub já corrigiu o resolvedor, então importar
  // `assertPublicSupabaseKey` (que também rejeita `sb_secret_…`, o formato
  // NOVO de chave secreta do Supabase, que a checagem antiga deixava passar
  // por não ser JWT) deixou de quebrar aquele teste.
  try {
    assertPublicSupabaseKey(publishableKey);
  } catch {
    invalida();
  }

  // Defesa em profundidade: o projectRef DENTRO da identidade tem de ser o
  // MESMO projeto da conexão desta ficha. `cloneStoreIdentity` só garante
  // que a identidade é internamente consistente (suas próprias URLs batem
  // com o projectRef dela) — sem esta checagem, uma ficha poderia levar a
  // marca de um projeto e a conexão (banco) de outro.
  const subdominioDaConexao = new URL(supabaseUrlValidada).hostname.split(
    ".",
  )[0];
  if (identidadeValidada.projectRef !== subdominioDaConexao) invalida();

  // Falha fechada: o host que a ficha declara tem de ser o host que o
  // navegador realmente carregou — senão uma ficha de OUTRA loja, servida
  // por engano ou por cache envenenado, seria aceita como se fosse a desta
  // aba. Guardado por `typeof location`: em ambientes sem `location` (não
  // há navegador aqui além de `document`), a checagem não se aplica.
  if (
    typeof location !== "undefined" &&
    ficha.host !== location.hostname.toLowerCase()
  ) {
    invalida();
  }

  return {
    schemaVersion: 1,
    host: ficha.host as string,
    identidade: {
      identity: identidadeValidada,
      localUrls: localUrls as PublicStoreIdentity["urls"],
      publicUrl: publicUrl as string,
      identityRevision: identityRevision as string,
    },
    conexao: {
      supabaseUrl: supabaseUrlValidada,
      publishableKey,
    },
  };
}
