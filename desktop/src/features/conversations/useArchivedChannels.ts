import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { components } from "../../types/api";

type ChannelOut = components["schemas"]["ChannelOut"];

/**
 * Canais arquivados (§9): o resumo comum não expõe `archived_at`; o endpoint
 * de administração expõe. Admins desabilitam o composer de canais arquivados
 * antes do primeiro 403; membros comuns descobrem pelo erro de envio
 * (errors.api.access_denied).
 */
export function useArchivedChannels(enabled: boolean): Set<string> {
  const [archived, setArchived] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void api
      .get<ChannelOut[]>("/admin/channels")
      .then((channels) => {
        if (cancelled) return;
        setArchived(
          new Set(channels.filter((channel) => channel.archived_at !== null).map((c) => c.id)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return archived;
}
