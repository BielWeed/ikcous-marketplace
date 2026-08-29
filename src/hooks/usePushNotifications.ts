import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

// `subscribe()` mistura DUAS famílias de erro que não têm nada a ver uma com
// a outra: a API de Push do navegador (permissão, suporte, serviço de push
// indisponível) e o Supabase (gravar a inscrição). Um catch só, mostrando
// `error.message`, apagava essa diferença e ainda vazava texto técnico cru
// (DOMException em inglês, ou a mensagem do Postgrest/RLS). A causa da
// PERMISSÃO é certa (o próprio código já checou o resultado); as outras duas
// são heterogêneas por dentro — o que se sabe com certeza é só a FAMÍLIA.
//
// A família "permissão" tem duas causas que NÃO são a mesma coisa, mesmo as
// duas fazendo `Notification.requestPermission()` resolver algo diferente de
// "granted": `denied` é decisão CONFIRMADA (a pessoa escolheu Bloquear, só
// se resolve nas configurações do navegador/aparelho); `default` é o balão
// fechado sem escolha nenhuma (permissão ainda PENDENTE) — mandar essa
// pessoa para configurações mostra "Perguntar", nada aparentemente errado,
// e ela nunca descobre que basta tocar de novo.
type PushSubscribeErrorOrigin =
  | "permissao_negada"
  | "permissao_pendente"
  | "navegador"
  | "banco"
  | "sem_conta";

// A frase de "banco" honra o que o `postgrest-js` realmente garante: ele
// devolve `{ error }` em vez de lançar (`shouldThrowOnError: false`), então
// um erro aqui também cobre "a requisição chegou e só a resposta se
// perdeu" — nesse caso a gravação PODE ter acontecido de verdade. "Não foi
// possível salvar" mentiria nesse cenário; "não conseguimos confirmar" é
// verdade nos dois. O `upsert` é idempotente por `onConflict: "endpoint"`,
// então repetir converge — MAS só porque `subscribe()` (mais abaixo) só
// desfaz no navegador o que a PRÓPRIA chamada criou agora; se ele
// desfizesse uma inscrição já existente, o retry pegaria um endpoint novo
// e a convergência quebraria (a linha antiga ficaria órfã de verdade).
//
// A frase de "permissão" evita "configurações do site": esse rótulo não
// existe no iOS. Fora do modo instalado, o Safari nem expõe `PushManager`
// — `isSupported` já é `false` e a frase não chega a aparecer. No web app
// instalado na Tela de Início, a permissão mora em Ajustes do iOS →
// Notificações → o app, não em "configurações do site" — por isso o texto
// fala em "navegador ou aparelho", verdadeiro nas duas plataformas.
// `switch` exaustivo em vez de `Record` + indexação dinâmica: a indexação
// por chave `Identifier` (`MENSAGEM_POR_ORIGEM[origin]`) dispara
// `security/detect-object-injection` do eslint — sobe a catraca de warnings
// (551 -> 552, teto sem folga) e o repositório evita `eslint-disable` por
// política. O `switch` mantém a checagem de exaustividade do TypeScript
// sobre `PushSubscribeErrorOrigin` (falta um `case` e o build acusa) sem
// precisar de indexação nenhuma.
function mensagemDaOrigem(origin: PushSubscribeErrorOrigin): string {
  switch (origin) {
    case "permissao_negada":
      return "Você precisa permitir as notificações para recebê-las. Ative a permissão nas configurações de notificações do seu navegador ou do seu aparelho e tente de novo.";
    case "permissao_pendente":
      // Sem nome de botão de propósito: esta MESMA frase sai em duas telas
      // com controles de nomes diferentes ("Quero Receber!" no banner do
      // cliente, "Testar Recebimento Neste Aparelho" no painel). Nomear um
      // deles deixaria a frase falsa na outra tela — "de novo" já aponta
      // para o botão que a pessoa acabou de tocar.
      return "Toque de novo e escolha Permitir quando o navegador perguntar.";
    case "navegador":
      return "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";
    case "banco":
      return "Não conseguimos confirmar que sua inscrição foi salva. Tente novamente em instantes.";
    case "sem_conta":
      // A checagem que gera esta origem roda ANTES de
      // `Notification.requestPermission()` — de propósito: se lançasse
      // depois de pedir a permissão, o balão do navegador já teria sido
      // respondido e sumiria do banner nos próximos carregamentos mesmo
      // sem a pessoa nunca ter recebido nada. Lançando antes, a permissão
      // continua PENDENTE e ela pode tentar de novo depois de entrar.
      return "Para receber os avisos, entre na sua conta primeiro — é assim que a loja sabe para qual aparelho enviar.";
  }
}

class PushSubscribeError extends Error {
  readonly origin: PushSubscribeErrorOrigin;

  constructor(origin: PushSubscribeErrorOrigin, cause: unknown) {
    // `message` carrega a frase JÁ TRADUZIDA — a mesma que
    // `mensagemPorOrigem` devolveria — nunca o texto cru da causa. Antes
    // era o inverso, e uma classe cujo `.message` é justamente o texto que
    // este arquivo existe para esconder é uma armadilha: o primeiro
    // `toast.error(err.message)` futuro, no lugar do `mensagemPorOrigem`
    // correto, vazaria tudo de novo. O texto cru continua acessível em
    // `cause`, para quem precisar depurar.
    super(mensagemDaOrigem(origin));
    this.name = "PushSubscribeError";
    this.origin = origin;
    this.cause = cause;
  }
}

function mensagemPorOrigem(error: unknown): string {
  if (error instanceof PushSubscribeError) {
    return mensagemDaOrigem(error.origin);
  }
  return "Não foi possível se inscrever para notificações. Tente novamente.";
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    const checkSupport = async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in globalThis;
      setIsSupported(supported);

      if (supported) {
        setPermission(Notification.permission);
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        setSubscription(sub);
      }
    };

    checkSupport();
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;

    try {
      // Get VAPID public key from env or use a default one for dev
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

      if (!vapidPublicKey) {
        // Item 5 da revisão de 27/08/2026: isto devolvia `undefined` em
        // silêncio (nem toast, nem erro) — mesmo defeito que
        // `push-sem-conta-avisa-em-vez-de-calar.test.ts` já corrigiu para a
        // origem "sem_conta". Com o banner agora reaparecendo sempre que há
        // permissão concedida mas nenhuma inscrição salva, faltar a chave
        // deixava o tarjão "Quero Receber!" para sempre na tela, clicável e
        // inerte. Família "navegador": não é decisão da pessoa (permissão),
        // nem falha do banco — é o app que não está configurado para
        // inscrever ninguém neste build.
        throw new PushSubscribeError(
          "navegador",
          new Error("VAPID Public Key não configurada no build"),
        );
      }

      // Precisa ser ANTES de pedir a permissão do navegador: se a pessoa
      // não tem conta, pedir agora e lançar DEPOIS deixaria a permissão já
      // concedida — o balão só aparece enquanto ela está pendente, então
      // ele sumiria do banner sem ela nunca ter recebido nada.
      if (!user) {
        throw new PushSubscribeError(
          "sem_conta",
          new Error("Sem sessão de usuário para a inscrição"),
        );
      }

      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === "denied") {
        // Decisão CONFIRMADA — a pessoa escolheu Bloquear. Só se resolve
        // nas configurações do navegador/aparelho.
        throw new PushSubscribeError(
          "permissao_negada",
          new Error("Permissão de notificação negada"),
        );
      }

      if (result !== "granted") {
        // `result === "default"`: o balão do navegador foi fechado sem
        // escolher Permitir nem Bloquear. A permissão está PENDENTE, não
        // negada — mandar para configurações mostraria "Perguntar" e nada
        // aparentemente errado. Tocar de novo reabre o balão.
        throw new PushSubscribeError(
          "permissao_pendente",
          new Error("Permissão de notificação não respondida"),
        );
      }

      const registration = await navigator.serviceWorker.ready;

      // `pushManager.subscribe()` com a MESMA `applicationServerKey` não
      // cria nada quando já existe uma inscrição viva — a spec (W3C Push
      // API, algoritmo de `subscribe()`, passo 11.6) compara as `options`
      // com as da inscrição existente e, se baterem, resolve a promessa com
      // a inscrição EXISTENTE. Sem saber disso, o `unsubscribe()` de erro do
      // banco (mais abaixo) destruiria uma inscrição que este fluxo nem
      // criou — cenário real: a pessoa já está inscrita, toca de novo em
      // "Testar Recebimento" ou no convite, e um blip passageiro no
      // Supabase apaga a inscrição que já funcionava.
      //
      // Falha ao sondar = estado DESCONHECIDO, e desconhecido não autoriza
      // destruir — falha fechada: assume que já existia (não desfaz). Try/
      // catch PRÓPRIO: se isto lançasse dentro do try grande, o erro
      // trocaria de família (viraria a mensagem genérica do catch externo)
      // em vez da família real ("banco"/"navegador") do que vier a seguir.
      let inscricaoJaExistiaAntesDestaChamada = true;
      try {
        const inscricaoExistente =
          await registration.pushManager.getSubscription();
        inscricaoJaExistiaAntesDestaChamada = inscricaoExistente !== null;
      } catch {
        inscricaoJaExistiaAntesDestaChamada = true;
      }

      // Convert VAPID key from base64 to Uint8Array
      const padding = "=".repeat((4 - (vapidPublicKey.length % 4)) % 4);
      const base64 = (vapidPublicKey + padding)
        .replaceAll("-", "+")
        .replaceAll("_", "/");
      const rawData = globalThis.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.codePointAt(i) || 0;
      }

      let newSubscription: PushSubscription;
      try {
        newSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray,
        });
      } catch (subscribeError) {
        // Causa heterogênea (MDN: NotAllowedError, AbortError,
        // NotSupportedError… cada engine com o seu texto) — família
        // "navegador", frase genérica e honesta, não uma prescrição que só
        // serve para um subtipo.
        throw new PushSubscribeError("navegador", subscribeError);
      }

      // `user` já foi garantido acima, antes de pedir a permissão —
      // capturado no fechamento desta chamada e imutável durante a
      // execução (closure de `useCallback`), então segue não-nulo aqui.
      const subJSON = newSubscription.toJSON();

      const { error } = await (
        supabase.from("push_subscriptions" as any) as any
      ).upsert(
        {
          endpoint: subJSON.endpoint,
          p256dh: subJSON.keys?.p256dh,
          auth: subJSON.keys?.auth,
          user_id: user.id,
        },
        { onConflict: "endpoint" },
      );

      if (error) {
        // O navegador JÁ criou a inscrição — o que falhou foi salvar no
        // banco (RLS, coluna, o que for). Sem desfazer, o navegador fica
        // inscrito e o banco vazio: ninguém consegue enviar para esta
        // cliente, e a PRÓXIMA carga acha `getSubscription()` não-nulo —
        // o app acredita que ela está inscrita, esconde o convite para
        // sempre, e a permissão já concedida vira um beco sem saída.
        //
        // Mas só faz sentido desfazer o que ESTA chamada criou agora —
        // `inscricaoJaExistiaAntesDestaChamada` (ver sonda logo acima, antes
        // do `subscribe()`). Se já havia inscrição viva, `newSubscription`
        // É essa mesma inscrição (devolvida pela spec, não criada de novo);
        // desfazê-la destruiria algo que já funcionava, por causa de um erro
        // que não tem nada a ver com ela.
        //
        // Desfazer a inscrição RECÉM-CRIADA devolve um estado CONSISTENTE
        // (nem navegador, nem banco) e barato de repetir: a permissão do
        // SO/navegador já foi concedida, então tentar de novo não reabre o
        // balão. Contas dos dois lados, por escrito:
        //   - Se este `unsubscribe()` também falhar, sobra a MESMA
        //     inconsistência de antes do conserto — não fica pior, e o
        //     erro de banco ainda é reportado (catch abaixo).
        //   - Se o `error` acima for, na verdade, "a resposta se perdeu
        //     mas a gravação aconteceu" (ver comentário no topo do
        //     arquivo sobre o `postgrest-js`), desfazer aqui deixa uma
        //     linha órfã no banco — resíduo inofensivo NESSE caso
        //     específico: a inscrição era nova, então não existe cliente
        //     que dependia dela até agora; o provedor de push só para de
        //     conseguir entregar numa linha que ninguém usava.
        // O bem maior — a cliente conseguir se inscrever de verdade, em
        // vez de ficar invisível para sempre — vale mais que os dois
        // riscos acima, sem pagar o preço de destruir uma inscrição alheia.
        if (!inscricaoJaExistiaAntesDestaChamada) {
          try {
            await newSubscription.unsubscribe();
          } catch (unsubscribeError) {
            console.error(
              "Falha ao desfazer inscrição do navegador após erro no banco:",
              unsubscribeError,
            );
          }
        }
        throw new PushSubscribeError("banco", error);
      }

      setSubscription(newSubscription);
      toast.success("Inscrição realizada com sucesso!");
      return newSubscription;
    } catch (error: any) {
      console.error("Error subscribing to push:", error);
      toast.error(mensagemPorOrigem(error));
      throw error;
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;

    try {
      await subscription.unsubscribe();

      // Remove from Supabase
      const { error } = await (
        supabase.from("push_subscriptions" as any) as any
      )
        .delete()
        .eq("endpoint", subscription.endpoint);

      if (error) throw error;

      setSubscription(null);
      toast.success("Você não receberá mais notificações.");
    } catch (error) {
      console.error("Error unsubscribing:", error);
      toast.error("Erro ao cancelar inscrição");
    }
  }, [subscription]);

  return {
    subscription,
    isSupported,
    permission,
    subscribe,
    unsubscribe,
  };
}
