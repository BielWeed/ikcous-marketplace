// @vitest-environment jsdom
//
// Tarefa A3 do lote 2 (VITRINE) — ponto 1: `AccountSettingsView.tsx` chamava
// `supabase.auth.updateUser` direto e mostrava `error.message` cru
// (`Erro ao alterar senha: ${error.message}`) — a mensagem do GoTrue, em
// inglês, com jargão. `AuthContext.tsx` já tem `updatePassword` traduzindo
// por CAUSA (`same_password`, `weak_password`, `reauthentication_needed`;
// commit 18ed245) e mostrando o toast sozinho — a correção é delegar para
// ele em vez de duplicar a tradução aqui.
//
// A prova de que a delegação é real, não só "parece": o dublê de
// `@/lib/supabase` NÃO tem `auth.updateUser`. Se o componente ainda chamasse
// `supabase.auth.updateUser` por baixo dos panos, a chamada estouraria
// "Cannot read properties of undefined" e nenhuma das asserções abaixo
// passaria — `updatePassword` (do `useAuth` mockado) nunca seria chamado, e
// o campo não seria limpo.
//
// Mesmo padrão de auth-view-reenvio-confirmacao-no-login.test.tsx: `useAuth`
// mockado por inteiro, render de verdade (react-dom/client + jsdom), `sonner`
// mockado. A troca de aba usa AnimatePresence (framer-motion); em vez de
// assumir que o novo conteúdo aparece no mesmo tick, `esperarAte` (mesmo
// helper usado em admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx
// e irmãos) espera até o campo da aba de segurança existir no DOM.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updatePassword = vi.fn();
const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updateUser = vi.fn();
// Identidade ESTÁVEL entre chamadas: o componente tem
// `useEffect(fetchLocalProfile, [user])`, e um `user` recriado a cada
// invocação de `useAuth()` reabre o efeito a cada render — um laço infinito
// dentro do `act(async () => …)`, que só encerra quando as atualizações
// param de ser agendadas. Descoberto batendo o teste em 15s/8s de timeout
// sem nenhum erro visível, até isolar que renderizar SEM `act` funcionava
// (com avisos) e só o `act` async travava — a assinatura de um laço, não de
// uma trava real.
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// `auth.updateUser` PRESENTE e espionável — de propósito, ao contrário da
// versão anterior deste dublê, que simplesmente omitia `auth` inteiro. A
// prova de que a troca de senha é 100% delegada a `updatePassword` (do
// `useAuth` mockado acima) tem de sobreviver a alguém acrescentando
// `auth: {}` aqui no futuro: com o método presente e espionado,
// `expect(updateUser).not.toHaveBeenCalled()` continua acusando se a view
// voltar a chamar `supabase.auth.updateUser` direto. Um dublê sem `auth`
// só provava "estourou undefined", que é uma trava mais frágil.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser },
    rpc: vi.fn().mockResolvedValue({
      data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
      error: null,
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A troca de aba usa `layoutId="activeTabBackground"` (framer-motion), que
// mede o layout via ResizeObserver — sem ele no jsdom, o `act(async …)` do
// clique nunca via de acabar de agendar atualizações e o teste trava até o
// timeout. Mesmo par de dublês de admin-push-envio-honesto.test.tsx.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em vez
 * de dormir um tempo fixo — mesma ideia do helper homônimo usado em
 * admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx e irmãos, com
 * UMA diferença: aqui cada tique do laço abre o PRÓPRIO `act()`, em vez de um
 * `act()` só envolvendo o laço inteiro.
 *
 * Comprovado por depuração isolada (fora deste arquivo, sem sobrar rastro):
 * com um único `act(async () => { while (...) { await sleep(10) } })`
 * envolvendo o laço inteiro, o clique na aba "Segurança" nunca via o
 * `#new_password` aparecer e o teste sempre estourava os 2000ms — mesmo o
 * elemento aparecendo em ~140ms quando cada volta do laço tem seu próprio
 * `act()`. A troca de aba usa `layoutId="activeTabBackground"`
 * (framer-motion/AnimatePresence), cujas atualizações via
 * `requestAnimationFrame` não chegam a ser commitadas em DOM enquanto ainda
 * há um `act()` mais externo em aberto — um `act()` só por tique resolve
 * porque cada commit intermediário tem a chance de se aplicar antes do
 * próximo `getElementById`. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AccountSettingsView — trocar senha delega a mensagem para o hook traduzido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montarNaAbaDeSeguranca() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });

    const botaoSeguranca = localizarBotaoPorTexto("Segurança");
    expect(botaoSeguranca).toBeTruthy();
    await act(async () => {
      botaoSeguranca!.click();
    });

    await esperarAte(() => document.getElementById("new_password") !== null);
  }

  async function preencherESubmeter(senha: string, confirmacao = senha) {
    digitar("new_password", senha);
    digitar("confirm_password", confirmacao);

    const form = hospedeiro.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    // Deixa o `await updatePassword(...)` da Promise resolvida assentar.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("chama updatePassword() do contexto com a senha nova, e limpa os campos quando ele confirma sucesso", async () => {
    updatePassword.mockResolvedValue(true);
    const { toast } = await import("sonner");
    await montarNaAbaDeSeguranca();

    await preencherESubmeter("senhaNovaForte123");

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("senhaNovaForte123");
    // A view nunca chama `supabase.auth.updateUser` direto (a delegação é
    // real, não só "parece") nem dispara o próprio toast de sucesso — quem
    // avisa é `updatePassword` (AuthContext.tsx); um `toast.success` aqui
    // duplicaria o aviso quando o código real (não mockado) rodasse.
    expect(updateUser).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    const campoSenha = document.getElementById(
      "new_password",
    ) as HTMLInputElement;
    const campoConfirmacao = document.getElementById(
      "confirm_password",
    ) as HTMLInputElement;
    expect(campoSenha.value).toBe("");
    expect(campoConfirmacao.value).toBe("");
  });

  // O caso que dói: a causa (senha fraca, mesma senha, sessão vencida) é
  // tratada e mostrada pelo PRÓPRIO `updatePassword` — a view só precisa
  // saber que falhou, sem inventar mensagem nova nem limpar o formulário.
  it("quando updatePassword() devolve false (causa já traduzida e avisada pelo hook), os campos NÃO são limpos", async () => {
    updatePassword.mockResolvedValue(false);
    const { toast } = await import("sonner");
    await montarNaAbaDeSeguranca();

    // 6+ caracteres: passa da validação LOCAL de tamanho mínimo (que é outra
    // regra, não tocada por esta correção) e chega até `updatePassword` — é
    // aí, do lado do GoTrue, que uma causa como `weak_password` (que exige
    // mais do que só comprimento) ou `same_password` pode reprovar mesmo
    // assim.
    await preencherESubmeter("senha1");

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("senha1");

    const campoSenha = document.getElementById(
      "new_password",
    ) as HTMLInputElement;
    expect(campoSenha.value).toBe("senha1");
    // Anotado 2 da revisão: quem avisa da falha é o PRÓPRIO `updatePassword`
    // (AuthContext.tsx) — sem esta asserção, um `toast.error` acrescentado
    // por engano no ramo `if (!success)` (toast duplicado) sobreviveria
    // verde.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("senhas que não coincidem: nem chega a chamar updatePassword() (validação local continua de pé)", async () => {
    await montarNaAbaDeSeguranca();

    await preencherESubmeter("senhaUm123", "senhaDois456");

    expect(updatePassword).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith("As senhas não coincidem");
  });

  // O BLOQUEIO desta tarefa: `updatePassword` (AuthContext.tsx) não tem
  // try/catch próprio em volta de `supabase.auth.updateUser`. Se o PUT no
  // GoTrue tiver sucesso — a senha JÁ trocou no servidor — e só a gravação
  // da sessão nova no storage rejeitar depois (ex.: `QuotaExceededError` do
  // `localStorage`, comum no Safari/iOS com a cota cheia), a promessa que
  // `updatePassword` devolve REJEITA. Antes desta correção, `handleChange
  // Password` não tinha `catch`: a rejeição virava uma promessa não tratada
  // (React não trata isso, e não há `unhandledrejection` global no `src/`)
  // e a pessoa não via absolutamente nada — nem sucesso, nem erro — com a
  // senha antiga já morta.
  it("updatePassword() rejeita (ex.: sessão não pôde ser salva após a senha já ter sido trocada no servidor): mostra aviso visível, não falha em silêncio", async () => {
    const erroDeStorage = new DOMException(
      "QuotaExceededError",
      "QuotaExceededError",
    );
    updatePassword.mockRejectedValue(erroDeStorage);
    const { toast } = await import("sonner");
    await montarNaAbaDeSeguranca();

    await preencherESubmeter("senhaNovaForte123");

    expect(updatePassword).toHaveBeenCalledTimes(1);
    // Bloqueio 2 da revisão: a frase antiga mandava "entrar novamente" — que
    // exige SAIR primeiro, o movimento mais arriscado possível para quem
    // está logada em Conta > Segurança, com a senha nova ainda só na tela.
    // A saída verificada (doc do Supabase + auth-js@2.110.1): tocar em
    // "Atualizar Senha" de nova, com os campos como estão, resolve em UMA
    // tentativa sem sair da conta — `same_password` confirma que já trocou,
    // e `AuthContext.updatePassword` já traduz essa causa.
    //
    // Título curto (primeira frase) + descrição (o resto), no mesmo formato
    // que `AdminCarouselsView.tsx` já usa para `toast.error(titulo, {
    // description })` — os DOIS argumentos são assertados, não só o
    // primeiro, porque um `toast.error(fraseUnica)` sem o `description`
    // passaria batido se só o título fosse conferido. `duration` maior do
    // que o padrão do sonner porque a frase é longa e precisa de tempo para
    // ser lida até o fim.
    expect(toast.error).toHaveBeenCalledWith(
      "Não conseguimos confirmar se a sua senha foi alterada.",
      {
        description:
          "Toque em Atualizar Senha de novo, sem mudar os campos: se aparecer que a nova senha precisa ser diferente da atual, é porque a troca já deu certo. Se precisar entrar de novo, use a senha nova — e, se ela não funcionar, a antiga.",
        duration: 10000,
      },
    );

    // O formulário não é limpo: como a view não sabe se a troca terminou,
    // limpar os campos apagaria a única cópia da senha nova que a pessoa
    // ainda tem na tela.
    const campoSenha = document.getElementById(
      "new_password",
    ) as HTMLInputElement;
    expect(campoSenha.value).toBe("senhaNovaForte123");
  });
});
