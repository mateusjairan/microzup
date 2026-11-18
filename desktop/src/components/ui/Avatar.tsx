import { useI18n } from "../../app/I18nProvider";
import { avatarIndex, initials } from "../utils/format";
import {
  PRESENCE_COLOR_TOKEN,
  presenceDotSize,
  type PresenceStatus,
} from "./presence";

export type AvatarSize = 20 | 24 | 32 | 40;

export interface AvatarProps {
  /** Nome para iniciais, cor determinística e alt da foto. */
  name: string;
  /** Foto de perfil (servidor entrega em 256 px). */
  src?: string;
  size?: AvatarSize;
  /** Presença embutida (dot + aria-label — nunca só cor). */
  presence?: PresenceStatus;
  /** Cor do anel de contraste do dot — token CSS do fundo onde o avatar assenta. */
  ringColor?: string;
  className?: string;
}

/**
 * Avatar (§7): foto ou iniciais com cor determinística, tamanhos 20/24/32/40,
 * presença embutida opcional. A imagem e as iniciais são decorativas — o nome
 * visível/aria fica no contexto (linha de contato, cabeçalho).
 */
export function Avatar({
  name,
  src,
  size = 32,
  presence,
  ringColor = "var(--presence-ring)",
  className,
}: AvatarProps) {
  const t = useI18n();
  const dot = presenceDotSize(size);
  const dotOffset = Math.max(0, Math.round(dot / 3));

  return (
    <span
      className={`relative inline-flex shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full rounded-[var(--radius-full)] object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-full w-full select-none items-center justify-center rounded-[var(--radius-full)] font-semibold text-white"
          style={{
            background: `var(--avatar-${avatarIndex(name)})`,
            fontSize: Math.round(size * 0.4),
            lineHeight: 1,
          }}
        >
          {initials(name)}
        </span>
      )}
      {presence && (
        <span
          role="img"
          aria-label={t.status[presence]}
          title={t.status[presence]}
          className="absolute rounded-[var(--radius-full)]"
          style={{
            width: dot,
            height: dot,
            right: -dotOffset,
            bottom: -dotOffset,
            background: PRESENCE_COLOR_TOKEN[presence],
            boxShadow: `0 0 0 2px ${ringColor}`,
          }}
        />
      )}
    </span>
  );
}
