import { Switch } from "@/components/ui/switch";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PASSOS_DO_GUIA,
  PROMPT_PARA_AGENTE_MP,
  RECADO_DE_SEGURANCA,
} from "./mercado-pago-conteudo";

/**
 * Card "Mercado Pago" da tela de Ajustes — peça 20 (14/09/2026, pedido do
 * dono por voz): o LOJISTA cadastra as chaves do Mercado Pago dele, guiado
 * pelo passo a passo com prompt pronto para o agente de IA do app do MP, e
 * testa a conexão ali mesmo.
 *
 * SEGURANÇA (desenho desta peça, mais forte que o precedente das
 * transportadoras, que expõe o token):
 * - O Access Token NUNCA volta para a tela: o servidor só devolve MÁSCARA
 *   ("••••1234"). O campo de token nasce vazio; vazio ao salvar = mantém a
 *   chave já salva.
 * - O teste de conexão roda NO SERVIDOR (edge credenciais-mercado-pago) —
 *   a chave real nunca chega ao navegador, nem no teste.
 *
 * O PIX DO CLIENTE PASSA POR AQUI (tarefa mp-4, 16/09/2026 — deixou de ser
 * "frente futura"): abaixo do teste de conexão mora o interruptor "Receber
 * PIX no app", que acende e apaga `store_config.pagamento_online` pelas
 * ações `ligar_pix`/`desligar_pix` da mesma edge. Regras de HONESTIDADE
 * desta tela, porque aqui se abre (ou se fecha) a porta do dinheiro:
 * - Ligar só depois de um teste BEM-SUCEDIDO — vitrine com PIX que o
 *   Mercado Pago recusa é cliente travado no fim da compra. Enquanto não
 *   houver teste conectado, o interruptor fica desabilitado COM a
 *   explicação à vista (bloqueio mudo é a tela mentindo por omissão).
 * - Desligar é o lado seguro e nunca fica bloqueado.
 * - O estado do interruptor é o que o SERVIDOR devolveu (`pix_ligado` da
 *   ficha da loja), nunca um palpite otimista do clique.
 * - Chave de sandbox conecta igual à de produção: o aviso amarelo de
 *   ambiente "teste" vem PRONTO da edge e é mostrado como veio.
 * - (mp-9) Salvar credencial NOVA zera o teste guardado no servidor — e a
 *   edge desliga o PIX nesse mesmo salvar (`pix_desligado`). Enquanto o
 *   estado gravado for "ligado sem teste", a tela DIZ isso em âmbar com o
 *   "Testar conexão" ao alcance: a loja estaria cobrando por uma chave que
 *   ninguém provou, e calar seria a tela mentindo por omissão de novo.
 * - (mp-9) O resultado do interruptor sobe pelo `onPixAlternado` para quem
 *   hospeda a seção (a tela de Ajustes), porque o painel "Minha loja está
 *   no ar?" lê o retrato do BOOT da ficha e ficaria contando o estado
 *   antigo até um recarregamento completo.
 *
 * Fluxo do dono, ditado por voz: a lojista cola as chaves, ELA SALVA e ELA
 * TESTA. Por isso "Testar conexão" fica bloqueado enquanto houver coisa
 * não salva — testar outra coisa diferente do que está na tela enganaria.
 */

/** O que a edge devolve no "ler"/"salvar" — segredo JAMAIS está aqui. */
type ConfiguracaoMp = {
  configurado: boolean;
  public_key: string | null;
  mascara_token: string | null;
  mascara_webhook: string | null;
  ultimo_teste: {
    quando: string;
    conectado: boolean;
    mensagem: string;
    ambiente: "producao" | "teste" | null;
    conta: string | null;
  } | null;
  atualizado_em: string | null;
  /** `store_config.pagamento_online` — o PIX está aceso para o cliente? */
  pix_ligado: boolean;
  /** A ficha da loja já carrega ESTA Public Key (e não outra, nem nenhuma). */
  public_key_na_loja: boolean;
};

const VAZIA: ConfiguracaoMp = {
  configurado: false,
  public_key: null,
  mascara_token: null,
  mascara_webhook: null,
  ultimo_teste: null,
  atualizado_em: null,
  pix_ligado: false,
  public_key_na_loja: false,
};

/**
 * A resposta da edge vira estado com os dois campos da FICHA coercidos a
 * booleano: instalação com a edge antiga (que ainda não devolve `pix_ligado`
 * / `public_key_na_loja`) tem que virar "desligado" e "chave não publicada".
 * `undefined` no interruptor o tornaria não controlado — e a tela passaria a
 * inventar sozinha o estado do dinheiro, que é justamente o que esta peça
 * veio proibir.
 */
function comoConfig(data: unknown): ConfiguracaoMp {
  const lida = (data ?? {}) as ConfiguracaoMp;
  return {
    ...lida,
    pix_ligado: lida.pix_ligado === true,
    public_key_na_loja: lida.public_key_na_loja === true,
  };
}

/**
 * Recado amigável do erro de invoke: o corpo `{ erro }` vem da NOSSA edge
 * (frases escritas aqui do lado de cá do negócio, sem jargão e sem segredo)
 * e por isso pode ir direto para a tela. Todo o resto passa pelo tradutor
 * da casa, que só conhece causas fixas do SDK.
 *
 * A frase de serviço inativo existe porque a seção MENTIU uma vez: com a
 * edge ainda não publicada no projeto, o dono viu "Verifique sua internet"
 * com a internet perfeita (14/09/2026, 404 da função nova medido no
 * gateway). Serviço ausente e rede caída são conselhos diferentes.
 */
const SERVICO_DE_CHAVES_INATIVO =
  "O serviço de chaves do Mercado Pago ainda não está ativado nesta instalação. Fale com o suporte para ativá-lo no servidor.";

async function erroAmigavel(error: unknown, generico: string): Promise<string> {
  try {
    const detalhes = error as { name?: unknown; context?: unknown };
    if (
      detalhes?.name === "FunctionsHttpError" &&
      detalhes.context instanceof Response
    ) {
      const corpo = (await detalhes.context
        .clone()
        .json()
        .catch(() => null)) as { erro?: unknown } | null;
      if (corpo && typeof corpo.erro === "string" && corpo.erro) {
        return corpo.erro;
      }
    }
  } catch {
    // cai no tradutor da casa
  }
  return mensagemAmigavelErroEdgeFunction(error, {
    mensagemGenerica: generico,
    mensagemServicoInativo: SERVICO_DE_CHAVES_INATIVO,
  });
}

/**
 * Expansor de SEGUNDA camada (pedido do dono, 14/09 à noite vendo a tela:
 * o grupo "Mercado Pago" aberto despejava guia + formulário de uma vez e
 * poluía a tela). Nasce FECHADO, como o grupo que o abriga (decisão do dono
 * de 02/09); abrir/fechar é um clique no cabeçalho. O conteúdo DESMONTA
 * quando fecha — mesma semântica do SecaoColapsavel da view — mas o estado
 * do formulário mora no componente pai: fechar e reabrir não perde o que
 * foi digitado (e a trava "Salve antes de fechar" do grupo segue de pé
 * enquanto houver pendência).
 */
function Expansor({
  titulo,
  subtitulo,
  icone: Icone,
  aberto,
  onAlternar,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly icone: React.ElementType;
  readonly aberto: boolean;
  readonly onAlternar: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/60">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="group flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-admin-gold/10 text-admin-gold ring-1 ring-admin-gold/20">
            <Icone className="size-3.5" strokeWidth={2.25} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-black uppercase tracking-[0.2em] text-white">
              {titulo}
            </span>
            <span className="block truncate text-[10px] normal-case tracking-normal text-zinc-500">
              {subtitulo}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300",
            aberto && "rotate-180",
          )}
        />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-white/5 p-3.5 duration-200 animate-in fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

export const MercadoPagoSection = memo(function MercadoPagoSection({
  onDirtyMudou,
  onPixAlternado,
}: {
  /** Mesma trava das demais seções: avisa o pai para BLOQUEAR o fecho da
   * seção colapsável enquanto houver chave digitada e não salva. */
  readonly onDirtyMudou?: (dirty: boolean) => void;
  /** Eco do estado do PIX que o SERVIDOR devolveu (mp-9), para a tela que
   * hospeda esta seção não seguir mostrando o retrato do boot. Dispara em
   * liga/desliga, no salvar que a edge usou para desligar o PIX, e no `ler`
   * do mount (mp-10).
   *
   * O segundo argumento (`chaveNaLoja`) só vem preenchido no eco do `ler`:
   * é a ÚNICA das quatro chamadas em que "ligado" não garante Public Key
   * publicada — `ligar_pix`/`salvar` só devolvem `pix_ligado: true` quando a
   * edge PUBLICOU a chave junto (mp-8), mas `ler` devolve o retrato cru da
   * ficha (`pagamento_online`), que pode estar `true` com a Public Key
   * ausente (o mesmo estado do teste X6 deste arquivo). Sem este segundo
   * argumento, quem hospeda a seção teria de adivinhar "ligado = chave OK",
   * o que é falso justamente para o `ler` — e o painel de Ajustes acenderia
   * "Funcionando" com o PIX quebrado (achado da revisão de mp-10). */
  readonly onPixAlternado?: (ligado: boolean, chaveNaLoja?: boolean) => void;
}) {
  const isOffline = useOnlineStatus();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfiguracaoMp>(VAZIA);

  // Formulário: segredos nascem VAZIOS de propósito (mostrar o salvo
  // seria exibi-lo); a Public Key não é segredo e volta preenchida.
  const [publicKey, setPublicKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Interruptor do PIX (mp-4): `alternandoPix` segura o clique duplo;
  // `avisoPix` é o recado AMARELO que a edge devolve (chave de sandbox) e
  // `ecoDaVitrine` só aparece depois de um liga/desliga que deu certo — é a
  // frase que explica por que a loja ainda mostra o estado antigo.
  const [alternandoPix, setAlternandoPix] = useState(false);
  const [avisoPix, setAvisoPix] = useState<string | null>(null);
  const [ecoDaVitrine, setEcoDaVitrine] = useState(false);

  // Segunda camada (pedido do dono, 14/09 à noite): guia e chaves em
  // expandidores próprios, ambos FECHADOS por padrão — o grupo abre
  // mostrando só o resumo do status.
  const [guiaAberto, setGuiaAberto] = useState(false);
  const [chavesAberto, setChavesAberto] = useState(false);

  const copiadoTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiadoTimer.current !== null) {
        window.clearTimeout(copiadoTimer.current);
      }
    },
    [],
  );

  // Ref para o callback mais recente (mesmo padrão de useRealtimeUpdate /
  // useDataVault): `ler` só PRECISA rodar uma vez no mount — colocar
  // `onPixAlternado` nas deps do useCallback abaixo faria a identidade de
  // `ler` mudar a cada render do pai (o prop chega como arrow function
  // inline em AdminSettingsView), e o `useEffect(() => ler(), [ler])`
  // re-executaria a leitura inteira a cada render alheio. O ref sempre
  // aponta para o callback mais atual sem participar da identidade de `ler`.
  const onPixAlternadoRef = useRef(onPixAlternado);
  useEffect(() => {
    onPixAlternadoRef.current = onPixAlternado;
  }, [onPixAlternado]);

  const ler = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "ler" } },
      );
      if (error) throw error;
      const lida = comoConfig(data);
      setConfig(lida);
      setPublicKey(lida.public_key ?? "");
      // Eco do `ler` (mp-10): sem isto, o painel que hospeda esta seção
      // (AdminSettingsView) ficava preso no retrato do BOOT até o lojista
      // ligar/desligar ou salvar por aqui — a mesma tela contando dois
      // estados do dinheiro quando o boot já estava desatualizado (ex.:
      // alguém mudou a ficha por fora entre o boot e abrir esta seção).
      //
      // O SEGUNDO argumento (`lida.public_key_na_loja`) vai JUNTO: `ler`
      // não garante chave publicada como `ligar_pix`/`salvar` garantem — sem
      // ele, quem recebe o eco teria de inferir "ligado = chave OK", que é
      // falso bem aqui (achado BLOQUEIA da revisão de mp-10; ver o
      // comentário do prop `onPixAlternado`, acima).
      onPixAlternadoRef.current?.(lida.pix_ligado, lida.public_key_na_loja);
    } catch (err) {
      setErroCarga(
        await erroAmigavel(
          err,
          "Não consegui ler as chaves salvas agora. Tente de novo em instantes.",
        ),
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  // Sujo = algo na tela que ainda não é verdade no servidor. Public Key
  // diferente da salva OU qualquer segredo digitado.
  const dirty =
    publicKey !== (config.public_key ?? "") ||
    accessToken.length > 0 ||
    webhookSecret.length > 0;

  useEffect(() => {
    onDirtyMudou?.(dirty);
  }, [dirty, onDirtyMudou]);

  const salvar = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    if (salvando) return;
    if (!publicKey.trim()) {
      toast.error("Cole a Public Key do Mercado Pago.");
      return;
    }
    if (!config.configurado && !accessToken.trim()) {
      toast.error(
        "Cole também o Access Token — é a chave que processa os pagamentos.",
      );
      return;
    }

    setSalvando(true);
    haptic.medium();
    try {
      // Segredo vazio NÃO vai na carga: servidor interpreta ausência como
      // "mantém a salva" — o campo vazio nunca apaga chave de verdade.
      const corpo: Record<string, unknown> = {
        acao: "salvar",
        public_key: publicKey.trim(),
      };
      if (accessToken.trim()) corpo.access_token = accessToken.trim();
      if (webhookSecret.trim()) corpo.webhook_secret = webhookSecret.trim();

      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: corpo },
      );
      if (error) throw error;

      const salva = comoConfig(data);
      setConfig(salva);
      setPublicKey(salva.public_key ?? "");
      setAccessToken("");
      setWebhookSecret("");

      // Credencial nova derruba o PIX no servidor (mp-8). Quem descobre
      // isso pelo cliente sem receber descobre tarde: a mensagem vem
      // PRONTA da edge e sobe também para o painel da tela de Ajustes.
      const desligouNoSalvar = (data ?? {}) as {
        pix_desligado?: boolean;
        aviso?: string;
      };
      if (desligouNoSalvar.pix_desligado === true) {
        setAvisoPix(desligouNoSalvar.aviso ?? null);
        setEcoDaVitrine(false);
        onPixAlternado?.(salva.pix_ligado);
      }
      haptic.success();
      toast.success("Chaves do Mercado Pago salvas!", {
        description: 'Agora toque em "Testar conexão" para conferir.',
      });
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          "Não consegui salvar as chaves agora. Tente de novo.",
        ),
      );
    } finally {
      setSalvando(false);
    }
  };

  const testarConexao = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    if (testando || dirty || !config.configurado) return;

    setTestando(true);
    haptic.light();
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "testar" } },
      );
      if (error) throw error;
      const resultado = (data ?? {}) as {
        conectado: boolean;
        mensagem: string;
        ambiente?: "producao" | "teste" | null;
        conta?: string | null;
      };
      setConfig((antes) => ({
        ...antes,
        ultimo_teste: {
          quando: new Date().toISOString(),
          conectado: resultado.conectado,
          mensagem: resultado.mensagem,
          // Ambiente e conta VÊM da resposta do teste (a edge devolve os
          // dois): zerá-los aqui apagava da tela o que o servidor acabou de
          // apurar — e é o ambiente que explica o aviso de chave de sandbox.
          ambiente: resultado.ambiente ?? null,
          conta: resultado.conta ?? null,
        },
      }));
      if (resultado.conectado) haptic.success();
      else haptic.error();
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          "Não consegui testar a conexão agora. Tente de novo.",
        ),
      );
    } finally {
      setTestando(false);
    }
  };

  /**
   * Liga/desliga o PIX do cliente na ficha da loja. O estado do interruptor
   * é sempre o que o SERVIDOR devolveu — nada de acender a tela no clique e
   * descobrir depois que a ficha recusou.
   */
  const alternarPix = async (ligar: boolean) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para mudar o PIX da loja.",
      });
      return;
    }
    if (alternandoPix || carregando) return;

    setAlternandoPix(true);
    setAvisoPix(null);
    setEcoDaVitrine(false);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: ligar ? "ligar_pix" : "desligar_pix" } },
      );
      if (error) throw error;
      const resposta = (data ?? {}) as {
        pix_ligado?: boolean;
        aviso?: string;
      };
      const ligadoNaFicha = resposta.pix_ligado === true;
      setConfig((antes) => ({ ...antes, pix_ligado: ligadoNaFicha }));
      setAvisoPix(resposta.aviso ?? null);
      setEcoDaVitrine(true);
      onPixAlternado?.(ligadoNaFicha);
      haptic.success();
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          ligar
            ? "Não consegui ligar o PIX agora. Tente de novo."
            : "Não consegui desligar o PIX agora. Tente de novo.",
        ),
      );
    } finally {
      setAlternandoPix(false);
    }
  };

  const copiarPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_PARA_AGENTE_MP);
      setCopiado(true);
      haptic.light();
      if (copiadoTimer.current !== null)
        window.clearTimeout(copiadoTimer.current);
      copiadoTimer.current = window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(
        "Não consegui copiar agora. Toque no texto e copie manualmente.",
      );
    }
  };

  const teste = config.ultimo_teste;

  // LIGAR exige teste conectado (a edge recusa com 409 de qualquer jeito —
  // a tela só não deixa o lojista descobrir isso por um erro). DESLIGAR
  // nunca é bloqueado: é o lado seguro, e trancar a saída seria pior.
  const faltaTestarParaLigar = !config.pix_ligado && !teste?.conectado;

  // LIGADO SEM TESTE (mp-9): a edge zera `ultimo_teste` quando o lojista
  // salva uma credencial nova, então "sem teste guardado" é justamente o
  // caso em que a chave que está cobrando nunca passou pelo Mercado Pago.
  // Não dá para saber de QUAL credencial é um teste antigo — o servidor
  // apaga o registro no lugar de carimbar a chave —, então a ausência é o
  // único sinal que existe, e ele basta para avisar.
  // Um teste que FALHOU (`conectado: false`) é notícia pior, não melhor: o
  // aviso continua até um teste CONECTADO (ressalva da revisão de mp-9).
  const ligadoSemTeste = config.pix_ligado && !teste?.conectado;

  // Mesma trava do fluxo do dono nos DOIS botões de testar (o do formulário
  // e o do aviso âmbar): testar coisa diferente do que está salvo enganaria.
  const testeBloqueado =
    testando || carregando || isOffline || dirty || !config.configurado;

  return (
    <div className="space-y-4">
      {/* ── Resumo curto: status da conexão + máscaras à vista, sem abrir
          nada (pedido do dono, 14/09: o grupo abre ENXUTO) ─────────────── */}
      {carregando ? (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="size-3.5 animate-spin" /> Lendo as chaves salvas…
        </p>
      ) : erroCarga ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" /> {erroCarga}
          </span>
          <button
            type="button"
            onClick={ler}
            className="shrink-0 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-2.5 py-1 font-bold text-admin-gold hover:bg-admin-gold/20"
          >
            Tentar de novo
          </button>
        </div>
      ) : teste ? (
        <div
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
            teste.conectado
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {teste.conectado ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          <span>{teste.mensagem}</span>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          {config.configurado ? (
            <>
              <ShieldCheck className="size-4 shrink-0 text-admin-gold" /> Chaves
              salvas. Falta testar a conexão.
            </>
          ) : (
            "Nenhuma chave do Mercado Pago salva ainda."
          )}
        </p>
      )}

      {/* As máscaras (só o finalzinho da chave) fazem parte do resumo:
          o lojista reconhece o que tem salvo sem abrir camada nenhuma. */}
      {config.configurado &&
        (config.mascara_token || config.mascara_webhook) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
            {config.mascara_token && (
              <span>Access Token {config.mascara_token}</span>
            )}
            {config.mascara_webhook && (
              <span>Notificações {config.mascara_webhook}</span>
            )}
          </p>
        )}

      {/* ── Camada 2a: o guia, escondido até pedido (expande o passo a
          passo e o botão de copiar o prompt) ──────────────────────────── */}
      <Expansor
        titulo="Como pegar suas chaves"
        subtitulo="O passo a passo com o prompt pronto para o agente do app"
        icone={KeyRound}
        aberto={guiaAberto}
        onAlternar={() => setGuiaAberto((antes) => !antes)}
      >
        <ol className="space-y-3">
          {PASSOS_DO_GUIA.map((passo, indice) => (
            <li key={passo.titulo} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 text-[11px] font-black text-admin-gold ring-1 ring-admin-gold/30">
                {indice + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-white">
                  {passo.titulo}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                  {passo.descricao}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* O prompt pronto: o texto vive no arquivo de conteúdo; aqui só a
            caixa e o botão de copiar, com o feedback "Copiado!". */}
        <div className="space-y-2">
          <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Pedido pronto para colar no agente
          </span>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {PROMPT_PARA_AGENTE_MP}
          </pre>
          <button
            type="button"
            onClick={copiarPrompt}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
              copiado
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-admin-gold/30 bg-admin-gold/10 text-admin-gold hover:bg-admin-gold/20"
            }`}
          >
            {copiado ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span>{copiado ? "Copiado!" : "Copiar prompt"}</span>
          </button>
        </div>
      </Expansor>

      {/* ── Camada 2b: as chaves em si — campos, salvar e testar ──────── */}
      <Expansor
        titulo="Suas chaves"
        subtitulo="Cole as chaves, salve e teste a conexão"
        icone={Lock}
        aberto={chavesAberto}
        onAlternar={() => setChavesAberto((antes) => !antes)}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="mp-public-key"
              className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
            >
              Public Key
            </label>
            <input
              id="mp-public-key"
              type="text"
              disabled={carregando}
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="APP_USR-…"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="mp-access-token"
              className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
            >
              <span>Access Token</span>
              {config.mascara_token && (
                <span className="font-mono normal-case tracking-normal text-zinc-400">
                  salva: {config.mascara_token}
                </span>
              )}
            </label>
            <input
              id="mp-access-token"
              type="password"
              disabled={carregando}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={
                config.mascara_token
                  ? "Deixe vazio para manter a chave salva"
                  : "Cole aqui o Access Token de produção…"
              }
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="mp-webhook-secret"
              className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
            >
              <span>Chave de notificações (opcional)</span>
              {config.mascara_webhook && (
                <span className="font-mono normal-case tracking-normal text-zinc-400">
                  salva: {config.mascara_webhook}
                </span>
              )}
            </label>
            <input
              id="mp-webhook-secret"
              type="password"
              disabled={carregando}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={
                config.mascara_webhook
                  ? "Deixe vazio para manter a salva"
                  : "Opcional: a chave de validação de notificações do MP"
              }
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={salvando || carregando || isOffline}
              onClick={salvar}
              className="flex items-center gap-1.5 rounded-lg bg-admin-gold px-4 py-2 text-xs font-black text-zinc-950 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              {salvando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              <span>Salvar chaves</span>
            </button>

            <button
              type="button"
              disabled={testeBloqueado}
              onClick={testarConexao}
              title={
                dirty
                  ? "Salve as chaves primeiro — o teste fala com o Mercado Pago usando o que está salvo."
                  : undefined
              }
              className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-2 text-xs font-bold text-admin-gold hover:bg-admin-gold/20 active:scale-95 disabled:opacity-40"
            >
              {testando ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              <span>Testar conexão</span>
            </button>

            {dirty && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                Salve para testar
              </span>
            )}
          </div>

          {/* ── PIX no app: o interruptor que o CLIENTE sente (mp-4) ────
              Fica logo abaixo do teste porque é o passo seguinte dele:
              testou, deu certo, agora abre a porta do pagamento. ──────── */}
          <div className="space-y-2 rounded-xl border border-white/5 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-xs font-bold text-white">
                  Receber PIX no app
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                  Ligado, o cliente escolhe PIX no fim da compra e paga dentro
                  do seu app, com as suas chaves.
                </span>
              </span>
              <Switch
                checked={config.pix_ligado}
                disabled={
                  carregando ||
                  isOffline ||
                  alternandoPix ||
                  faltaTestarParaLigar
                }
                aria-label="Receber PIX no app"
                onCheckedChange={alternarPix}
                className="shrink-0 scale-90 data-[state=checked]:bg-admin-gold"
              />
            </div>

            {/* Bloqueio MUDO é a tela mentindo por omissão: enquanto faltar
                teste conectado, o motivo fica à vista ao lado do botão. */}
            {faltaTestarParaLigar && !carregando && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-400">
                <AlertCircle className="mt-0.5 size-3 shrink-0 text-amber-400" />
                <span>
                  Faça o teste de conexão dar certo antes de ligar — o app não
                  abre o PIX com uma chave que o Mercado Pago não aceitou.
                </span>
              </p>
            )}

            {/* LIGADO SEM TESTE: a loja está cobrando por uma credencial
                que nunca falou com o Mercado Pago (o servidor zera o teste
                ao salvar chave nova). O conserto — testar — fica no próprio
                aviso: mandar o lojista procurar o botão lá em cima era
                contar o problema e esconder a saída. */}
            {ligadoSemTeste && !carregando && (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    O PIX está ligado, mas a chave salva ainda não passou pelo
                    teste de conexão. Teste agora ou desligue até testar.
                  </span>
                </p>
                <button
                  type="button"
                  disabled={testeBloqueado}
                  onClick={testarConexao}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25 active:scale-95 disabled:opacity-40"
                >
                  {testando ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  <span>Testar conexão</span>
                </button>
              </div>
            )}

            {/* O aviso de chave de sandbox vem PRONTO da edge (ela é quem
                sabe o `live_mode` da conta) e aparece como veio. */}
            {avisoPix && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{avisoPix}</span>
              </p>
            )}

            {/* Por que "até 1 minuto": a vitrine lê a ficha da loja pelo
                porteiro, que guarda a ficha fresca por CACHE_FRESCO_MS =
                60_000 (src/hospedagem/porteiro.ts). Prometer "na hora" faria
                o lojista abrir a loja, não ver mudança e achar que falhou. */}
            {ecoDaVitrine && (
              <p className="text-[11px] leading-relaxed text-zinc-400">
                Pronto. A vitrine passa a refletir em até 1 minuto.
              </p>
            )}

            {/* Ligado sem a Public Key publicada na ficha é exatamente o caso
                em que o cliente NÃO vê PIX — a tela conta em vez de deixar o
                lojista descobrir na venda perdida. */}
            {config.pix_ligado && !config.public_key_na_loja && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  A ficha da loja ainda não carrega esta Public Key — salve as
                  chaves de novo para o cliente conseguir pagar.
                </span>
              </p>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
            <Lock className="mt-0.5 size-3 shrink-0" /> {RECADO_DE_SEGURANCA}
          </p>
        </div>
      </Expansor>
    </div>
  );
});
