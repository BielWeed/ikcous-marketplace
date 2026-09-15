// Tradução do erro cru de invocação de Edge Function (via
// `supabase.functions.invoke`) para o que quem usa o app lê na tela.
//
// Módulo NOVO, e não uma extensão de `mensagens-auth.ts` ou de um dos
// tradutores locais de `useOrders.ts`/`useProducts.ts`: nenhum dos dois é o
// mesmo assunto. `mensagens-auth.ts` guarda só TEXTO estático de login, sem
// lógica de classificação. Os tradutores de `useOrders.ts`/`useProducts.ts`
// classificam por `error.code` no formato SQLSTATE — porque a fonte real do
// erro ali é o Postgres, via RPC/PostgREST. Aqui a fonte é o SDK
// `@supabase/functions-js`, que não devolve SQLSTATE nenhum — devolve um
// `name` de classe de erro fixo. É esse `name`, e não `code`, que prova a
// causa. Dois pontos usam esta mesma lógica hoje: `ShippingCalculator.tsx`
// (cotação de frete que o COMPRADOR vê) e `AdminShippingView.tsx` (teste de
// credenciais de frete que a LOJISTA vê) — os dois chamam a MESMA edge
// function `calculate-shipping`.
//
// CONFIRMADO NA FONTE, NÃO PRESUMIDO (node_modules/@supabase/functions-js/
// dist/main/types.js):
//
//   - `FunctionsHttpError` (resposta HTTP fora de 2xx): `.message` é SEMPRE
//     a frase fixa em inglês "Edge Function returned a non-2xx status
//     code" — o corpo de verdade que a função devolveu (que pode conter
//     texto técnico de provedor de frete, ex.: "Melhor Envio (Status 500):
//     <corpo>") mora em `error.context` (a `Response` crua), lida pelo helper
//     de código abaixo. Ou seja: `.message` NUNCA carrega a causa
//     específica aqui — só esse rótulo genérico do SDK. Por isso este caso
//     cai no genérico de quem chamou, e não presume qual foi a causa real.
//   - `FunctionsFetchError` (o `fetch` em si falhou, sem chegar a existir
//     resposta HTTP): quase sempre rede — MAS há uma segunda causa medida na
//     peça 20 (14/09/2026): FUNÇÃO NÃO PUBLICADA. O gateway do Supabase
//     responde "não existe" SEM os headers de CORS, o navegador bloqueia a
//     resposta e o SDK recebe... um fetch error. Dono viu "Verifique sua
//     internet" com a internet perfeita — a causa real era a função nova
//     ainda não publicada no projeto (404 medido direto no gateway). Por
//     isso o chamador que passa `mensagemServicoInativo` (opt-in) recebe
//     essa frase quando o navegador está ONLINE; offline segue a frase de
//     rede, que ali é a verdade.
//   - `FunctionsRelayError` (o relay da Supabase não alcançou a função):
//     infraestrutura, não é nem "sem internet da pessoa" nem uma causa de
//     negócio — cai no genérico também.
export function mensagemAmigavelErroEdgeFunction(
  error: unknown,
  opcoes: {
    /**
     * Mensagens que o PRÓPRIO chamador já escreveu, em português, para um
     * ramo que não passou pelo SDK de Edge Function (ex.: a checagem de
     * "está offline" que roda ANTES de invocar). Comparação por texto
     * exato: são um punhado de literais conhecidos, escritos no próprio
     * componente — não texto vindo de fora.
     */
    mensagensSeguras?: string[];
    /** Frase para toda causa sem tradução específica conhecida. */
    mensagemGenerica: string;
    /**
     * Frase para "serviço não está no ar nesta instalação" — OPT-IN: quem
     * não passa, mantém o comportamento de sempre (o frete, por exemplo,
     * não muda nada). Ativa dois caminhos: resposta HTTP 404/503 do
     * gateway, e fetch error com navegador online (a função não publicada
     * vira fetch error por falta de CORS — histórico no comentário acima).
     */
    mensagemServicoInativo?: string;
  },
): string {
  const detalhes = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
    context?: unknown;
  };
  const nome = typeof detalhes.name === "string" ? detalhes.name : "";
  const textoOriginal =
    typeof detalhes.message === "string" ? detalhes.message : "";

  if (opcoes.mensagensSeguras?.includes(textoOriginal)) {
    return textoOriginal;
  }

  if (nome === "FunctionsFetchError") {
    if (opcoes.mensagemServicoInativo && navegadorOnline()) {
      return opcoes.mensagemServicoInativo;
    }
    return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
  }

  if (nome === "FunctionsHttpError" && opcoes.mensagemServicoInativo) {
    const status =
      detalhes.context instanceof Response ? detalhes.context.status : null;
    if (status === 404 || status === 503) {
      return opcoes.mensagemServicoInativo;
    }
  }

  return opcoes.mensagemGenerica;
}

/**
 * Presença de rede pelo olho do NAVEGADOR (`navigator.onLine`): true não
 * prova internet boa, mas false é rede caída de verdade — é o único sinal
 * de que a máquina dispõe para separar "sua internet" de "serviço no ar".
 * Sem `navigator` (fora de navegador) trata como online: a frase de rede
 * erraria mais que a de serviço.
 */
function navegadorOnline(): boolean {
  try {
    return navigator.onLine !== false;
  } catch {
    return true;
  }
}

// Só o código escolhe uma frase conhecida pelo front: texto vindo do servidor
// nunca vai para a tela sem passar pela lista de frases locais permitidas.
export async function codigoDoErroDeEdgeFunction(
  error: unknown,
): Promise<string | null> {
  try {
    if (!error || typeof error !== "object") return null;
    const detalhes = error as { name?: unknown; context?: unknown };
    if (
      detalhes.name !== "FunctionsHttpError" ||
      typeof Response === "undefined" ||
      !(detalhes.context instanceof Response)
    ) {
      return null;
    }

    const corpo: unknown = await detalhes.context.clone().json();
    if (!corpo || typeof corpo !== "object" || !("codigo" in corpo))
      return null;
    return typeof corpo.codigo === "string" ? corpo.codigo : null;
  } catch {
    return null;
  }
}
