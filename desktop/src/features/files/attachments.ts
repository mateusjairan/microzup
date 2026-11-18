import { apiDownloadFile } from "../../lib/api";
import type { I18nDict } from "../../app/I18nProvider";
import type { ChatAttachment } from "../../components/chat";
import type { Attachment } from "../../types";

/**
 * Anexos: URLs de blob autorizadas + tradução de chaves de erro.
 *
 * `/files/{id}` (e o thumbnail 480 px) exigem Bearer; `<img src>` não envia
 * header — por isso o bytes baixa via apiDownloadFile e vira objectURL
 * cacheada. O cache tem teto para não crescer sem freio (§11 memória).
 */

const objectUrlCache = new Map<string, string>();
const OBJECT_URL_CACHE_MAX = 80;

function cacheKey(attachmentId: string, variant: "full" | "thumbnail"): string {
  return `${variant}:${attachmentId}`;
}

function trimCache(): void {
  while (objectUrlCache.size > OBJECT_URL_CACHE_MAX) {
    const oldest = objectUrlCache.keys().next().value;
    if (oldest === undefined) break;
    const url = objectUrlCache.get(oldest);
    objectUrlCache.delete(oldest);
    if (url !== undefined) URL.revokeObjectURL(url);
  }
}

/** URL sincrona se já foi buscada (evita re-fetch em re-render). */
export function cachedAttachmentUrl(
  attachmentId: string,
  variant: "full" | "thumbnail",
): string | null {
  return objectUrlCache.get(cacheKey(attachmentId, variant)) ?? null;
}

/** Baixa (se preciso) e devolve a objectURL autorizada da imagem. */
export async function attachmentObjectUrl(
  attachment: Attachment,
  variant: "full" | "thumbnail",
): Promise<string> {
  const key = cacheKey(attachment.id, variant);
  const cached = objectUrlCache.get(key);
  if (cached !== undefined) return cached;
  const path =
    variant === "thumbnail" && attachment.has_thumbnail
      ? `/files/${attachment.id}/thumbnail`
      : `/files/${attachment.id}`;
  const data = await apiDownloadFile(path);
  const url = URL.createObjectURL(new Blob([data], { type: attachment.mime_type }));
  objectUrlCache.set(key, url);
  trimCache();
  return url;
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

/** Attachment (API) → ChatAttachment (componente). URLs resolvidas à parte. */
export function attachmentToChat(
  attachment: Attachment,
  urls?: { full?: string | null; thumbnail?: string | null },
): ChatAttachment {
  return {
    id: attachment.id,
    kind: isImageMime(attachment.mime_type) ? "image" : "file",
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    sizeBytes: attachment.size_bytes,
    url: urls?.full ?? undefined,
    thumbnailUrl: urls?.thumbnail ?? undefined,
    state: "ready",
  };
}

/**
 * Chave de erro (lib devolve chave, nunca texto) → mensagem i18n.
 * Cobertura: upload/download (lib/files) + errors.api.<code> (ApiError).
 */
export function fileErrorMessage(t: I18nDict, key: string | null | undefined): string {
  if (key === null || key === undefined || key === "") return t.errors.generic;
  if (key.startsWith("errors.api.")) {
    return apiErrorMessage(t, key.slice("errors.api.".length));
  }
  switch (key) {
    case "errors.upload.blockedExtension":
      return t.errors.upload.blockedExtension;
    case "errors.upload.tooLarge":
      return t.errors.upload.tooLarge;
    case "errors.upload.tooManyFiles":
      return t.errors.upload.tooManyFiles;
    case "errors.upload.hashMismatch":
      return t.errors.upload.hashMismatch;
    case "errors.download.hashMismatch":
      return t.errors.download.hashMismatch;
    case "errors.send.networkFailed":
      return t.errors.send.networkFailed;
    default:
      return t.errors.generic;
  }
}

function apiErrorMessage(t: I18nDict, code: string): string {
  const map: Record<string, string> = {
    domain_error: t.errors.api.domain_error,
    validation_error: t.errors.api.validation_error,
    conflict: t.errors.api.conflict,
    not_found: t.errors.api.not_found,
    access_denied: t.errors.api.access_denied,
    rate_limited: t.errors.api.rate_limited,
    user_already_exists: t.errors.api.user_already_exists,
    sector_already_exists: t.errors.api.sector_already_exists,
    inactive_user: t.errors.api.inactive_user,
    http_400: t.errors.api.http_400,
    http_403: t.errors.api.http_403,
    http_404: t.errors.api.http_404,
    http_409: t.errors.api.http_409,
    http_413: t.errors.api.http_413,
    http_429: t.errors.api.http_429,
    http_500: t.errors.api.http_500,
  };
  return map[code] ?? t.errors.api.domain_error;
}
