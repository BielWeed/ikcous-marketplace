/**
 * A VOLTA DA MANUTENÇÃO — como a tela "Servidor em Manutenção" sai do ar
 * quando a loja volta (06/11/2026).
 *
 * O DEFEITO: o app lê a ficha da loja UMA vez por carregamento
 * (`src/config/fichaDaLoja.ts`) e a tela de manutenção não tinha botão nem
 * nova checagem. Quem deixava a loja aberta num celular ficava olhando
 * "Voltamos em alguns minutos!" por horas, com a loja já aberta.
 *
 * O QUE ESTE ARQUIVO FAZ, e em que ORDEM isso importa:
 *
 * 1. PERGUNTAR à ficha ATUAL (`lojaSaiuDaManutencao`): `/identidade.json` com
 *    `cache: "no-store"`. O service worker NÃO pode responder essa pergunta
 *    do cache (`src/sw/sw.ts` a deixa passar direto à rede, como a
 *    `/version.json`) — senão a resposta seria a ficha de manutenção velha
 *    que o `install` guardou, para sempre. Só `manutencao === false` conta
 *    como "voltou"; rede fora, 503, corpo torto e ficha sem o campo são
 *    "continua em manutenção".
 *
 * 2. APAGAR a cópia da página (`apagarCopiaDaPaginaGuardada`): na abertura do
 *    app o service worker responde a navegação com a cópia guardada e só
 *    atualiza em segundo plano. Recarregar sem apagá-la devolveria o MESMO
 *    HTML velho, com a ficha de manutenção dentro. Apaga-se só a entrada desta
 *    URL (em cada cache), nunca o cache inteiro: o app precisa continuar
 *    abrindo sem internet e o precache (`/index.html`, os módulos) fica onde
 *    está. Sem a cópia, a navegação vai à rede e traz a página nova.
 *
 * 3. NAVEGAR de novo ao mesmo endereço (`recarregarComPaginaNova`).
 *
 * A TRAVA CONTRA LAÇO (`podeRecarregarSozinha`): a recarga AUTOMÁTICA só
 * acontece se a ficha atual disse "voltou", mas as duas pontas podem
 * discordar por instantes (o porteiro guarda a ficha por 60 s por borda, e um
 * service worker de antes desta correção ainda responderia `/identidade.json`
 * do cache). Se a página nova voltasse a dizer "manutenção" e a pergunta
 * seguinte dissesse "voltou" de novo, haveria recarga sem fim. Por isso: no
 * máximo 3 recargas automáticas por aba em 30 minutos e nunca duas com menos
 * de 90 s de distância; sem `sessionStorage` utilizável não há como limitar,
 * então não se recarrega sozinha. O botão "Tentar de novo" não passa por esta
 * trava — quem recarrega é uma pessoa, e uma por toque.
 */
import { CAMINHO_IDENTIDADE_JSON } from "@/config/fichaDaLojaContract";
import { navegarPreservandoEndereco } from "@/lib/recuperacao-chunk";

/** De quanto em quanto tempo a tela de manutenção pergunta se a loja voltou. */
export const INTERVALO_DA_CHECAGEM_MS = 45_000;

/** Chave (sessionStorage) da lista de carimbos das recargas automáticas. */
export const CHAVE_RECARGAS_DA_MANUTENCAO = "ikcous_manutencao_recargas";

const ESPACO_MINIMO_ENTRE_RECARGAS_MS = 90_000;
const JANELA_DAS_RECARGAS_MS = 30 * 60_000;
const MAXIMO_DE_RECARGAS_NA_JANELA = 3;

/** Quanto esperar a limpeza do cache antes de navegar assim mesmo. */
const PRAZO_DA_LIMPEZA_MS = 2_000;

/** Prazo da pergunta "a loja voltou?": o MESMO da sonda de rede
 * (`PRAZO_SONDA_DE_REDE_MS`, 5 s, em recuperacao-chunk — teste confere a
 * igualdade). Valor local e não import de lá: este módulo só puxa dali a
 * navegação, e os testes da tela mockam aquele módulo só com ela. */
export const PRAZO_DA_PERGUNTA_MS = 5_000;

/** A loja já saiu da manutenção, segundo a ficha ATUAL? Nunca lança. A
 * pergunta tem prazo e é ABORTADA nele (o prazo cobre o corpo): sem isso, rede
 * pendurada deixava a pergunta aberta e o hook nunca mais perguntava. */
export async function lojaSaiuDaManutencao(): Promise<boolean> {
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), PRAZO_DA_PERGUNTA_MS);
    try {
      const resposta = await fetch(CAMINHO_IDENTIDADE_JSON, {
        cache: "no-store",
        signal: controle.signal,
      });
      if (!resposta.ok) return false;
      const ficha: unknown = await resposta.json();
      if (ficha === null || typeof ficha !== "object") return false;
      const { configuracao } = ficha as { configuracao?: unknown };
      if (configuracao === null || typeof configuracao !== "object") {
        return false;
      }
      return (configuracao as { manutencao?: unknown }).manutencao === false;
    } finally {
      clearTimeout(prazo);
    }
  } catch {
    return false;
  }
}

function lerCarimbosDasRecargas(): number[] | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_RECARGAS_DA_MANUTENCAO);
    if (bruto === null) return [];
    const lido: unknown = JSON.parse(bruto);
    if (!Array.isArray(lido)) return [];
    return lido.filter(
      (valor): valor is number =>
        typeof valor === "number" && Number.isFinite(valor),
    );
  } catch (erro) {
    // JSON ilegível vira "nenhuma recarga anotada"; armazenamento inacessível
    // (SecurityError) vira `null`, e quem pergunta trata como "sem como
    // limitar".
    return erro instanceof SyntaxError ? [] : null;
  }
}

/** Pode recarregar SOZINHA agora? Só leitura: não anota nada. */
export function podeRecarregarSozinha(agora: number = Date.now()): boolean {
  const carimbos = lerCarimbosDasRecargas();
  if (carimbos === null) return false;
  const naJanela = carimbos.filter((c) => agora - c < JANELA_DAS_RECARGAS_MS);
  if (naJanela.length >= MAXIMO_DE_RECARGAS_NA_JANELA) return false;
  const ultima = naJanela.reduce(
    (maior, c) => Math.max(maior, c),
    Number.NEGATIVE_INFINITY,
  );
  return agora - ultima >= ESPACO_MINIMO_ENTRE_RECARGAS_MS;
}

/**
 * Anota uma recarga automática (chamar ANTES de navegar). Nunca lança.
 * Devolve `false` quando não deu para gravar (armazenamento cheio ou
 * bloqueado): sem a anotação a trava não funciona, então quem chama NÃO
 * deve recarregar sozinho.
 */
export function registrarRecargaSozinha(agora: number = Date.now()): boolean {
  try {
    const anteriores = (lerCarimbosDasRecargas() ?? []).filter(
      (c) => agora - c < JANELA_DAS_RECARGAS_MS,
    );
    sessionStorage.setItem(
      CHAVE_RECARGAS_DA_MANUTENCAO,
      JSON.stringify([...anteriores, agora]),
    );
    return true;
  } catch {
    // Sem armazenamento gravável a trava não existe: avisa quem chamou.
    return false;
  }
}

/**
 * Tira dos caches a cópia da PÁGINA ATUAL que o service worker guardou na
 * navegação. Só a entrada desta URL (sem o `#fragmento`), em cada cache — o
 * precache e o resto ficam. Em `/index.html` (arquivo do precache, não cópia
 * de navegação) não faz nada. Nunca lança.
 */
export async function apagarCopiaDaPaginaGuardada(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const { origin, pathname, search } = globalThis.location;
    if (pathname.endsWith(".html")) return;
    const endereco = `${origin}${pathname}${search}`;
    for (const nome of await caches.keys()) {
      try {
        const cache = await caches.open(nome);
        await cache.delete(endereco);
      } catch {
        // Um cache que falha não impede os outros.
      }
    }
  } catch {
    // Limpeza é melhor esforço: a recarga acontece de qualquer jeito.
  }
}

/** Apaga a cópia guardada (com prazo) e navega de novo ao mesmo endereço. */
export async function recarregarComPaginaNova(): Promise<void> {
  let prazo: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    apagarCopiaDaPaginaGuardada(),
    new Promise<void>((resolve) => {
      prazo = setTimeout(resolve, PRAZO_DA_LIMPEZA_MS);
    }),
  ]);
  clearTimeout(prazo);
  navegarPreservandoEndereco();
}
