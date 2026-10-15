import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  PASSOS_PARA_INSTALAR_NO_IOS,
  adiamentoEstaValendo,
  adiarOsAvisos,
  ehAparelhoDaApple,
  estaComoAppInstalado,
  lerAdiamentoDosAvisos,
  passosParaLiberarOsAvisos,
  situacaoDosAvisos,
} from "@/lib/avisos-do-aparelho";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { supabase } from "@/lib/supabase";
import { BellOff, BellRing } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type EstadoDoTeste = "ocioso" | "enviando" | "enviado" | "falhou" | "sem-rede";

const BOTAO_BASE =
  "flex min-h-11 items-center justify-center rounded-xl px-4 text-xs font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-60";
const BOTAO_PRIMARIO = `${BOTAO_BASE} bg-admin-gold text-black hover:bg-admin-gold/90`;
const BOTAO_SECUNDARIO = `${BOTAO_BASE} border border-white/20 text-zinc-100 hover:bg-white/10`;

function ListaDePassos({ passos }: Readonly<{ passos: readonly string[] }>) {
  return (
    <ol className="mt-3 list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-zinc-200">
      {passos.map((passo) => (
        <li key={passo}>{passo}</li>
      ))}
    </ol>
  );
}

/**
 * Cartão do Início que avisa quando ESTE aparelho não recebe aviso de pedido
 * novo — sem isso a loja só vê o pedido quando abre o painel — e deixa ligar
 * com um toque. Só existe para o lojista (admin) logado, e some sozinho
 * quando o aparelho está inscrito. Reaparece se a inscrição se perder (a
 * sonda do `usePushNotifications` lê o navegador a cada montagem, e o Sair
 * descadastra o aparelho da conta).
 *
 * O que ele NÃO faz: não pede permissão ao abrir (o navegador só deixa pedir
 * num toque da pessoa), e nunca promete entrega — o teste diz "enviado" só
 * quando o servidor de avisos confirmou que aceitou, e mesmo assim manda
 * conferir no aparelho.
 */
export function CartaoDeAvisosDoAparelho({
  aoFechar,
}: Readonly<{
  /** Chamado quando o cartão se fecha ("Agora não", "Pronto"): a tela leva o
   * foco para um lugar vivo, em vez de o teclado/leitor de tela o perder. */
  aoFechar?: () => void;
}>) {
  // A sonda do hook lê a permissão UMA vez, ao montar. Quem sai para liberar
  // os avisos nas configurações do aparelho e volta encontraria o cartão ainda
  // dizendo "bloqueado": o cartão interno avisa quando o navegador já diz outra
  // coisa, e aqui ele é montado de novo (lê tudo outra vez).
  const [leitura, setLeitura] = useState(0);
  const reler = useCallback(() => setLeitura((n) => n + 1), []);
  return <CartaoInterno key={leitura} aoFechar={aoFechar} aoReler={reler} />;
}

function CartaoInterno({
  aoFechar,
  aoReler,
}: Readonly<{ aoFechar?: () => void; aoReler: () => void }>) {
  const { isAdmin } = useAuth();
  const {
    isSupported,
    permission,
    subscription,
    semConta,
    sondado,
    subscribe,
  } = usePushNotifications();
  const { config } = useStore();
  const isOffline = useOnlineStatus();
  const nomeDoApp = nomeDaLoja(config);

  const [adiadoAte, setAdiadoAte] = useState<number | null>(() =>
    lerAdiamentoDosAvisos(),
  );
  const [ligando, setLigando] = useState(false);
  const [erroDeLigar, setErroDeLigar] = useState<string | null>(null);
  // A inscrição que ESTE cartão acabou de criar. Com ela o cartão fica na tela
  // para oferecer o teste, em vez de sumir no mesmo instante em que o hook
  // passa a enxergar o aparelho como inscrito.
  const [inscricaoNova, setInscricaoNova] = useState<PushSubscription | null>(
    null,
  );
  const [encerrado, setEncerrado] = useState(false);
  const [teste, setTeste] = useState<EstadoDoTeste>("ocioso");
  const botaoDeTesteRef = useRef<HTMLButtonElement>(null);
  // Trava de toque duplo: o estado só muda no render seguinte, e dois toques
  // no mesmo instante leem o mesmo `false` — com o hook, o segundo toque
  // pediria a permissão e gravaria a inscrição duas vezes.
  const emVoo = useRef({ ligar: false, teste: false });

  // O botão "Ligar" some quando dá certo: sem isto o foco do teclado e do
  // leitor de tela cairia no corpo da página.
  useEffect(() => {
    if (inscricaoNova) botaoDeTesteRef.current?.focus();
  }, [inscricaoNova]);

  // Voltou à tela (ou à janela) e a permissão do navegador já não é a que a
  // sonda leu: refaz a leitura inteira.
  useEffect(() => {
    const conferir = () => {
      if (document.visibilityState === "hidden") return;
      // No meio de "Ligar": o balão de permissão fecha, o foco volta à janela
      // e o navegador já diz "granted" ANTES de o hook atualizar o próprio
      // estado. Reler agora reconstruiria o cartão e jogaria fora o "Avisos
      // ligados / Mandar teste" que está para aparecer (e a trava de toque
      // duplo). Quem está ligando já vai atualizar a permissão sozinho.
      if (emVoo.current.ligar) return;
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== permission) aoReler();
    };
    document.addEventListener("visibilitychange", conferir);
    window.addEventListener("focus", conferir);
    return () => {
      document.removeEventListener("visibilitychange", conferir);
      window.removeEventListener("focus", conferir);
    };
  }, [permission, aoReler]);

  if (!isAdmin || semConta || encerrado) return null;

  const ligar = async () => {
    if (emVoo.current.ligar) return;
    if (isOffline) {
      setErroDeLigar("Sem internet agora. Conecte-se e toque de novo.");
      return;
    }
    emVoo.current.ligar = true;
    setLigando(true);
    setErroDeLigar(null);
    try {
      const nova = await subscribe();
      if (nova) {
        setInscricaoNova(nova);
      } else {
        setErroDeLigar("Não foi possível ligar os avisos agora.");
      }
    } catch (erro) {
      // O hook também mostra a causa em aviso passageiro (2,5 a 8 s); aqui ela
      // fica FIXA, porque é a instrução de como resolver (ex.: ligar as
      // notificações do app nas configurações do celular). A frase do hook já
      // vem traduzida em `.message`; só ela é repetida — o texto cru de um
      // erro qualquer (DOMException, Postgrest) nunca chega à tela.
      const traduzida =
        erro instanceof Error &&
        erro.name === "PushSubscribeError" &&
        erro.message.trim() !== "";
      setErroDeLigar(
        traduzida
          ? (erro as Error).message
          : "Os avisos não foram ligados. Tente de novo em instantes.",
      );
    } finally {
      emVoo.current.ligar = false;
      setLigando(false);
    }
  };

  const mandarTeste = async () => {
    const alvo = inscricaoNova ?? subscription;
    if (!alvo || emVoo.current.teste) return;
    if (isOffline) {
      setTeste("sem-rede");
      return;
    }
    emVoo.current.teste = true;
    setTeste("enviando");
    try {
      const { endpoint, keys } = alvo.toJSON();
      const { data, error } = await supabase.functions.invoke("send-push", {
        body: {
          title: `Aviso de teste — ${nomeDoApp}`,
          body: "Se você está lendo isto, o aviso de pedido novo chega neste aparelho.",
          // A mesma tela que o aviso real de pedido novo abre
          // (`notify-new-order`, `montarAviso`).
          url: "/admin-orders",
          tokens: [
            { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } },
          ],
        },
      });
      const enviados = Number(
        (data as { enviados?: unknown } | null)?.enviados,
      );
      setTeste(!error && enviados > 0 ? "enviado" : "falhou");
    } catch {
      setTeste("falhou");
    } finally {
      emVoo.current.teste = false;
    }
  };

  const regiao = (
    titulo: string,
    icone: React.ReactNode,
    corpo: React.ReactNode,
  ) => (
    <section
      aria-label="Avisos de pedido novo neste aparelho"
      className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-white shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200"
          aria-hidden="true"
        >
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black leading-snug text-amber-100">
            {titulo}
          </h2>
          {corpo}
        </div>
      </div>
    </section>
  );

  if (inscricaoNova) {
    return regiao(
      "Avisos ligados neste aparelho",
      <BellRing className="size-5" />,
      <>
        <p className="mt-1 text-xs leading-relaxed text-zinc-200">
          Pronto: a partir de agora o pedido novo avisa neste aparelho. Quer
          conferir? Mande um aviso de teste.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            ref={botaoDeTesteRef}
            type="button"
            onClick={() => void mandarTeste()}
            disabled={teste === "enviando"}
            className={BOTAO_PRIMARIO}
          >
            {teste === "enviando" ? "Enviando..." : "Mandar um aviso de teste"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEncerrado(true);
              aoFechar?.();
            }}
            className={BOTAO_SECUNDARIO}
          >
            Pronto
          </button>
        </div>
        {teste === "enviado" ? (
          <p role="status" className="mt-3 text-xs text-emerald-300">
            Aviso de teste enviado. Ele deve aparecer neste aparelho em
            instantes. Se não aparecer, confira se as notificações do aparelho
            estão ligadas.
          </p>
        ) : null}
        {teste === "falhou" ? (
          <p role="alert" className="mt-3 text-xs text-red-300">
            O aviso de teste não foi enviado. Os avisos podem não estar chegando
            neste aparelho: toque em Mandar um aviso de teste de novo ou ligue
            os avisos outra vez.
          </p>
        ) : null}
        {teste === "sem-rede" ? (
          <p role="alert" className="mt-3 text-xs text-red-300">
            Sem internet agora. Conecte-se e toque de novo.
          </p>
        ) : null}
      </>,
    );
  }

  const situacao = situacaoDosAvisos({
    sondado,
    isSupported,
    permission,
    temInscricao: subscription !== null,
    ehApple: ehAparelhoDaApple(),
    instalado: estaComoAppInstalado(),
  });
  if (situacao === "sondando" || situacao === "ligados") return null;
  if (adiamentoEstaValendo(adiadoAte, Date.now())) return null;

  const agoraNao = (
    <button
      type="button"
      onClick={() => {
        setAdiadoAte(adiarOsAvisos(Date.now()));
        aoFechar?.();
      }}
      className={BOTAO_SECUNDARIO}
    >
      Agora não
    </button>
  );
  const titulo = "Você não está recebendo aviso de pedido novo neste aparelho";
  const icone = <BellOff className="size-5" />;

  if (situacao === "instalar-no-ios") {
    return regiao(
      titulo,
      icone,
      <>
        <p className="mt-1 text-xs leading-relaxed text-zinc-200">
          Sem isso, a loja só vê o pedido quando você abre o painel. No iPhone e
          no iPad o aviso só chega com o app instalado na Tela de Início:
        </p>
        <ListaDePassos passos={PASSOS_PARA_INSTALAR_NO_IOS} />
        <div className="mt-3 flex flex-wrap gap-2">{agoraNao}</div>
      </>,
    );
  }

  if (situacao === "ios-antigo") {
    return regiao(
      titulo,
      icone,
      <>
        <p className="mt-1 text-xs leading-relaxed text-zinc-200">
          Sem isso, a loja só vê o pedido quando você abre o painel. O sistema
          deste iPhone ou iPad é antigo demais para receber avisos. Atualize o
          iOS (ou iPadOS) para a versão 16.4 ou mais nova, em Ajustes → Geral →
          Atualização de Software, e abra o app de novo.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">{agoraNao}</div>
      </>,
    );
  }

  if (situacao === "sem-suporte") {
    return regiao(
      titulo,
      icone,
      <>
        <p className="mt-1 text-xs leading-relaxed text-zinc-200">
          Sem isso, a loja só vê o pedido quando você abre o painel. Este
          navegador não consegue receber avisos. Abra o painel num navegador
          atualizado, como o Chrome, para ligar.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">{agoraNao}</div>
      </>,
    );
  }

  if (situacao === "bloqueado") {
    return regiao(
      titulo,
      icone,
      <>
        <p className="mt-1 text-xs leading-relaxed text-zinc-200">
          Sem isso, a loja só vê o pedido quando você abre o painel. Os avisos
          estão bloqueados neste aparelho. Para liberar:
        </p>
        <ListaDePassos
          passos={passosParaLiberarOsAvisos(
            { instalado: estaComoAppInstalado(), ehApple: ehAparelhoDaApple() },
            nomeDoApp,
          )}
        />
        <div className="mt-3 flex flex-wrap gap-2">{agoraNao}</div>
      </>,
    );
  }

  return regiao(
    titulo,
    icone,
    <>
      <p className="mt-1 text-xs leading-relaxed text-zinc-200">
        Sem isso, a loja só vê o pedido quando você abre o painel. Ligando os
        avisos, este aparelho avisa assim que um pedido chega.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void ligar()}
          disabled={ligando}
          aria-busy={ligando}
          className={BOTAO_PRIMARIO}
        >
          {ligando ? "Ligando..." : "Ligar avisos neste aparelho"}
        </button>
        {agoraNao}
      </div>
      {erroDeLigar ? (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {erroDeLigar}
        </p>
      ) : null}
    </>,
  );
}
