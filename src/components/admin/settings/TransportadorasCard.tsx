import { GuiaDaChaveDoProvedor } from "@/components/admin/settings/GuiaDaChaveDoProvedor";
import { LogoDaTransportadora } from "@/components/shipping/MarcaDoFrete";
import { Switch } from "@/components/ui/switch";
import { logoDoAgregador, marcaDoFrete } from "@/lib/marca-do-frete";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

/**
 * RELEASE 1.5.7 v2 — FRETE COM VÁRIOS PROVEDORES (ME + SuperFrete + Frenet).
 *
 * MUDANÇA DE ARQUITETURA (CONTRATO-1.5.7.md, EMENDA R2): esta seção deixa de
 * ser "escolha UM provedor" (radiogroup) e vira "configure CADA provedor, e
 * escolha quais estão LIGADOS na loja". As duas metades são independentes:
 * salvar a chave de um provedor NUNCA liga/desliga nada sozinho.
 *
 * TODA leitura e gravação passa pela edge (`calculate-shipping`). O
 * navegador NUNCA mais faz `select`/`upsert` direto em
 * `store_shipping_credentials` — nem para ler "tem chave", nem para gravar
 * `{token}`. Quem decide o que existe e o que é ligado é o servidor
 * (service role), inclusive a linha especial `_ligados` (R2-1) que guarda o
 * conjunto ligado da loja — este componente só enxerga o resultado já
 * pronto de `ler_configuracao_frete`.
 *
 * `servicos`: a lista de serviços reais da conta (ids do Melhor Envio/
 * SuperFrete, `ServiceCode` da Frenet) vem de `list_services`. Ela só entra
 * no pedido de salvar quando CARREGOU e a lojista MEXEU nela (regra 3 do
 * despacho) — sem isso, uma falha de rede na listagem nunca apaga o filtro
 * legado que já funcionava.
 */

export type ProvedorFrete = "melhor_envio" | "superfrete" | "frenet";

export interface ServicoDoProvedor {
  readonly codigo: string;
  readonly transportadora: string;
  readonly servico: string;
  readonly ausenteDaListaDaApi?: boolean;
}

export interface ConfigDoProvedor {
  readonly tem_chave: boolean;
  readonly sandbox: boolean;
  readonly servicos: readonly string[] | null;
  readonly seguro?: "valor_dos_produtos" | "sem_seguro";
  readonly contato_email?: string;
  readonly precisa_salvar_de_novo?: boolean;
}

export interface ConfiguracaoDeFrete {
  readonly modo: "legado" | "multi";
  readonly ligados: readonly ProvedorFrete[];
  readonly provedores: ReadonlyMap<ProvedorFrete, ConfigDoProvedor>;
}

// `Map`, não `Record` indexado por variável — `provider` é uma UNIÃO
// FECHADA, mas o eslint-plugin-security não distingue isso de um
// dicionário arbitrário e acusa `security/detect-object-injection` em
// toda indexação dinâmica (`NOME_DO_PROVEDOR[provider]`). Mesma técnica de
// `statusConfigByKey` em useOrders.ts: `Map.get` não é indexação para o
// eslint. `NOME_DO_PROVEDOR_ROTULOS` abaixo é só o literal fonte, legível
// como Record; o Map é o que o código de verdade consulta.
const NOME_DO_PROVEDOR_ROTULOS: Readonly<Record<ProvedorFrete, string>> = {
  melhor_envio: "Melhor Envio",
  superfrete: "SuperFrete",
  frenet: "Frenet",
};
export const NOME_DO_PROVEDOR: ReadonlyMap<ProvedorFrete, string> = new Map(
  Object.entries(NOME_DO_PROVEDOR_ROTULOS) as [ProvedorFrete, string][],
);
function nomeDoProvedor(provider: ProvedorFrete): string {
  return NOME_DO_PROVEDOR.get(provider) ?? provider;
}

// Ordem fixa do contrato (§4 save_active_providers — mesma ordem do
// espelho `store_config.shipping_provider`), reaproveitada aqui só para a
// ORDEM DE EXIBIÇÃO dos três cartões — não muda nenhuma regra de negócio.
const ORDEM_DOS_PROVEDORES: readonly ProvedorFrete[] = [
  "melhor_envio",
  "superfrete",
  "frenet",
];

// Só ME e SuperFrete têm ambiente de testes — a Frenet não tem sandbox no
// contrato (§1).
const PROVEDORES_COM_SANDBOX: ReadonlySet<ProvedorFrete> = new Set([
  "melhor_envio",
  "superfrete",
]);

// Ids do Melhor Envio que exigem agência própria (LATAM Cargo, Azul) — a
// etiqueta recusa esses ids (A7/R1-6) porque o app não manda agência. O
// aviso aqui é PREVENTIVO: a lojista pode LIGAR o serviço (ele cota e vende
// no checkout), mas precisa saber, ANTES de vender, que a etiqueta desse
// pedido não sai pelo app.
const IDS_ME_QUE_EXIGEM_AGENCIA: ReadonlySet<string> = new Set([
  "12",
  "15",
  "16",
  "22",
]);
const AVISO_ID_EXIGE_AGENCIA =
  "Vende no checkout, mas a etiqueta tem de ser feita no site do Melhor Envio.";

/**
 * Chama uma ação da edge `calculate-shipping` e devolve o corpo da
 * resposta — nunca lança para quem chama tratar erro de rede como qualquer
 * outra falha (o `try/catch` de cada handler decide a mensagem).
 */
async function chamarEdgeDeFrete(
  body: Record<string, unknown>,
): Promise<{ data: any; error: unknown }> {
  const resposta = await supabase.functions.invoke("calculate-shipping", {
    body,
  });
  return { data: resposta?.data, error: resposta?.error };
}

/**
 * Lê a configuração de frete inteira pela edge (`ler_configuracao_frete`) —
 * usada por esta seção e, para mostrar os provedores LIGADOS do modo multi
 * sem depender do espelho `shipping_provider` (EMENDA R2, R2-5), por
 * `HistoricoCotacoesCard.tsx` e `AdminSettingsView.tsx`.
 */
export async function buscarConfiguracaoDeFrete(): Promise<
  { ok: true; config: ConfiguracaoDeFrete } | { ok: false }
> {
  try {
    const { data, error } = await chamarEdgeDeFrete({
      action: "ler_configuracao_frete",
    });
    if (error || !data?.success) return { ok: false };
    const ligados = Array.isArray(data.ligados)
      ? (data.ligados.filter((p: unknown) =>
          ORDEM_DOS_PROVEDORES.includes(p as ProvedorFrete),
        ) as ProvedorFrete[])
      : [];
    // `Map` a partir do JSON da edge (`Object.entries`, nunca indexação por
    // variável) — mesma técnica de `NOME_DO_PROVEDOR` acima.
    const provedores = new Map(
      Object.entries(data.provedores ?? {}) as [
        ProvedorFrete,
        ConfigDoProvedor,
      ][],
    );
    return {
      ok: true,
      config: {
        modo: data.modo === "multi" ? "multi" : "legado",
        ligados,
        provedores,
      },
    };
  } catch (err) {
    console.error("[TransportadorasCard] Erro ao ler configuração:", err);
    return { ok: false };
  }
}

/**
 * E-mail de contato técnico da SuperFrete (release 1.5.5, preservado
 * intacto na v2) — CÓPIA da régua da edge (`emailDeContatoValido`). Quem
 * decide é a edge; esta cópia só evita uma ida ao servidor com e-mail
 * obviamente inválido. EXPORTADA (revisão do pacote P, achado 2): a tela de
 * Frete precisa da MESMA régua para saber se uma chave salva está de fato
 * completa (estado "incompleta" de `AdminShippingView.tsx`) — uma segunda
 * cópia divergiria cedo ou tarde.
 */
export function emailDeContatoValido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const email = valor.trim();
  if (email.length === 0 || email.length > 254) return null;
  const arroba = email.indexOf("@");
  if (arroba <= 0 || arroba !== email.lastIndexOf("@")) return null;
  if (!/^[A-Za-z0-9._%+-]+$/.test(email.slice(0, arroba))) return null;
  const rotulos = email.slice(arroba + 1).split(".");
  if (rotulos.length < 2) return null;
  if (!/^[A-Za-z]{2,}$/.test(rotulos.at(-1) ?? "")) return null;
  return rotulos.every((rotulo) => /^[A-Za-z0-9-]+$/.test(rotulo))
    ? email
    : null;
}

// CONTRATO-1.5.7.md §9 R3-7 (ordem do dono, 22/09/2026): o Melhor Envio
// também exige e-mail de contato em cada consulta — ganha o MESMO campo,
// MESMA validação (`emailDeContatoValido`) e MESMAS mensagens que a
// SuperFrete usa desde a 1.5.5, só trocando o nome do provedor na frase.
// O e-mail entra na cotação/teste dos DOIS (cada "consulta" precisa dele) —
// mas SALVAR a credencial diverge: a SuperFrete continua exigindo o e-mail
// para gravar (regra 1.5.5, intacta); o Melhor Envio aceita gravar SEM
// e-mail (campo vazio = mantém o que já estava salvo no servidor — mesma
// filosofia do campo de chave, que também é vazio-mantém) e é a ATIVAÇÃO
// (`save_active_providers`) quem recusa ligar o ME sem e-mail, com a
// mensagem que o servidor devolver.
const PROVEDORES_COM_EMAIL_EM_CONSULTA: ReadonlySet<ProvedorFrete> = new Set([
  "melhor_envio",
  "superfrete",
]);
// EXPORTADA: é também a régua do estado "incompleta" que
// `AdminShippingView.tsx` usa (revisão do pacote P, achado 2) — só a
// SuperFrete tem o e-mail preso À PRÓPRIA CHAVE do lado da edge
// (acoes.ts/save_credentials: `provider === 'superfrete' &&
// !emailDeContatoValido(...)` recusa GRAVAR); o Melhor Envio aceita a
// chave sem e-mail e só recusa LIGAR sem ele (`save_active_providers`).
export const PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR: ReadonlySet<ProvedorFrete> =
  new Set(["superfrete"]);
// Nome dos serviços que a tela conhece sem perguntar à transportadora — para
// mostrar a seleção SALVA antes de "Ver serviços da conta" (PR #637). Código
// fora daqui aparece cru, que é o que o servidor guarda.
const NOME_DO_SERVICO_CONHECIDO: ReadonlyMap<string, string> = new Map([
  ["frenet:JTE_INT", "J&T Express — Standard"],
]);

function nomeDoServicoSalvo(provider: ProvedorFrete, codigo: string): string {
  return NOME_DO_SERVICO_CONHECIDO.get(`${provider}:${codigo}`) ?? codigo;
}

/**
 * Cartão expansível (pedido do dono, 23/09/2026 — os cartões ficaram longos
 * demais no celular): fechado mostra só nome + estado em palavras; clique
 * no cabeçalho revela chave, e-mail, modo de teste, serviços e botões.
 *
 * Estado inicial de cada cartão: ABERTO quando há pendência (sem chave,
 * `precisa_salvar_de_novo`, ou — só a SuperFrete exige isso para GRAVAR —
 * chave salva sem e-mail de contato válido); FECHADO quando o provedor já
 * está configurado e nada precisa da atenção da lojista agora. Calculado
 * uma vez, ao montar o cartão (a seção só monta os cartões depois que
 * `ler_configuracao_frete` respondeu — nunca com dado velho) — depois disso
 * quem manda é o clique da lojista, nunca mais um recálculo automático:
 * salvar não pode fechar um cartão que ela decidiu deixar aberto, nem
 * reabrir um que ela fechou.
 */
function temPendencia(
  provider: ProvedorFrete,
  salvo: ConfigDoProvedor | undefined,
): boolean {
  if (salvo?.precisa_salvar_de_novo) return true;
  if (!(salvo?.tem_chave ?? false)) return true;
  if (
    PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(provider) &&
    !emailDeContatoValido(salvo?.contato_email)
  ) {
    return true;
  }
  return false;
}

/** Resumo do estado do cartão FECHADO, em palavras — nunca o segredo. */
function resumoDoCartao(
  provider: ProvedorFrete,
  salvo: ConfigDoProvedor | undefined,
  ligado: boolean,
  sandbox: boolean,
  quantidadeServicos: number,
): { estado: string; servicos?: string } {
  const temChave = salvo?.tem_chave ?? false;
  const estado = salvo?.precisa_salvar_de_novo
    ? "Precisa salvar de novo"
    : !temChave
      ? "Sem chave"
      : PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(provider) &&
          !emailDeContatoValido(salvo?.contato_email)
        ? "Sem e-mail de contato"
        : sandbox
          ? "Modo de testes"
          : ligado
            ? "Ligado"
            : "Chave salva, desligado";
  return {
    estado,
    servicos:
      quantidadeServicos > 0
        ? `${quantidadeServicos} serviço${quantidadeServicos === 1 ? "" : "s"} escolhido${quantidadeServicos === 1 ? "" : "s"}`
        : undefined,
  };
}

function mensagemParaAtivar(provider: ProvedorFrete): string {
  return `Cole a chave de acesso e preencha o e-mail de contato d${
    provider === "melhor_envio" ? "o" : "a"
  } ${nomeDoProvedor(provider)}.`;
}
const MENSAGEM_EMAIL_INVALIDO =
  "Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br).";
// Revisão do pacote P (ANOTADO barato): só a SuperFrete exige o e-mail
// para SALVAR — o Melhor Envio só o exige para TESTAR (salvar aceita
// vazio, R3-7). A frase dizia "testar e salvar" para os dois; agora só
// promete o que é verdade PARA aquele provedor.
function mensagemEmailVazio(provider: ProvedorFrete): string {
  const finalidade = PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(provider)
    ? "testar e salvar"
    : "testar";
  return `Preencha o e-mail de contato técnico para ${finalidade} ${
    provider === "melhor_envio" ? "o" : "a"
  } ${nomeDoProvedor(provider)}.`;
}

/** Mensagem honesta por motivo de falha do teste (R1-8: nunca confunde
 * "chave recusada" com "indisponível" nem com "serviço sem cotação"). */
function mensagemDoMotivo(motivo: unknown, respostaErro: unknown): string {
  switch (motivo) {
    case "chave_recusada":
      return "A chave foi recusada pelo provedor. Confira se copiou certo.";
    case "indisponivel":
      return "O provedor não respondeu agora. Tente de novo em instantes.";
    case "sem_servicos":
      return "Nenhum serviço encontrado para testar. Marque ao menos um serviço da lista.";
    case "sem_cotacao_valida":
      return "A chave está certa; estes serviços não cotaram para o pacote de teste.";
    default:
      return typeof respostaErro === "string" && respostaErro
        ? respostaErro
        : "Falha na validação das credenciais.";
  }
}

interface ServicoTestado {
  readonly codigo: string;
  readonly ok: boolean;
  readonly preco?: number;
  readonly prazo?: number;
  readonly motivo?: "erro_do_servico" | "nao_retornado";
  readonly detalhe?: string;
}

interface ResultadoDeTeste {
  readonly sucesso: boolean;
  readonly mensagem: string;
  readonly servicosTestados?: readonly ServicoTestado[];
}

/** Resumo por serviço (R1-8, ANOTADO da revisão Opus): "SEDEX: não cotou
 * (erro do serviço); PAC: cotou certo" — a MESMA granularidade que o
 * "Testar" já mostrava, agora também na recusa de salvar/ligar, para a
 * lojista saber QUAL serviço travou, não só que algo travou. */
function resumoServicosTestados(
  servicosTestados: readonly ServicoTestado[] | undefined,
): string | undefined {
  if (!servicosTestados || servicosTestados.length === 0) return undefined;
  return servicosTestados
    .map(
      (s) =>
        `${s.codigo}: ${
          s.ok
            ? "cotou certo"
            : s.motivo === "erro_do_servico"
              ? `não cotou (${s.detalhe ?? "erro do serviço"})`
              : "não retornou"
        }`,
    )
    .join("; ");
}

/** Rascunho local de UM provedor — tudo que a lojista ainda não salvou. */
interface RascunhoDoProvedor {
  tokenDigitado: string;
  sandboxEscolhido?: boolean;
  emailDigitado: string;
  seguroEscolhido?: "valor_dos_produtos" | "sem_seguro";
  servicosCarregados: ServicoDoProvedor[] | null;
  servicosSelecionados: ReadonlySet<string> | null;
  servicosMexeu: boolean;
  /** `true` quando `list_services` veio do catálogo documentado da
   * SuperFrete (`origem:'catalogo_documentado'`, aviso da hub 22/09) —
   * ela lista o que EXISTE no plano, não o que a conta tem ativo. A
   * disponibilidade real só se confirma pelo "Testar" (`servicosTestados`). */
  servicosDoCatalogo: boolean;
  carregandoServicos: boolean;
  erroServicos: boolean;
  testando: boolean;
  resultadoTeste: ResultadoDeTeste | null;
  salvando: boolean;
}

function rascunhoVazio(): RascunhoDoProvedor {
  return {
    tokenDigitado: "",
    emailDigitado: "",
    servicosCarregados: null,
    servicosSelecionados: null,
    servicosMexeu: false,
    servicosDoCatalogo: false,
    carregandoServicos: false,
    erroServicos: false,
    testando: false,
    resultadoTeste: null,
    salvando: false,
  };
}

interface TransportadorasSectionProps {
  /** Avisa o pai (Ajustes) quando há alteração não salva — a seção não
   * pode fechar com trabalho pendente (mesma trava de sempre). */
  readonly onDirtyMudou?: (dirty: boolean) => void;
  /** Revisão Opus (achado 5, rodada 2): o subtítulo "Ativo: X" da seção em
   * Ajustes só lia os provedores ligados UMA VEZ, ao montar — salvar aqui
   * não atualizava aquele texto até a página recarregar. Avisa o pai a
   * cada leitura (montagem e depois de cada `carregar()` bem-sucedido)
   * para o subtítulo nunca ficar contando uma história velha. Carrega
   * também o `Map` de provedores (não só a lista de ligados): o pai
   * precisa de `contato_email`/`tem_chave` para saber se um provedor
   * ligado está de fato COMPLETO (achado 2 da rodada 2 — "incompleta"
   * tem de valer aqui também, não só na tela de Frete). */
  readonly onLigadosMudou?: (
    ligados: readonly ProvedorFrete[],
    provedores: ReadonlyMap<ProvedorFrete, ConfigDoProvedor>,
  ) => void;
}

export const TransportadorasSection = memo(function TransportadorasSection({
  onDirtyMudou,
  onLigadosMudou,
}: TransportadorasSectionProps) {
  const [carregado, setCarregado] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [modo, setModo] = useState<"legado" | "multi">("legado");
  const [provedoresSalvos, setProvedoresSalvos] = useState<
    ReadonlyMap<ProvedorFrete, ConfigDoProvedor>
  >(() => new Map());
  const [ligadosSalvos, setLigadosSalvos] = useState<
    ReadonlySet<ProvedorFrete>
  >(() => new Set());
  const [ligadosEscolhidos, setLigadosEscolhidos] = useState<
    ReadonlySet<ProvedorFrete>
  >(() => new Set());
  const [salvandoLigados, setSalvandoLigados] = useState(false);
  // PR #637: a recusa do "Salvar provedores" fica ESCRITA no bloco até a
  // escolha mudar — só o toast some no celular antes de ser lido.
  const [erroLigados, setErroLigados] = useState<{
    readonly mensagem: string;
    readonly resumo?: string;
  } | null>(null);

  // `Map`, não `Record` indexado por `provider` — mesmo motivo de
  // `NOME_DO_PROVEDOR` (o eslint não distingue união fechada de dicionário
  // arbitrário). `rascunhoDoProvider` abaixo garante o fallback vazio para
  // quem consome (as três chaves sempre existem depois do `carregar()`
  // inicial, mas o tipo de `Map.get` é honesto sobre isso).
  const [rascunhos, setRascunhos] = useState<
    ReadonlyMap<ProvedorFrete, RascunhoDoProvedor>
  >(
    () =>
      new Map(
        ORDEM_DOS_PROVEDORES.map((provider) => [provider, rascunhoVazio()]),
      ),
  );
  const rascunhoDoProvider = useCallback(
    (provider: ProvedorFrete): RascunhoDoProvedor =>
      rascunhos.get(provider) ?? rascunhoVazio(),
    [rascunhos],
  );

  const atualizarRascunho = useCallback(
    (provider: ProvedorFrete, patch: Partial<RascunhoDoProvedor>) => {
      setRascunhos((prev) => {
        const proximo = new Map(prev);
        proximo.set(provider, {
          ...(prev.get(provider) ?? rascunhoVazio()),
          ...patch,
        });
        return proximo;
      });
    },
    [],
  );

  // `resetarRascunhoDe`: revisão Opus (ANOTADO barato) — `carregar()`
  // recarregava e ZERAVA os rascunhos dos TRÊS provedores toda vez, mesmo
  // quando só UM foi salvo. Salvar o Melhor Envio apagava, em silêncio, o
  // token que a lojista já tinha colado no card da Frenet e ainda não
  // salvara. Agora:
  //   "tudo"     — carga inicial e "Tentar de novo": ainda não há rascunho
  //                de ninguém para preservar, parte tudo do zero;
  //   provider   — `salvarProvedor` passa QUEM acabou de ser salvo: só o
  //                rascunho dele volta limpo (a chave nova já está
  //                gravada); os demais mantêm o que estava sendo digitado;
  //   "nenhum"   — `salvarLigados` passa isto: liga/desliga NUNCA mexe em
  //                credencial nenhuma, então nenhum rascunho é tocado.
  const carregar = useCallback(
    async (resetarRascunhoDe: "tudo" | ProvedorFrete | "nenhum" = "tudo") => {
      setErroCarga(false);
      const resultado = await buscarConfiguracaoDeFrete();
      if (!resultado.ok) {
        setErroCarga(true);
        return;
      }
      const { config } = resultado;
      setModo(config.modo);
      setProvedoresSalvos(config.provedores);
      setLigadosSalvos(new Set(config.ligados));
      setLigadosEscolhidos(new Set(config.ligados));
      // A escolha pendente acabou de voltar à do servidor — a recusa que
      // falava dela sai junto (revisão Opus, PR #637).
      setErroLigados(null);
      if (resetarRascunhoDe !== "nenhum") {
        const rascunhoFresco = (
          provider: ProvedorFrete,
        ): RascunhoDoProvedor => ({
          ...rascunhoVazio(),
          emailDigitado: config.provedores.get(provider)?.contato_email ?? "",
        });
        if (resetarRascunhoDe === "tudo") {
          setRascunhos(
            () =>
              new Map(
                ORDEM_DOS_PROVEDORES.map((provider) => [
                  provider,
                  rascunhoFresco(provider),
                ]),
              ),
          );
        } else {
          const provider = resetarRascunhoDe;
          setRascunhos((prev) => {
            const proximo = new Map(prev);
            // PR #637: a lista já aberta continua aberta, marcada com o que
            // o SERVIDOR devolveu como salvo — antes ela sumia e a tela
            // voltava a "Ver serviços da conta", parecendo que nada gravou.
            const carregados = prev.get(provider)?.servicosCarregados ?? null;
            const salvos = new Set(
              config.provedores.get(provider)?.servicos ?? [],
            );
            proximo.set(provider, {
              ...rascunhoFresco(provider),
              servicosCarregados: carregados,
              servicosDoCatalogo:
                prev.get(provider)?.servicosDoCatalogo ?? false,
              servicosSelecionados: carregados
                ? new Set(
                    carregados
                      .map((s) => s.codigo)
                      .filter((codigo) => salvos.has(codigo)),
                  )
                : null,
            });
            return proximo;
          });
        }
      }
      setCarregado(true);
    },
    [],
  );

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sandboxAtual = useCallback(
    (provider: ProvedorFrete): boolean => {
      const r = rascunhoDoProvider(provider);
      if (r.sandboxEscolhido !== undefined) return r.sandboxEscolhido;
      return provedoresSalvos.get(provider)?.sandbox ?? false;
    },
    [rascunhoDoProvider, provedoresSalvos],
  );

  // Dirty geral: qualquer rascunho tocado, ou a escolha de ligados diferente
  // da salva.
  const isDirty = useMemo(() => {
    for (const provider of ORDEM_DOS_PROVEDORES) {
      const r = rascunhos.get(provider) ?? rascunhoVazio();
      const salvo = provedoresSalvos.get(provider);
      if (r.tokenDigitado.trim() !== "") return true;
      if (
        r.sandboxEscolhido !== undefined &&
        r.sandboxEscolhido !== (salvo?.sandbox ?? false)
      )
        return true;
      if (
        PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) &&
        r.emailDigitado.trim() !== (salvo?.contato_email ?? "")
      )
        return true;
      if (
        r.seguroEscolhido &&
        r.seguroEscolhido !== (salvo?.seguro ?? "valor_dos_produtos")
      )
        return true;
      if (r.servicosMexeu) return true;
    }
    if (ligadosEscolhidos.size !== ligadosSalvos.size) return true;
    for (const p of ligadosEscolhidos) {
      if (!ligadosSalvos.has(p)) return true;
    }
    return false;
  }, [rascunhos, provedoresSalvos, ligadosEscolhidos, ligadosSalvos]);

  useEffect(() => {
    onDirtyMudou?.(isDirty);
  }, [isDirty, onDirtyMudou]);

  // Achado 5: dispara a cada leitura confirmada (montagem, e de novo após
  // qualquer `carregar()` bem-sucedido) — nunca só na montagem. Leva o
  // `Map` de provedores junto (achado 2, rodada 2): o pai precisa dele
  // para saber se um ligado está de fato completo.
  useEffect(() => {
    if (!carregado) return;
    onLigadosMudou?.(Array.from(ligadosSalvos), provedoresSalvos);
  }, [carregado, ligadosSalvos, provedoresSalvos, onLigadosMudou]);

  const listarServicos = useCallback(
    async (provider: ProvedorFrete) => {
      const r = rascunhoDoProvider(provider);
      const digitada = r.tokenDigitado.trim();
      atualizarRascunho(provider, {
        carregandoServicos: true,
        erroServicos: false,
        resultadoTeste: null,
      });
      try {
        const { data, error } = await chamarEdgeDeFrete({
          action: "list_services",
          provider,
          ...(digitada ? { token: digitada } : {}),
        });
        if (error || !data?.success || !Array.isArray(data.servicos)) {
          atualizarRascunho(provider, {
            carregandoServicos: false,
            erroServicos: true,
          });
          toast.error(
            mensagemAmigavelErroEdgeFunction(error as Error | undefined, {
              mensagemGenerica:
                typeof data?.error === "string" && data.error
                  ? data.error
                  : "Não foi possível carregar os serviços desta transportadora.",
            }),
          );
          return;
        }
        // A Frenet documenta J&T Standard (JTE_INT), mas /shipping/info
        // lista apenas os serviços vinculados ao token. Deixe a opção
        // visível quando ausente e exija a cotação real antes de salvá-la.
        const servicosCarregados: ServicoDoProvedor[] =
          provider === "frenet" &&
          !data.servicos.some((s: ServicoDoProvedor) => s.codigo === "JTE_INT")
            ? [
                ...data.servicos,
                {
                  codigo: "JTE_INT",
                  transportadora: "J&T Express",
                  servico: "Standard",
                  ausenteDaListaDaApi: true,
                },
              ]
            : data.servicos;
        const salvos = new Set(provedoresSalvos.get(provider)?.servicos ?? []);
        atualizarRascunho(provider, {
          carregandoServicos: false,
          erroServicos: false,
          servicosCarregados,
          servicosSelecionados: new Set(
            servicosCarregados
              .map((s) => s.codigo)
              .filter((codigo) => salvos.has(codigo)),
          ),
          servicosMexeu: false,
          // Aviso da hub (22/09): a SuperFrete lista pelo CATÁLOGO
          // documentado (`/api/v0/services/info`), não pelo que a conta tem
          // ativo — ME e Frenet vêm da conta e não trazem este campo.
          servicosDoCatalogo: data.origem === "catalogo_documentado",
        });
      } catch (err) {
        console.error("[TransportadorasCard] Erro ao listar serviços:", err);
        atualizarRascunho(provider, {
          carregandoServicos: false,
          erroServicos: true,
        });
        toast.error(
          mensagemAmigavelErroEdgeFunction(err as Error, {
            mensagemGenerica:
              "Não foi possível carregar os serviços desta transportadora.",
          }),
        );
      }
    },
    [rascunhoDoProvider, provedoresSalvos, atualizarRascunho],
  );

  const alternarServico = useCallback(
    (provider: ProvedorFrete, codigo: string) => {
      setRascunhos((prev) => {
        const atual = prev.get(provider) ?? rascunhoVazio();
        const conjunto = new Set(atual.servicosSelecionados ?? []);
        if (conjunto.has(codigo)) conjunto.delete(codigo);
        else conjunto.add(codigo);
        const proximo = new Map(prev);
        proximo.set(provider, {
          ...atual,
          servicosSelecionados: conjunto,
          servicosMexeu: true,
          resultadoTeste: null,
        });
        return proximo;
      });
      haptic.light();
    },
    [],
  );

  const testarProvedor = useCallback(
    async (provider: ProvedorFrete) => {
      const r = rascunhoDoProvider(provider);
      const digitada = r.tokenDigitado.trim();
      const temChaveSalva = provedoresSalvos.get(provider)?.tem_chave ?? false;
      if (!digitada && !temChaveSalva) {
        toast.error("Informe a chave de acesso para testar.");
        return;
      }
      let emailDoTeste: string | null = null;
      if (PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider)) {
        emailDoTeste = emailDeContatoValido(r.emailDigitado);
        if (!emailDoTeste) {
          toast.error(
            r.emailDigitado.trim()
              ? MENSAGEM_EMAIL_INVALIDO
              : mensagemEmailVazio(provider),
          );
          return;
        }
      }
      atualizarRascunho(provider, { testando: true, resultadoTeste: null });
      haptic.light();

      const servicos =
        r.servicosSelecionados && r.servicosSelecionados.size > 0
          ? Array.from(r.servicosSelecionados)
          : undefined;

      const corpoCredenciais =
        provider === "frenet"
          ? { token: digitada }
          : {
              token: digitada,
              sandbox: sandboxAtual(provider),
              ...(PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) && emailDoTeste
                ? { contact_email: emailDoTeste }
                : {}),
            };

      const corpo = digitada
        ? {
            action: "test_credentials",
            provider,
            credentials: corpoCredenciais,
            ...(servicos ? { servicos } : {}),
          }
        : {
            action: "test_credentials",
            provider,
            usarCredencialSalva: true,
            ...(PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) && emailDoTeste
              ? { credentials: { contact_email: emailDoTeste } }
              : {}),
            ...(servicos ? { servicos } : {}),
          };

      try {
        const { data, error } = await chamarEdgeDeFrete(corpo);
        if (error) throw error;
        if (data?.success) {
          atualizarRascunho(provider, {
            testando: false,
            resultadoTeste: {
              sucesso: true,
              mensagem: "Credenciais válidas e conectadas!",
              servicosTestados: data.servicosTestados,
            },
          });
          toast.success("Integração de frete validada com sucesso!");
        } else {
          atualizarRascunho(provider, {
            testando: false,
            resultadoTeste: {
              sucesso: false,
              mensagem: mensagemDoMotivo(data?.motivo, data?.error),
              servicosTestados: data?.servicosTestados,
            },
          });
          toast.error("Falha ao validar credenciais de frete");
        }
      } catch (err) {
        console.error("[TransportadorasCard] Erro ao testar:", err);
        atualizarRascunho(provider, {
          testando: false,
          resultadoTeste: {
            sucesso: false,
            mensagem: mensagemAmigavelErroEdgeFunction(err as Error, {
              mensagemGenerica:
                "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
            }),
          },
        });
        toast.error("Erro ao testar credenciais");
      }
    },
    [rascunhoDoProvider, provedoresSalvos, sandboxAtual, atualizarRascunho],
  );

  const salvarProvedor = useCallback(
    async (provider: ProvedorFrete) => {
      const r = rascunhoDoProvider(provider);
      const digitada = r.tokenDigitado.trim();
      const temChaveSalva = provedoresSalvos.get(provider)?.tem_chave ?? false;

      if (!digitada && !temChaveSalva) {
        toast.error(
          "Cole a chave de acesso desta transportadora antes de salvar.",
        );
        return;
      }

      let emailValido: string | null = null;
      if (PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(provider)) {
        // SuperFrete (1.5.5, intacto): sem e-mail válido, nem grava.
        emailValido = emailDeContatoValido(r.emailDigitado);
        if (!emailValido) {
          haptic.error();
          toast.error(
            r.emailDigitado.trim()
              ? MENSAGEM_EMAIL_INVALIDO
              : mensagemParaAtivar(provider),
          );
          return;
        }
      } else if (
        PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) &&
        r.emailDigitado.trim() !== ""
      ) {
        // Melhor Envio (R3-7): e-mail é OPCIONAL para SALVAR — campo vazio
        // mantém o que já está salvo no servidor (o `contact_email` nem
        // entra no corpo abaixo). Só valida o FORMATO quando a lojista
        // digitou algo — mesma régua e mesma mensagem da SuperFrete.
        emailValido = emailDeContatoValido(r.emailDigitado);
        if (!emailValido) {
          haptic.error();
          toast.error(MENSAGEM_EMAIL_INVALIDO);
          return;
        }
      }

      if (r.servicosMexeu && (r.servicosSelecionados?.size ?? 0) === 0) {
        toast.error("Selecione ao menos um serviço antes de salvar.");
        return;
      }
      const jtEntrando =
        provider === "frenet" &&
        r.servicosSelecionados?.has("JTE_INT") === true &&
        !provedoresSalvos.get(provider)?.servicos?.includes("JTE_INT");
      if (
        jtEntrando &&
        !r.resultadoTeste?.servicosTestados?.some(
          (s) => s.codigo === "JTE_INT" && s.ok,
        )
      ) {
        toast.error("J&T Express — Standard ainda não cotou com esta chave.", {
          description:
            "Toque em Testar com J&T marcado. Se não cotar, desmarque J&T para salvar os demais serviços ou consulte a Frenet.",
        });
        return;
      }

      atualizarRascunho(provider, { salvando: true });
      haptic.medium();

      const corpo: Record<string, unknown> = {
        action: "save_credentials",
        provider,
      };
      if (digitada) corpo.token = digitada;
      if (provider !== "frenet") corpo.sandbox = sandboxAtual(provider);
      // Vazio para o ME = `emailValido` fica `null` e o campo nem entra no
      // corpo — o servidor mantém o que já tinha. Para a SuperFrete
      // `emailValido` nunca chega aqui nulo (bloqueou acima).
      if (emailValido) corpo.contact_email = emailValido;
      // Ajuste do dono (rodada 4, 23/09/2026): o controle de seguro saiu
      // da interface — a tela NUNCA envia "sem_seguro", sempre
      // "valor_dos_produtos" (mesmo quando a config lida já veio
      // "sem_seguro" por fora do painel: o próximo salvar corrige,
      // porque manda o valor EXPLÍCITO em vez de omitir — omitir faria a
      // edge preservar o "sem_seguro" já gravado por herança).
      if (provider === "melhor_envio") corpo.seguro = "valor_dos_produtos";
      if (r.servicosMexeu && r.servicosSelecionados) {
        corpo.servicos = Array.from(r.servicosSelecionados);
      }

      try {
        const { data, error } = await chamarEdgeDeFrete(corpo);
        if (error) throw error;
        if (!data?.success) {
          haptic.error();
          const mensagemErro =
            typeof data?.error === "string" && data.error
              ? data.error
              : "Não foi possível salvar esta transportadora. Tente de novo.";
          toast.error(mensagemErro);
          // R1-8 (ANOTADO): a recusa também pode vir por serviço (edge
          // testou os marcados antes de gravar) — reaproveita o mesmo
          // bloco do "Testar" para listar QUAL serviço travou.
          atualizarRascunho(provider, {
            salvando: false,
            resultadoTeste: data?.servicosTestados
              ? {
                  sucesso: false,
                  mensagem: mensagemErro,
                  servicosTestados: data.servicosTestados,
                }
              : null,
          });
          return;
        }

        if (data.cache === "pendente") {
          toast.success("Transportadora salva!", {
            description:
              "As cotações antigas em cache podem demorar um pouco a atualizar.",
          });
        } else {
          toast.success("Transportadora salva!");
        }

        // Descarta o cache de frete deste aparelho (R1-2/R2-8) — a rota
        // vive em src/lib/revisao-do-frete.ts, do pacote da cliente
        // (comentário corrigido, revisão Opus rodada 2: o arquivo já
        // existe hoje; o `try/catch` fica como rede de segurança — se um
        // dia a rota sumir ou o import falhar por outro motivo, este
        // catch avisa no console em vez de fingir sucesso).
        try {
          const { descartarCacheDeFreteDoNavegador } = await import(
            "@/lib/revisao-do-frete"
          );
          descartarCacheDeFreteDoNavegador();
        } catch (erroImport) {
          console.error(
            "[TransportadorasCard] Não foi possível descartar o cache do navegador:",
            erroImport,
          );
        }

        // Só o rascunho DESTE provedor volta limpo (ANOTADO, ver
        // `carregar`) — os demais cards mantêm o que a lojista ainda
        // estava digitando.
        await carregar(provider);
        haptic.success();
      } catch (err) {
        console.error("[TransportadorasCard] Erro ao salvar:", err);
        haptic.error();
        toast.error("Erro ao salvar a transportadora.", {
          description: mensagemAmigavelErroEdgeFunction(err as Error, {
            mensagemGenerica:
              "Não foi possível falar com o servidor. Tente de novo em instantes.",
          }),
        });
        atualizarRascunho(provider, { salvando: false });
      }
    },
    [
      rascunhoDoProvider,
      provedoresSalvos,
      sandboxAtual,
      atualizarRascunho,
      carregar,
    ],
  );

  const alternarLigado = useCallback((provider: ProvedorFrete) => {
    setLigadosEscolhidos((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(provider)) proximo.delete(provider);
      else proximo.add(provider);
      return proximo;
    });
    setErroLigados(null);
    haptic.light();
  }, []);

  const salvarLigados = useCallback(async () => {
    setSalvandoLigados(true);
    setErroLigados(null);
    haptic.medium();
    try {
      const { data, error } = await chamarEdgeDeFrete({
        action: "save_active_providers",
        ligados: Array.from(ligadosEscolhidos),
      });
      if (error) throw error;
      if (!data?.success) {
        haptic.error();
        // R1-8 (ANOTADO): `data.servicosTestados` vem quando a recusa foi
        // no teste de um serviço específico do provedor que estava
        // ENTRANDO na lista (acoes.ts, `salvarLigados` → `reprovado`).
        const mensagemErro =
          typeof data?.error === "string" && data.error
            ? data.error
            : "Não foi possível salvar os provedores ligados.";
        const resumo = resumoServicosTestados(data?.servicosTestados);
        setErroLigados({ mensagem: `Nada foi salvo. ${mensagemErro}`, resumo });
        if (resumo) {
          toast.error(mensagemErro, { description: resumo });
        } else {
          toast.error(mensagemErro);
        }
        return;
      }
      setLigadosSalvos(new Set(data.ligados ?? []));
      setLigadosEscolhidos(new Set(data.ligados ?? []));

      try {
        const { descartarCacheDeFreteDoNavegador } = await import(
          "@/lib/revisao-do-frete"
        );
        descartarCacheDeFreteDoNavegador();
      } catch (erroImport) {
        console.error(
          "[TransportadorasCard] Não foi possível descartar o cache do navegador:",
          erroImport,
        );
      }

      const avisos: string[] = [];
      if (data.espelho === "pendente") {
        avisos.push(
          "provedores salvos; o indicador antigo não atualizou — salve de novo para sincronizar.",
        );
      }
      if (data.cache === "pendente") {
        avisos.push("as cotações antigas em cache podem demorar a atualizar.");
      }
      haptic.success();
      toast.success("Provedores atualizados!", {
        description: avisos.length > 0 ? avisos.join(" ") : undefined,
      });
      // Ligar/desligar NUNCA mexe em credencial nenhuma (ANOTADO, ver
      // `carregar`) — nenhum rascunho é tocado aqui.
      await carregar("nenhum");
    } catch (err) {
      console.error(
        "[TransportadorasCard] Erro ao salvar provedores ligados:",
        err,
      );
      haptic.error();
      const descricao = mensagemAmigavelErroEdgeFunction(err as Error, {
        mensagemGenerica:
          "Não foi possível falar com o servidor. Tente de novo em instantes.",
      });
      setErroLigados({
        mensagem: "Erro ao salvar os provedores ligados.",
        resumo: descricao,
      });
      toast.error("Erro ao salvar os provedores ligados.", {
        description: descricao,
      });
    } finally {
      setSalvandoLigados(false);
    }
  }, [ligadosEscolhidos, carregar]);

  const ligadosMudou = useMemo(() => {
    if (ligadosEscolhidos.size !== ligadosSalvos.size) return true;
    for (const p of ligadosEscolhidos) if (!ligadosSalvos.has(p)) return true;
    return false;
  }, [ligadosEscolhidos, ligadosSalvos]);

  if (!carregado && !erroCarga) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (erroCarga) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-px size-3.5 shrink-0 text-red-400" />
          <p className="text-[11px] font-semibold leading-snug text-red-300">
            Não foi possível carregar as chaves de frete.
            <span className="mt-0.5 block font-normal text-red-300/70">
              Nada é gravado por cima do que já está salvo até a leitura
              funcionar.
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => carregar()}
          className="self-start rounded-lg border border-white/5 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-admin-gold/30"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-zinc-200">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        Como sua loja envia
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Configure a chave de cada transportadora e escolha, no bloco abaixo,
        quais estão LIGADAS na sua loja. Salvar uma chave nunca liga a
        transportadora sozinha.
      </p>

      {ORDEM_DOS_PROVEDORES.map((provider) => (
        <CartaoDoProvedor
          key={provider}
          provider={provider}
          salvo={provedoresSalvos.get(provider)}
          ligado={ligadosSalvos.has(provider)}
          rascunho={rascunhoDoProvider(provider)}
          sandboxAtual={sandboxAtual(provider)}
          onTokenMudou={(v) =>
            atualizarRascunho(provider, {
              tokenDigitado: v,
              resultadoTeste: null,
            })
          }
          onSandboxMudou={(v) =>
            atualizarRascunho(provider, { sandboxEscolhido: v })
          }
          onEmailMudou={(v) =>
            atualizarRascunho(provider, { emailDigitado: v })
          }
          onCarregarServicos={() => listarServicos(provider)}
          onAlternarServico={(codigo) => alternarServico(provider, codigo)}
          onTestar={() => testarProvedor(provider)}
          onSalvar={() => salvarProvedor(provider)}
        />
      ))}

      {/* Bloco separado (R2-1): liga/desliga não mexe em nenhuma credencial. */}
      <div className="space-y-3 rounded-2xl border border-white/5 bg-zinc-950/60 p-3.5">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
          <ShieldCheck className="size-3.5 text-admin-gold" />
          <span>Provedores ligados na loja</span>
        </div>
        <p className="text-[11px] leading-snug text-zinc-400">
          Marque quem cota frete de verdade para as suas clientes. Só é possível
          ligar um provedor com chave salva, fora do modo de testes.
        </p>
        <div className="space-y-1.5">
          {ORDEM_DOS_PROVEDORES.map((provider) => {
            const salvo = provedoresSalvos.get(provider);
            const temChave = salvo?.tem_chave ?? false;
            const emSandbox = sandboxAtual(provider);
            const podeLigar = temChave && !emSandbox;
            const marcado = ligadosEscolhidos.has(provider);
            // Revisão Opus (achado 1): a caixa SEMPRE deixa DESMARCAR —
            // um provedor que perdeu a chave ou caiu em sandbox depois de
            // já estar ligado não pode ficar preso ligado só porque a
            // lojista não consegue mais destravar a caixa.
            const desabilitada = !podeLigar && !marcado;
            // Revisão Opus (achado 2, regressão 1.5.5): a chave não basta
            // para a SuperFrete cotar de verdade — sem e-mail de contato
            // válido a edge nunca manda a cotação embora a linha exista
            // (dado pode ter sido salvo direto no banco, ou de antes da
            // 1.5.5). Mesma régua de `PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR`.
            const semEmailQueEssePedeParaSalvar =
              temChave &&
              PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(provider) &&
              !emailDeContatoValido(salvo?.contato_email);
            // Revisão Opus (achado 3): o rótulo era o RASCUNHO
            // (`ligadosEscolhidos`/`marcado`) travestido de estado salvo —
            // marcar a caixa sem clicar em "Salvar provedores" já dizia
            // "ligado", uma mentira. Agora o rótulo compara o SALVO
            // (`ligadosSalvos`, a verdade) com o rascunho, no idioma do
            // 1.5.6 ("Ativo agora" × "Selecionado (falta salvar)").
            const estaSalvo = ligadosSalvos.has(provider);
            const rotulo = !temChave
              ? "sem chave salva"
              : semEmailQueEssePedeParaSalvar
                ? "sem e-mail de contato"
                : emSandbox
                  ? "em modo de testes — não pode ligar"
                  : estaSalvo && marcado
                    ? "ligado"
                    : estaSalvo && !marcado
                      ? "será desligado (falta salvar)"
                      : !estaSalvo && marcado
                        ? "selecionado (falta salvar)"
                        : "chave salva";
            return (
              <label
                key={provider}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  podeLigar
                    ? "border-white/5 bg-zinc-900/40"
                    : "border-white/5 bg-zinc-900/20 opacity-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={desabilitada}
                    onChange={() => alternarLigado(provider)}
                    className="size-4 accent-admin-gold"
                  />
                  <span className="font-bold text-zinc-200">
                    {nomeDoProvedor(provider)}
                  </span>
                </span>
                <span className="text-[10px] text-zinc-500">{rotulo}</span>
              </label>
            );
          })}
        </div>
        <button
          type="button"
          disabled={
            salvandoLigados ||
            (!ligadosMudou &&
              (modo === "multi" || ligadosEscolhidos.size === 0))
          }
          onClick={salvarLigados}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-admin-gold transition-all hover:bg-admin-gold/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          {salvandoLigados ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : (
            <Save className="size-3" />
          )}
          <span>{salvandoLigados ? "Salvando…" : "Salvar provedores"}</span>
        </button>
        {erroLigados && (
          <div
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] font-semibold leading-snug text-red-300"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>
              {erroLigados.mensagem}
              {erroLigados.resumo && (
                <span className="mt-0.5 block font-normal text-red-300/80">
                  {erroLigados.resumo}
                </span>
              )}
            </span>
          </div>
        )}
        {modo === "legado" && (
          <p className="text-[10px] leading-snug text-zinc-500">
            Sua loja ainda está no modo antigo (um provedor só). Salvar aqui
            liga o modo novo, com vários provedores ao mesmo tempo.
          </p>
        )}
      </div>
    </div>
  );
});

function CartaoDoProvedor({
  provider,
  salvo,
  ligado,
  rascunho,
  sandboxAtual,
  logo,
  onTokenMudou,
  onSandboxMudou,
  onEmailMudou,
  onCarregarServicos,
  onAlternarServico,
  onTestar,
  onSalvar,
}: {
  readonly provider: ProvedorFrete;
  readonly salvo: ConfigDoProvedor | undefined;
  /** Este provedor está LIGADO na loja agora (R3-8, revisão do pacote E):
   * a edge recusa `sandbox:true` em provedor ligado, nos dois modos — a
   * chave de sandbox nasce desabilitada aqui para não deixar a lojista
   * tentar algo que o servidor vai recusar de qualquer jeito. */
  readonly ligado: boolean;
  readonly rascunho: RascunhoDoProvedor;
  readonly sandboxAtual: boolean;
  /** Slot do logo do provedor — outra frente vai plugar aqui depois
   * (pedido do dono, 23/09/2026). Sem logo próprio ainda: cai no
   * `data-slot="logo-provedor"` abaixo, fácil de substituir por busca. */
  readonly logo?: ReactNode;
  readonly onTokenMudou: (v: string) => void;
  readonly onSandboxMudou: (v: boolean) => void;
  readonly onEmailMudou: (v: string) => void;
  readonly onCarregarServicos: () => void;
  readonly onAlternarServico: (codigo: string) => void;
  readonly onTestar: () => void;
  readonly onSalvar: () => void;
}) {
  const temChave = salvo?.tem_chave ?? false;
  const emailComAviso =
    PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) &&
    rascunho.emailDigitado.trim() !== "" &&
    !emailDeContatoValido(rascunho.emailDigitado);

  // Aberto/fechado nasce da pendência LIDA do servidor (ver `temPendencia`)
  // e, depois disso, só o clique da lojista muda — `useState` com
  // inicializador preguiçoso roda uma vez só, no primeiro render deste
  // cartão (a seção só monta os cartões depois que a leitura inicial
  // terminou, então `salvo` aqui já é o dado real, nunca placeholder).
  const [aberto, setAberto] = useState(() => temPendencia(provider, salvo));
  const idCorpo = useId();
  const quantidadeServicos =
    rascunho.servicosSelecionados?.size ?? salvo?.servicos?.length ?? 0;
  const resumo = resumoDoCartao(
    provider,
    salvo,
    ligado,
    sandboxAtual,
    quantidadeServicos,
  );

  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-950/60">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idCorpo}
        onClick={() => setAberto((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl p-3.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-admin-gold"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {logo ?? <LogoDoProvedor provider={provider} />}
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              <Lock className="size-3.5 text-admin-gold" />
              <span>Chave de acesso — {nomeDoProvedor(provider)}</span>
            </span>
            <span className="truncate text-[11px] text-zinc-400">
              {resumo.estado}
              {resumo.servicos ? ` · ${resumo.servicos}` : ""}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-zinc-500 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      <div id={idCorpo} hidden={!aberto} className="space-y-3 px-3.5 pb-3.5">
        {PROVEDORES_COM_SANDBOX.has(provider) && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">
              Modo de testes (Sandbox)
            </span>
            <Switch
              checked={sandboxAtual}
              // Revisão Opus (achado 1, R3-8): a trava é só para LIGAR o
              // sandbox — nunca para DESLIGAR. `ligado && sandboxAtual` (a
              // loja está presa em sandbox porque a credencial já entrou
              // assim, ou a regra mudou depois) precisa continuar clicável,
              // senão a lojista fica presa: não dá para desligar o
              // sandbox, e não dá para desligar a transportadora com o
              // sandbox ligado (a edge também recusaria — acoes.ts §R3-8).
              disabled={ligado && !sandboxAtual}
              aria-label={`Modo de testes (Sandbox) — ${nomeDoProvedor(provider)}`}
              onCheckedChange={(checked) => onSandboxMudou(checked)}
              className="scale-75 data-[state=checked]:bg-admin-gold"
            />
          </div>
        )}

        {ligado && !sandboxAtual && PROVEDORES_COM_SANDBOX.has(provider) && (
          <p className="text-[11px] leading-snug text-zinc-500">
            Desligue esta transportadora antes de usar o modo de testes.
          </p>
        )}

        {salvo?.precisa_salvar_de_novo && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold leading-snug text-amber-300">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>
              A configuração deste provedor precisa ser salva de novo — outro
              aparelho pode ter gravado uma versão mais antiga.
            </span>
          </p>
        )}

        {temChave && (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <KeyRound className="size-3.5 shrink-0" />
            <span>
              Chave salva. Por segurança ela não aparece aqui — para trocar,
              cole a nova e salve.
            </span>
          </p>
        )}

        <GuiaDaChaveDoProvedor provider={provider} />

        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={rascunho.tokenDigitado}
            disabled={rascunho.testando || rascunho.salvando}
            onChange={(e) => onTokenMudou(e.target.value)}
            placeholder={
              temChave
                ? "Cole uma chave nova só se quiser trocar a salva..."
                : "Cole aqui a chave de acesso da sua conta..."
            }
            className="h-9 flex-1 rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none"
          />
          <button
            type="button"
            disabled={
              rascunho.testando ||
              rascunho.carregandoServicos ||
              (!rascunho.tokenDigitado.trim() && !temChave)
            }
            onClick={onTestar}
            className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-1.5 text-xs font-bold text-admin-gold hover:bg-admin-gold/20 active:scale-95 disabled:opacity-40"
          >
            {rascunho.testando ? (
              <RefreshCw className="size-3 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3" />
            )}
            <span>Testar</span>
          </button>
        </div>

        {PROVEDORES_COM_EMAIL_EM_CONSULTA.has(provider) && (
          <div className="space-y-1.5">
            <label
              htmlFor={`email-contato-${provider}`}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
            >
              <Mail className="size-3.5 text-admin-gold" />
              <span>E-mail de contato</span>
            </label>
            <p className="text-[11px] leading-snug text-zinc-400">
              {provider === "melhor_envio"
                ? "O Melhor Envio exige um e-mail de contato em cada consulta."
                : "A SuperFrete exige um e-mail para falar com quem cuida desta integração se algo der errado nas cotações."}{" "}
              Use um e-mail seu que você lê. Ele não aparece para as clientes.
            </p>
            <input
              id={`email-contato-${provider}`}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              value={rascunho.emailDigitado}
              aria-invalid={emailComAviso}
              onChange={(e) => onEmailMudou(e.target.value)}
              placeholder="voce@sualoja.com.br"
              className={`h-9 w-full rounded-lg border bg-zinc-950 px-3 text-xs text-white placeholder-zinc-600 focus:outline-none ${
                emailComAviso
                  ? "border-red-500/50 focus:border-red-400"
                  : "border-white/5 focus:border-admin-gold"
              }`}
            />
            {emailComAviso && (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-red-300">
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                <span>{MENSAGEM_EMAIL_INVALIDO}</span>
              </p>
            )}
            {provider === "melhor_envio" && !emailComAviso && (
              <p className="text-[11px] leading-snug text-zinc-500">
                Deixe em branco para manter o e-mail já salvo — ele só é
                obrigatório para LIGAR o Melhor Envio na loja.
              </p>
            )}
            <p className="text-[11px] leading-snug text-zinc-400">
              O teste faz uma cotação de verdade n
              {provider === "melhor_envio" ? "o" : "a"}{" "}
              {nomeDoProvedor(provider)} (nada é comprado) e só passa com uma
              chave válida do ambiente escolhido.
            </p>
          </div>
        )}

        {/* Ajuste do dono (rodada 4, 23/09/2026): "zerar a declaração NÃO
         * foi autorizado" — o controle "Sem seguro" saiu da interface por
         * inteiro. Nenhum caminho da tela seleciona nem envia
         * seguro:"sem_seguro" (ver salvarProvedor, corpo.seguro sempre
         * "valor_dos_produtos"). O único resquício possível de
         * "sem_seguro" é uma gravação feita POR FORA do painel — aqui só
         * avisamos, sem deixar a lojista presa nisso. */}
        {provider === "melhor_envio" && salvo?.seguro === "sem_seguro" && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold leading-snug text-amber-300">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>
              Seguro desligado por fora do painel — ao salvar, volta para Com
              seguro.
            </span>
          </p>
        )}

        {rascunho.resultadoTeste && (
          <div
            className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs ${
              rascunho.resultadoTeste.sucesso
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {rascunho.resultadoTeste.sucesso ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <AlertCircle className="size-4 shrink-0" />
              )}
              <span>{rascunho.resultadoTeste.mensagem}</span>
            </div>
            {rascunho.resultadoTeste.servicosTestados &&
              rascunho.resultadoTeste.servicosTestados.length > 0 && (
                <ul className="ml-6 list-disc space-y-0.5 text-[11px] text-zinc-300">
                  {rascunho.resultadoTeste.servicosTestados.map((s) => {
                    // ANOTADO (revisão Opus): o nome do serviço junto do
                    // código — "PAC" ao lado de "1", não só o código cru.
                    const nomeDoServico = rascunho.servicosCarregados?.find(
                      (sc) => sc.codigo === s.codigo,
                    )?.servico;
                    return (
                      <li key={s.codigo}>
                        {s.codigo}
                        {nomeDoServico ? ` (${nomeDoServico})` : ""}:{" "}
                        {s.ok
                          ? "cotou certo"
                          : s.motivo === "erro_do_servico"
                            ? `não cotou (${s.detalhe ?? "erro do serviço"})`
                            : "não retornou"}
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
        )}

        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Serviços da conta
            </span>
            <button
              type="button"
              onClick={onCarregarServicos}
              disabled={
                rascunho.carregandoServicos ||
                rascunho.testando ||
                (!temChave && !rascunho.tokenDigitado.trim())
              }
              className="flex items-center gap-1 text-[10px] font-bold text-admin-gold hover:underline disabled:opacity-40"
            >
              <RefreshCw
                className={`size-3 ${rascunho.carregandoServicos ? "animate-spin" : ""}`}
              />
              <span>
                {rascunho.servicosCarregados
                  ? "Atualizar lista"
                  : "Ver serviços da conta"}
              </span>
            </button>
          </div>

          {/* PR #637: sem isto, depois de recarregar a lista ficava vazia e a
           * seleção salva parecia perdida — ela só aparecia depois de "Ver
           * serviços da conta". `null` = nunca escolheu (filtro antigo). */}
          {!rascunho.servicosCarregados &&
            salvo?.servicos &&
            salvo.servicos.length > 0 && (
              <div className="rounded-lg border border-white/5 bg-zinc-900/40 px-2.5 py-1.5 text-[11px] text-zinc-300">
                <span className="block text-zinc-500">Salvos nesta loja:</span>
                <ul className="ml-4 list-disc">
                  {salvo.servicos.map((codigo) => (
                    <li key={codigo}>{nomeDoServicoSalvo(provider, codigo)}</li>
                  ))}
                </ul>
              </div>
            )}

          {rascunho.erroServicos && (
            <p className="text-[11px] text-red-300">
              Não foi possível carregar os serviços agora. As caixas continuam
              com a última seleção salva — nada foi apagado.
            </p>
          )}

          {rascunho.servicosDoCatalogo && (
            <p className="text-[11px] leading-snug text-zinc-500">
              Lista de serviços da SuperFrete. O teste confirma quais cotam na
              sua conta.
            </p>
          )}

          {rascunho.servicosCarregados &&
            rascunho.servicosCarregados.length === 0 && (
              <p className="text-[11px] italic text-zinc-500">
                Nenhum serviço encontrado nesta conta.
              </p>
            )}

          {rascunho.servicosCarregados &&
            rascunho.servicosCarregados.length > 0 && (
              <div className="space-y-1">
                {rascunho.servicosCarregados.map((servico) => {
                  const marcado =
                    rascunho.servicosSelecionados?.has(servico.codigo) ?? false;
                  const exigeAgencia =
                    provider === "melhor_envio" &&
                    IDS_ME_QUE_EXIGEM_AGENCIA.has(servico.codigo);
                  return (
                    <label
                      key={servico.codigo}
                      className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-zinc-900/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={rascunho.testando || rascunho.salvando}
                          onChange={() => onAlternarServico(servico.codigo)}
                          className="size-4 accent-admin-gold"
                        />
                        <RotuloDoServico
                          transportadora={servico.transportadora}
                          servico={servico.servico}
                        />
                      </span>
                      {servico.ausenteDaListaDaApi && (
                        <span className="ml-6 text-[10.5px] font-semibold text-amber-300">
                          A Frenet não listou este serviço para esta chave.
                          Aparecer no app de etiquetas não garante a cotação no
                          checkout: marque J&T, toque em Testar e só salve se
                          aparecer como cotou certo.
                        </span>
                      )}
                      {exigeAgencia && (
                        <span className="ml-6 flex items-start gap-1 text-[10.5px] font-semibold text-amber-300">
                          <AlertCircle className="mt-px size-3 shrink-0" />
                          {AVISO_ID_EXIGE_AGENCIA}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
        </div>

        <div className="flex justify-end border-t border-white/5 pt-3">
          <button
            type="button"
            disabled={rascunho.salvando || rascunho.testando}
            onClick={onSalvar}
            className="flex shrink-0 select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-admin-gold/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {rascunho.salvando ? (
              <RefreshCw className="size-3 animate-spin text-admin-gold" />
            ) : (
              <Save className="size-3 text-admin-gold" />
            )}
            <span>{rascunho.salvando ? "Salvando..." : "Salvar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Slug do logo oficial de cada provedor (public/logos/provedores/, fontes em
// public/logos/FONTES.md). O nome segue no texto do cabeçalho: o logo é
// decorativo (alt vazio) — o leitor de tela não lê o nome duas vezes.
const SLUG_DO_LOGO_DO_PROVEDOR: ReadonlyMap<ProvedorFrete, string> = new Map([
  ["melhor_envio", "melhor-envio"],
  ["superfrete", "superfrete"],
  ["frenet", "frenet"],
]);

function LogoDoProvedor({ provider }: { readonly provider: ProvedorFrete }) {
  const slug = SLUG_DO_LOGO_DO_PROVEDOR.get(provider);
  const caminho = slug ? logoDoAgregador(slug) : undefined;
  const [falhou, setFalhou] = useState(false);
  if (!caminho || falhou) {
    // Sem logo (ou falhou ao carregar): as iniciais, decorativas.
    return (
      <span
        data-slot="logo-provedor"
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[9px] font-black uppercase text-zinc-500"
      >
        {nomeDoProvedor(provider).slice(0, 2)}
      </span>
    );
  }
  return (
    <span
      data-slot="logo-provedor"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white p-1"
    >
      <img
        src={caminho}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        className="size-full object-contain"
        onError={() => setFalhou(true)}
      />
    </span>
  );
}

// Serviço na lista do provedor com o NOME NORMALIZADO (pedido do dono,
// 23/09/2026: "JeT — Standard", "Jadlog — Jadlog Package", ".Package") e o
// logo oficial da transportadora. Só exibição: o `codigo` salvo é o mesmo.
function RotuloDoServico({
  transportadora,
  servico,
}: {
  readonly transportadora: string;
  readonly servico: string;
}) {
  const marca = marcaDoFrete({ transportadora, servico });
  const nome = marca.transportadora?.nome ?? transportadora;
  const servicoLimpo = marca.servico ?? servico;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <LogoDaTransportadora
        slug={marca.transportadora?.slug ?? null}
        nome={nome}
        tamanho={22}
        className="w-10"
      />
      <span className="min-w-0 text-zinc-200">
        {servicoLimpo ? `${nome} — ${servicoLimpo}` : nome}
      </span>
    </span>
  );
}
