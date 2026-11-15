import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  celularBrasileiroCompleto,
  mascaraTelefoneDoCadastro,
  mensagemDeWhatsappIncompleto,
} from "@/lib/telefone-br";
import { useRef, useState } from "react";

interface Props {
  user: { id: string; identities?: { provider: string }[] } | null;
  profile: { id?: string; role?: string; whatsapp?: string | null } | null;
  habilitado: boolean;
  checkout?: boolean;
  updateProfile: (
    updates: { whatsapp: string },
    opcoes: { silencioso: boolean; contaEsperada: string },
  ) => Promise<boolean>;
}

const dispensadosNaPagina = new Set<string>();
const chave = (id: string) => `ikcous_google_whatsapp_v1:${id}`;

function jaDispensou(id: string): boolean {
  if (dispensadosNaPagina.has(id)) return true;
  try {
    return localStorage.getItem(chave(id)) === "1";
  } catch {
    return false;
  }
}

/** Montado com key=user.id: campo e resposta pendente nunca atravessam contas. */
export function AvisoWhatsappGoogle({
  user,
  profile,
  habilitado,
  checkout,
  updateProfile,
}: Props) {
  const [dispensado, setDispensado] = useState(
    () => !!user && jaDispensou(user.id),
  );
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const emCurso = useRef(false);
  if (
    !habilitado ||
    checkout ||
    !user ||
    !profile ||
    profile.id !== user.id ||
    profile.role !== "customer" ||
    profile.whatsapp?.trim() ||
    !user.identities?.some((identidade) => identidade.provider === "google") ||
    dispensado ||
    location.pathname === "/checkout"
  )
    return null;

  const dispensar = () => {
    dispensadosNaPagina.add(user.id);
    try {
      localStorage.setItem(chave(user.id), "1");
    } catch {
      /* vale nesta página */
    }
    setDispensado(true);
  };
  const salvar = async () => {
    if (emCurso.current) return;
    if (!celularBrasileiroCompleto(telefone)) {
      setErro(mensagemDeWhatsappIncompleto(telefone));
      return;
    }
    emCurso.current = true;
    setSalvando(true);
    setErro(null);
    try {
      if (
        await updateProfile(
          { whatsapp: telefone },
          { silencioso: true, contaEsperada: user.id },
        )
      ) {
        dispensar();
      } else {
        setErro(
          "Não deu para confirmar o salvamento. Você pode conferir no perfil ou deixar para depois.",
        );
      }
    } catch {
      setErro(
        "Não deu para confirmar o salvamento. Você pode deixar para depois.",
      );
    } finally {
      emCurso.current = false;
      setSalvando(false);
    }
  };
  return (
    <section
      aria-labelledby="aviso-whatsapp-google-titulo"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md space-y-3 rounded-3xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl"
    >
      <h2 id="aviso-whatsapp-google-titulo" className="text-base font-bold">
        Seu WhatsApp, para a loja avisar do pedido
      </h2>
      <label htmlFor="google-whatsapp" className="block text-sm">
        WhatsApp com DDD
      </label>
      <Input
        id="google-whatsapp"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={telefone}
        aria-describedby={erro ? "google-whatsapp-erro" : undefined}
        aria-invalid={!!erro}
        onChange={(evento) => {
          setTelefone(mascaraTelefoneDoCadastro(evento.target.value, telefone));
          setErro(null);
        }}
        className="h-12"
      />
      {erro && (
        <p
          id="google-whatsapp-erro"
          role="status"
          className="text-sm text-red-700"
        >
          {erro}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={salvando}
          onClick={salvar}
          className="h-12 flex-1"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={dispensar}
          className="h-12 flex-1"
        >
          Agora não
        </Button>
      </div>
    </section>
  );
}
