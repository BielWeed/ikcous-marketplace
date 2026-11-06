import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE,
  ehAparelhoDaApple,
  estaComoAppInstalado,
  passosParaLiberarOsAvisos,
  situacaoDosAvisos,
} from "@/lib/avisos-do-aparelho";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { BellOff, BellRing } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Estado dos avisos NESTE aparelho, na tela de notificações da cliente (caça
 * r21, achado 5). O convite do `PushNotificationBanner` some quando ela toca
 * "Agora não" (volta em 7 dias) e some de vez quando ela bloqueia — e antes
 * nenhuma tela dizia por que o "Pedido a caminho" não chegava no celular, nem
 * deixava ligar de novo.
 *
 * Só aparece quando há o que fazer: bloqueado (explica como liberar, porque
 * nenhuma página desfaz um bloqueio), iPhone/iPad no Safari fora do app
 * instalado (explica como instalar: é a única porta para o aviso chegar lá) ou
 * desligado mas liberado (um toque liga, pelo MESMO `subscribe()` do convite).
 * Quem já recebe, quem não tem conta e quem está num navegador sem push (ou num
 * iOS velho demais) não vê nada: não há ação a oferecer.
 * Voltou das configurações já liberado? O hook relê a permissão ao voltar à
 * tela e o cartão troca sozinho de "bloqueado" para o botão de ligar.
 */
export function AvisosDoAparelhoDaCliente() {
  const {
    isSupported,
    permission,
    subscription,
    semConta,
    sondado,
    subscribe,
  } = usePushNotifications();
  const [ligando, setLigando] = useState(false);
  const [erroDeLigar, setErroDeLigar] = useState<string | null>(null);
  // Trava de toque duplo: o estado só muda no render seguinte, e dois toques
  // no mesmo instante pediriam a permissão e gravariam a inscrição duas vezes.
  const emVoo = useRef(false);

  if (semConta) return null;

  const ehApple = ehAparelhoDaApple();
  const instalado = estaComoAppInstalado();
  const situacao = situacaoDosAvisos({
    sondado,
    isSupported,
    permission,
    temInscricao: subscription !== null,
    ehApple,
    instalado,
  });

  const ligar = async () => {
    if (emVoo.current) return;
    emVoo.current = true;
    setLigando(true);
    setErroDeLigar(null);
    try {
      const nova = await subscribe();
      if (!nova) setErroDeLigar("Não foi possível ligar os avisos agora.");
    } catch (erro) {
      // O hook também mostra a causa num aviso passageiro; aqui ela fica FIXA,
      // porque é a instrução de como resolver. Só a frase já traduzida do hook
      // chega à tela, nunca o texto cru de um erro qualquer.
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
      emVoo.current = false;
      setLigando(false);
    }
  };

  if (situacao === "bloqueado") {
    return (
      <section
        aria-label="Avisos neste aparelho"
        className="mt-3 rounded-[18px] border border-solid border-border p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-muted/40">
            <BellOff
              className="size-5 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-6 text-foreground">
              Avisos bloqueados neste aparelho
            </h2>
            <p className="text-[14px] leading-5 text-muted-foreground">
              Por isso o "Pedido a caminho" e os comunicados da loja só aparecem
              aqui dentro do app, e não chegam no celular. Para receber, libere
              nas configurações:
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-[14px] leading-5 text-foreground">
              {passosParaLiberarOsAvisos(
                { instalado, ehApple },
                nomeDaLoja(),
              ).map((passo) => (
                <li key={passo}>{passo}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    );
  }

  if (situacao === "instalar-no-ios") {
    return (
      <section
        aria-label="Avisos neste aparelho"
        className="mt-3 rounded-[18px] border border-solid border-border p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-muted/40">
            <BellOff
              className="size-5 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-6 text-foreground">
              Para receber avisos no iPhone, instale o app
            </h2>
            <p className="text-[14px] leading-5 text-muted-foreground">
              O iPhone só entrega o "Pedido a caminho" e os comunicados da loja
              ao app instalado na Tela de Início; no Safari eles só aparecem
              aqui dentro. Para receber:
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-[14px] leading-5 text-foreground">
              {PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE.map((passo) => (
                <li key={passo}>{passo}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    );
  }

  if (situacao !== "ligar") return null;

  return (
    <section
      aria-label="Avisos neste aparelho"
      className="mt-3 rounded-[18px] border border-solid border-border p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-muted/40">
          <BellRing
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-6 text-foreground">
            Avisos desligados neste aparelho
          </h2>
          <p className="text-[14px] leading-5 text-muted-foreground">
            Ligue para receber no celular o "Pedido a caminho" e os comunicados
            da loja.
          </p>
          <Button
            type="button"
            onClick={() => void ligar()}
            disabled={ligando}
            aria-busy={ligando}
            className="mt-3 h-11 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-foreground/90"
          >
            {ligando ? "Ligando..." : "Ligar avisos neste aparelho"}
          </Button>
          {erroDeLigar ? (
            <p
              role="alert"
              className="mt-3 text-[14px] leading-5 text-red-700 dark:text-red-400"
            >
              {erroDeLigar}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
