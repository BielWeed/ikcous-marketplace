import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import {
  type ErrosDaIdentidadeLegal,
  formatarDocumento,
  identidadeLegalParaGravar,
} from "@/lib/identidade-legal-da-loja";
import type { EditorDeMinhaLoja } from "@/views/admin/AdminAboutStoreView";
import { RefreshCw, Save } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Bloco "Dados da empresa" de Minha loja (opcional): razão social (ou nome de
// quem é o titular), CNPJ ou CPF e e-mail de atendimento. A cliente lê isto nos
// Termos, na Política de Privacidade, no contato e no rodapé da vitrine — só o
// que a lojista preencher. O coordenador de Minha loja chama este salvar,
// que grava SÓ estes três campos. Em branco é válido e grava "não informado"; valor errado NÃO grava e o
// aviso diz o que corrigir. O dígito verificador do CNPJ/CPF é conferido pelo
// app (`identidade-legal-da-loja`); o banco só garante a forma.

interface DadosDaEmpresaProps {
  readonly onRegistrarSalvamento?: (editor: EditorDeMinhaLoja) => void;
  /** Avisa a tela quando há alteração não salva (guarda de navegação). */
  readonly onDirtyChange?: (pendente: boolean) => void;
}

/** Só letras e números, maiúsculas: compara documento sem olhar a máscara. */
function soAlfanumerico(valor: string): string {
  return valor.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function semEspacoSobrando(valor: string): string {
  return valor.trim().replace(/\s+/g, " ");
}

const CLASSE_DO_CAMPO =
  "mt-2 min-h-11 w-full rounded-xl border bg-black/50 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 disabled:opacity-50";

export const DadosDaEmpresa = memo(function DadosDaEmpresa({
  onDirtyChange,
  onRegistrarSalvamento,
}: DadosDaEmpresaProps) {
  const { config, isLoaded, updateConfig } = useStore();
  const offline = useOnlineStatus();

  // O que está salvo (a "base") e o que a lojista tem na tela.
  const baseRazao = config.storeLegalName ?? "";
  const baseDocumento = formatarDocumento(config.storeLegalDocument ?? "");
  const baseEmail = config.storeSupportEmail ?? "";
  const [razao, setRazao] = useState(baseRazao);
  const [documento, setDocumento] = useState(baseDocumento);
  const [email, setEmail] = useState(baseEmail);
  const [erros, setErros] = useState<ErrosDaIdentidadeLegal>({});
  const [salvando, setSalvando] = useState(false);

  const campoRazao = useRef<HTMLInputElement>(null);
  const campoDocumento = useRef<HTMLInputElement>(null);
  const campoEmail = useRef<HTMLInputElement>(null);

  // Config que chega depois (carga assíncrona, salvamento): cada campo adota o
  // valor novo SÓ se a lojista não mexeu nele desde a base anterior — o que ela
  // digitou nunca é sobrescrito.
  const baseAnterior = useRef({
    razao: baseRazao,
    documento: baseDocumento,
    email: baseEmail,
  });
  useEffect(() => {
    const anterior = baseAnterior.current;
    if (
      anterior.razao === baseRazao &&
      anterior.documento === baseDocumento &&
      anterior.email === baseEmail
    ) {
      return;
    }
    baseAnterior.current = {
      razao: baseRazao,
      documento: baseDocumento,
      email: baseEmail,
    };
    if (razao === anterior.razao) setRazao(baseRazao);
    if (soAlfanumerico(documento) === soAlfanumerico(anterior.documento)) {
      setDocumento(baseDocumento);
    }
    if (email === anterior.email) setEmail(baseEmail);
  }, [baseRazao, baseDocumento, baseEmail, razao, documento, email]);

  const alterado =
    semEspacoSobrando(razao) !== semEspacoSobrando(baseRazao) ||
    soAlfanumerico(documento) !== soAlfanumerico(baseDocumento) ||
    email.trim() !== baseEmail.trim();

  // O sinal que liga a guarda do App: com alteração não salva (ou salvando) o
  // App sabe que há trabalho em aberto antes de a lojista sair da tela.
  const pendente = alterado || salvando;
  useEffect(() => {
    onDirtyChange?.(pendente);
  }, [pendente, onDirtyChange]);
  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useLayoutEffect(() => {
    onRegistrarSalvamento?.({ alterado, salvar });
  });

  async function salvar(): Promise<boolean> {
    if (offline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar os dados.",
      });
      return false;
    }
    if (salvando) return false;

    const conferido = identidadeLegalParaGravar({
      razaoSocial: razao,
      documento,
      email,
    });
    if (!conferido.valido) {
      // Nada é gravado: cada campo errado mostra o que corrigir e o foco vai
      // para o primeiro deles.
      setErros(conferido.erros);
      if (conferido.erros.razaoSocial) campoRazao.current?.focus();
      else if (conferido.erros.documento) campoDocumento.current?.focus();
      else campoEmail.current?.focus();
      return false;
    }
    setErros({});

    setSalvando(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue em
      // frente. `silentSuccess` cala só o "Configurações salvas" genérico: sai
      // um único aviso, o "Dados da empresa salvos" daqui.
      const salvou = await updateConfig(conferido.valores, {
        silentSuccess: true,
      });
      if (!salvou) return false;
      // Mostra o que ficou gravado (documento com máscara, espaços aparados).
      setRazao(conferido.valores.storeLegalName ?? "");
      setDocumento(formatarDocumento(conferido.valores.storeLegalDocument));
      setEmail(conferido.valores.storeSupportEmail ?? "");
      toast.success("Dados da empresa salvos");
      return true;
    } catch (erro) {
      toast.error(mensagemDeErroDoPainel(erro, "salvar"));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  const bloqueado = offline || salvando;

  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor="empresa-razao-social"
          className="text-sm font-semibold text-zinc-200"
        >
          Razão social ou nome do titular
        </label>
        <input
          ref={campoRazao}
          id="empresa-razao-social"
          type="text"
          autoComplete="organization"
          value={razao}
          disabled={bloqueado}
          onChange={(e) => {
            setRazao(e.target.value);
            if (erros.razaoSocial)
              setErros({ ...erros, razaoSocial: undefined });
          }}
          placeholder="Ex.: Loja da Ana Ltda"
          aria-invalid={erros.razaoSocial ? true : undefined}
          aria-describedby={
            erros.razaoSocial ? "empresa-razao-social-erro" : undefined
          }
          className={`${CLASSE_DO_CAMPO} ${erros.razaoSocial ? "border-red-500/60" : "border-admin-border"}`}
        />
        {erros.razaoSocial && (
          <p
            id="empresa-razao-social-erro"
            role="alert"
            className="mt-1.5 text-xs font-semibold text-red-400"
          >
            {erros.razaoSocial}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="empresa-documento"
          className="text-sm font-semibold text-zinc-200"
        >
          CNPJ ou CPF
        </label>
        <input
          ref={campoDocumento}
          id="empresa-documento"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={18}
          value={documento}
          disabled={bloqueado}
          onChange={(e) => {
            setDocumento(e.target.value);
            if (erros.documento) setErros({ ...erros, documento: undefined });
          }}
          // A máscara entra ao sair do campo: assim ela não pula o cursor
          // enquanto a lojista digita.
          onBlur={() => setDocumento(formatarDocumento(documento))}
          placeholder="Só os números (ou letras do CNPJ novo)"
          aria-invalid={erros.documento ? true : undefined}
          aria-describedby={
            erros.documento ? "empresa-documento-erro" : undefined
          }
          className={`${CLASSE_DO_CAMPO} ${erros.documento ? "border-red-500/60" : "border-admin-border"}`}
        />
        {erros.documento && (
          <p
            id="empresa-documento-erro"
            role="alert"
            className="mt-1.5 text-xs font-semibold text-red-400"
          >
            {erros.documento}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="empresa-email"
          className="text-sm font-semibold text-zinc-200"
        >
          E-mail de atendimento
        </label>
        <input
          ref={campoEmail}
          id="empresa-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          disabled={bloqueado}
          onChange={(e) => {
            setEmail(e.target.value);
            if (erros.email) setErros({ ...erros, email: undefined });
          }}
          placeholder="atendimento@sualoja.com.br"
          aria-invalid={erros.email ? true : undefined}
          aria-describedby={erros.email ? "empresa-email-erro" : undefined}
          className={`${CLASSE_DO_CAMPO} ${erros.email ? "border-red-500/60" : "border-admin-border"}`}
        />
        {erros.email && (
          <p
            id="empresa-email-erro"
            role="alert"
            className="mt-1.5 text-xs font-semibold text-red-400"
          >
            {erros.email}
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Tudo aqui é opcional. O que você preencher aparece para quem compra nos
        Termos de uso, na Política de Privacidade, no contato e no rodapé do
        app. Deixe em branco o que não quiser mostrar.
      </p>

      {!onRegistrarSalvamento && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!isLoaded || offline || salvando || !alterado}
            title="Salva a razão social, o CNPJ ou CPF e o e-mail de atendimento"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-admin-gold px-5 text-xs font-black uppercase tracking-[0.12em] text-zinc-950 shadow-[0_6px_20px_rgba(212,175,55,0.22)] transition-all hover:bg-admin-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:w-auto"
          >
            {salvando ? (
              <>
                <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save aria-hidden="true" className="size-4" />
                <span>Salvar dados da empresa</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
});
