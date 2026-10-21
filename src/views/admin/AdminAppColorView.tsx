import "./cor-do-app.css";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { branding } from "@/config/branding";
import {
  TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
  razaoDeContraste,
  textoSobreACorDaLoja,
  validaCorDaLoja,
} from "@/config/cor-da-loja";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useStoreIdentityEditor } from "@/hooks/useStoreIdentityEditor";
import type { View } from "@/types";
import {
  AlertTriangle,
  Check,
  Droplet,
  HelpCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";

interface AdminAppColorViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

const CARTAO = "rounded-[20px] border border-admin-border bg-admin-surface p-4";
const ACAO = "min-h-11 rounded-xl focus-visible:ring-admin-gold";
const NOTA =
  "A tela de abertura e o ícone do app acompanham a próxima atualização do aplicativo. O fundo do ícone do Android só muda quando você envia o ícone de novo, em Minha loja.";
const EXPLICACAO =
  "Esta é a cor da sua marca no app: ela pinta os botões principais, a barra do navegador no celular e a tela de abertura.";

function Aviso({
  titulo,
  children,
  sucesso = false,
  erro = false,
}: {
  titulo: string;
  children: React.ReactNode;
  sucesso?: boolean;
  erro?: boolean;
}) {
  return (
    <div
      role={erro ? "alert" : "status"}
      className={`flex gap-2 rounded-xl border p-3 text-xs leading-relaxed ${erro ? "border-red-500/20 bg-red-500/10 text-red-400" : sucesso ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}
    >
      {sucesso ? (
        <Check aria-hidden="true" className="size-5 shrink-0" />
      ) : (
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
      )}
      <div>
        <p className="text-[13px] font-bold">{titulo}</p>
        <div className="text-zinc-300">{children}</div>
      </div>
    </div>
  );
}

type Editor = ReturnType<typeof useStoreIdentityEditor>;

function EscolhaDaCor({
  editor,
  offline,
}: { editor: Editor; offline: boolean }) {
  const { draft } = editor;
  const valor = draft!.fields.primaryColor;
  const validacao = validaCorDaLoja(valor);
  const [ultimaValida, setUltimaValida] = useState(valor);
  const corValida = validacao.ok ? validacao.cor : null;
  useEffect(() => {
    if (corValida) setUltimaValida(corValida);
  }, [corValida]);
  const cor = corValida ?? ultimaValida;
  const padrao = branding.theme.primary.toUpperCase();
  const branco = textoSobreACorDaLoja(cor) === TEXTO_CLARO_SOBRE_A_COR_DA_LOJA;
  const texto = branco ? "#FAFAFA" : "#18181B";
  const contraste = razaoDeContraste(cor, texto);
  const fraco = contraste < 4.5;
  const pendente =
    editor.phase === "pending" ||
    (editor.phase === "checking" && !!editor.intent);
  const conflito = editor.phase === "conflict";
  const salva = editor.saveStatus === "confirmed";
  const recusada = editor.saveStatus === "rejected";
  const semCor = !draft!.expected.identity.primary_color;
  const estado = editor.busy
    ? "Salvando…"
    : pendente
      ? "Confira antes"
      : conflito
        ? "Conflito"
        : !validacao.ok
          ? "Corrija para salvar"
          : salva
            ? "Salva"
            : editor.dirty
              ? "Ainda não salva"
              : semCor
                ? "Cor padrão do app"
                : "Sem alterações";
  function escolher(value: string) {
    const comCerquilha = value.startsWith("#") ? value : `#${value}`;
    editor.setField("primaryColor", comCerquilha);
  }
  return (
    <>
      <section className={CARTAO} aria-label="Cor da marca">
        <label
          htmlFor="app-color-hex"
          className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-400"
        >
          Cor da marca
        </label>
        <div className="mt-2 flex gap-3">
          <input
            type="color"
            aria-label="Escolher cor na amostra"
            className="cor-do-app-campo size-11 shrink-0 cursor-pointer rounded-xl border bg-transparent p-0.5 disabled:opacity-50"
            value={cor}
            disabled={editor.locked}
            onChange={(e) => escolher(e.target.value)}
          />
          <Input
            id="app-color-hex"
            className="cor-do-app-campo h-11 rounded-xl bg-admin-bg text-zinc-50 focus-visible:ring-admin-gold"
            value={valor}
            disabled={editor.locked}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!validacao.ok}
            aria-describedby={
              validacao.ok ? "app-color-hint" : "app-color-hint app-color-error"
            }
            onChange={(e) => escolher(e.target.value)}
          />
        </div>
        <p id="app-color-hint" className="mt-2 text-xs leading-4 text-zinc-400">
          {semCor && !editor.dirty
            ? `Você ainda não escolheu uma cor: o app usa a cor padrão, ${padrao}.`
            : `Escreva no formato #RRGGBB, como ${padrao}, ou toque na amostra para escolher.`}
        </p>
        {!validacao.ok && (
          <div
            id="app-color-error"
            role="alert"
            className="mt-2 space-y-2 text-xs text-red-400"
          >
            <p>
              {validacao.motivo === "preto"
                ? `Preto puro não funciona bem como cor do app. Use um cinza muito escuro, como ${padrao}.`
                : `Use o formato #RRGGBB: um # e depois seis letras ou números (0 a 9, A a F). Exemplo: ${padrao}.`}
            </p>
            {validacao.motivo === "preto" && (
              <Button
                variant="ghost"
                className={ACAO}
                disabled={editor.locked}
                onClick={() => escolher(padrao)}
              >
                Usar {padrao}
              </Button>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2">
          <Button
            variant="ghost"
            className={`${ACAO} px-0 text-xs text-zinc-50`}
            disabled={
              editor.locked || valor.toLowerCase() === padrao.toLowerCase()
            }
            onClick={() => escolher(padrao)}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Voltar ao padrão
          </Button>
          <span
            role="status"
            className="text-[11px] font-semibold text-zinc-400"
          >
            {estado}
          </span>
        </div>
      </section>

      <section className={CARTAO} aria-labelledby="app-color-preview-title">
        <h2 id="app-color-preview-title" className="text-[15px] font-bold">
          Como fica no app
        </h2>
        <p className="mt-1 text-xs leading-4 text-zinc-400">
          {validacao.ok
            ? "É assim que a cor aparece no app. Nada muda para os clientes antes de você salvar."
            : "Mostrando a última cor válida. Corrija o campo para ver a nova."}
        </p>
        {/* A prévia é a tela da cliente: não herda os tons nem altera os tokens do painel. */}
        <div
          className="mt-3 overflow-hidden rounded-xl border"
          style={{
            backgroundColor: "#FFFFFF",
            color: "#27272A",
            borderColor: "#D4D4D8",
            colorScheme: "light",
          }}
        >
          <div
            data-previa-cor
            className="flex h-[30px] items-center justify-between px-3 text-[11px] font-semibold"
            style={{ backgroundColor: cor, color: texto }}
          >
            <span>9:41</span>
            <span>Barra do celular</span>
            <span aria-hidden="true">▰</span>
          </div>
          <div className="flex min-h-[214px] gap-3 p-3">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[11px]" style={{ color: "#52525B" }}>
                Botão principal
              </p>
              <div
                className="flex h-11 max-w-[172px] items-center justify-center rounded-xl px-2 text-xs font-semibold"
                style={{ backgroundColor: cor, color: texto }}
              >
                Finalizar compra
              </div>
              <div className="flex items-center gap-2 pt-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                  style={{ backgroundColor: cor, color: texto }}
                >
                  Aa
                </span>
                <div className="text-[11px]" style={{ color: "#3F3F46" }}>
                  <p>{branco ? "Texto branco" : "Texto escuro"}</p>
                  <p>{fraco ? "Difícil de ler" : "Fácil de ler"}</p>
                </div>
              </div>
            </div>
            <div className="w-24 shrink-0 text-center">
              <div
                className="flex h-[168px] flex-col items-center justify-center gap-2 rounded-[14px]"
                style={{ backgroundColor: cor, color: texto }}
              >
                <span
                  className="flex size-10 items-center justify-center rounded-xl font-bold"
                  style={{ backgroundColor: "#FAFAFA", color: "#18181B" }}
                >
                  L
                </span>
                <span className="max-w-full break-words px-1 text-[11px]">
                  {draft!.fields.storeName}
                </span>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "#3F3F46" }}>
                Tela de abertura
              </p>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-4 text-zinc-400">{NOTA}</p>
      </section>

      {fraco && (
        <Aviso titulo="O texto pode ficar difícil de ler">
          Com esta cor, o texto dos botões fica difícil de ler (
          {contraste.toFixed(1).replace(".", ",")} para 1; o ideal é 4,5 ou
          mais). Você pode salvar assim ou tentar um tom mais escuro ou mais
          claro.
        </Aviso>
      )}
      {offline && (
        <Aviso erro titulo="Sem conexão com a internet">
          Você precisa estar online para salvar a cor. A prévia continua
          funcionando.
        </Aviso>
      )}
      {salva && (
        <Aviso sucesso titulo="Cor salva">
          Os clientes veem a nova cor ao abrir o app de novo. A tela de abertura
          e o ícone acompanham a próxima atualização do aplicativo.
        </Aviso>
      )}
      {recusada && (
        <Aviso erro titulo="Não foi possível salvar a cor">
          A cor do app continua a mesma de antes. Confira a internet e tente de
          novo.
        </Aviso>
      )}
      {pendente && (
        <Aviso titulo="Não deu para confirmar se a cor foi salva">
          A gravação pode ter ocorrido. Toque em Conferir novamente antes de
          salvar de novo.
        </Aviso>
      )}
      {conflito && (
        <Aviso titulo="A marca da loja mudou em outro lugar">
          Alguém salvou outra configuração enquanto você escolhia. Sua escolha:{" "}
          {valor.toUpperCase()}. Cor que está no app agora:{" "}
          {editor.current
            ? (editor.current.identity.primary_color?.toUpperCase() ?? padrao)
            : "confira novamente"}
          . Sua escolha foi guardada.
        </Aviso>
      )}
      {conflito && editor.current ? (
        <>
          <Button
            className="h-12 w-full rounded-2xl bg-admin-gold text-black hover:bg-admin-gold/90"
            disabled={editor.busy || !editor.active}
            onClick={() => editor.resolveConflict(true)}
          >
            Revisar minha escolha
          </Button>
          <Button
            variant="outline"
            className={`${ACAO} w-full border-admin-border-strong bg-admin-bg text-zinc-50`}
            disabled={editor.busy || !editor.active}
            onClick={() => editor.resolveConflict(false)}
          >
            Usar a cor que está no app
          </Button>
        </>
      ) : pendente || conflito ? (
        <Button
          className="h-12 w-full rounded-2xl bg-admin-gold text-black hover:bg-admin-gold/90"
          disabled={offline || editor.busy || !editor.active}
          onClick={() => void editor.read()}
        >
          Conferir novamente
        </Button>
      ) : (
        <>
          <Button
            className="h-12 w-full rounded-2xl bg-admin-gold font-bold text-black hover:bg-admin-gold/90"
            disabled={
              offline || editor.locked || !editor.dirty || !validacao.ok
            }
            onClick={() => void editor.savePrimaryColor()}
          >
            <Save aria-hidden="true" className="size-4" />
            {editor.phase === "saving"
              ? "Salvando cor…"
              : recusada
                ? "Tentar de novo"
                : "Salvar cor"}
          </Button>
          {editor.dirty && (
            <Button
              variant="outline"
              className={`${ACAO} w-full border-admin-border-strong bg-admin-bg text-zinc-50`}
              disabled={editor.locked}
              onClick={editor.discard}
            >
              Descartar alterações
            </Button>
          )}
        </>
      )}
    </>
  );
}

export function AdminAppColorView({
  active = true,
  onSetDirty,
}: AdminAppColorViewProps) {
  const editor = useStoreIdentityEditor(active);
  const offline = useOnlineStatus();
  const [ajuda, setAjuda] = useState(false);
  useEffect(() => {
    onSetDirty?.(editor.dirty);
  }, [editor.dirty, onSetDirty]);
  return (
    <div className="pb-admin mx-auto max-w-lg space-y-3 px-4 pt-4 text-zinc-50">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold leading-7">
            {NOMES_DO_PAINEL["admin-app-color"]}
          </h1>
          <Button
            variant="ghost"
            className="size-11 rounded-full"
            aria-label="Ajuda sobre a cor do app"
            onClick={() => setAjuda(true)}
          >
            <HelpCircle aria-hidden="true" className="size-5" />
          </Button>
        </div>
        <p className="text-[13px] leading-[18px] text-zinc-400">
          Escolha a cor da sua marca no app.
        </p>
      </header>
      <section className={CARTAO}>
        <h2 className="flex items-center gap-3 text-[15px] font-bold">
          <span className="flex size-9 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-300">
            <Droplet aria-hidden="true" className="size-5" />
          </span>
          Para que serve
        </h2>
        <p className="mt-3 text-[13px] leading-5 text-zinc-400">{EXPLICACAO}</p>
        <p className="mt-1 text-[13px] font-semibold leading-5">
          Não muda a sua logo.
        </p>
      </section>
      {!editor.allowed ? (
        <p role="alert">
          Entre com uma sessão de administrador para editar a cor do app.
        </p>
      ) : !editor.origin ? (
        <p role="alert">
          Não foi possível identificar a loja. Confira a configuração do
          aplicativo.
        </p>
      ) : editor.draft ? (
        <EscolhaDaCor key={editor.scope} editor={editor} offline={offline} />
      ) : (
        <div className={CARTAO} role="status">
          <p>
            {editor.phase === "error"
              ? "Não foi possível carregar a cor do app."
              : editor.phase === "incomplete"
                ? editor.message
                : "Carregando a cor do app…"}
          </p>
          {editor.phase === "error" && (
            <>
              <p className="mt-1 text-xs text-zinc-400">
                Sua cor continua salva. Confira a internet e tente de novo.
              </p>
              <Button
                className={`${ACAO} mt-3 w-full bg-admin-gold text-black`}
                disabled={offline || !active}
                onClick={() => void editor.read()}
              >
                Tentar novamente
              </Button>
            </>
          )}
        </div>
      )}
      <AdminHelpModal
        isOpen={ajuda}
        onClose={() => setAjuda(false)}
        title="Como escolher a cor do app"
        icon={Droplet}
      >
        <p>{EXPLICACAO} Não muda a sua logo.</p>
        <p className="mt-3">
          Confira a prévia e toque em Salvar cor. Voltar ao padrão não salva
          sozinho.
        </p>
        <p className="mt-3">{NOTA}</p>
      </AdminHelpModal>
    </div>
  );
}
