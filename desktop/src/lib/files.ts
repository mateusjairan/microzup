/**
 * Upload e download de anexos.
 *
 * Regras do cliente (plano-mvp §2/§8 e plano-frontend §8.6):
 *  - extensões bloqueadas: .exe .bat .cmd .ps1 .scr .msi .js;
 *  - ≤ 100 MB por arquivo e ≤ 5 anexos por mensagem (validados ANTES de subir);
 *  - SHA-256 do arquivo calculado no cliente (WebCrypto) e conferido com o
 *    retorno do servidor no upload e com o hash declarado no download;
 *  - download salva via diálogo nativo e pode abrir o arquivo salvo
 *    (shell.openPath por IPC);
 *  - erros de validação devolvem CHAVES i18n, nunca texto pronto.
 */
import { ApiError, apiDownloadFile, apiUploadFile } from "./api";
import type { ProgressInfo } from "./api";
import { sha256Hex, sha256HexStreamed } from "./crypto";
import { openFile, saveFileDialog, writeFile } from "./bridge";
import type { Attachment } from "../types";

export const BLOCKED_EXTENSIONS = [".exe", ".bat", ".cmd", ".ps1", ".scr", ".msi", ".js"] as const;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export type UploadErrorKey =
  | "errors.upload.blockedExtension"
  | "errors.upload.tooLarge"
  | "errors.upload.tooManyFiles"
  | "errors.upload.hashMismatch";

export type DownloadErrorKey = "errors.download.hashMismatch";

/** Erro de validação com chave i18n — a UI traduz e desenha. */
export class FileValidationError extends Error {
  readonly key: UploadErrorKey | DownloadErrorKey;
  readonly filename: string;

  constructor(key: UploadErrorKey | DownloadErrorKey, filename: string) {
    super(key);
    this.name = "FileValidationError";
    this.key = key;
    this.filename = filename;
  }
}

export interface UploadValidationDetails {
  filename: string;
  sizeBytes: number;
}

/** Valida extensão e tamanho ANTES de subir. Retorna a chave de erro ou null. */
export function validateFile(file: File): UploadErrorKey | null {
  const lower = file.name.toLowerCase();
  if (BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "errors.upload.blockedExtension";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "errors.upload.tooLarge";
  }
  return null;
}

/** Valida a contagem de anexos por mensagem (limite ≤ 5). */
export function validateAttachmentCount(currentCount: number): UploadErrorKey | null {
  if (currentCount + 1 > MAX_ATTACHMENTS_PER_MESSAGE) {
    return "errors.upload.tooManyFiles";
  }
  return null;
}

export interface WithProgress {
  onProgress?: (progress: ProgressInfo) => void;
}

export interface UploadAttachmentOptions extends WithProgress {
  signal?: AbortSignal;
}

/**
 * Sobe um anexo: valida no cliente, calcula SHA-256, faz o upload com
 * progresso e confere o hash retornado pelo servidor (integridade ponta a
 * ponta). Lança FileValidationError/ApiError — quem desenha é a UI.
 */
export async function uploadAttachment(
  file: File,
  options: UploadAttachmentOptions = {},
): Promise<Attachment> {
  const validationError = validateFile(file);
  if (validationError !== null) {
    throw new FileValidationError(validationError, file.name);
  }

  const clientHash = await sha256HexStreamed(file);
  const form = new FormData();
  form.append("file", file);
  const attachment = await apiUploadFile<Attachment>("/files", form, {
    onProgress: options.onProgress,
    signal: options.signal,
  });

  if (attachment.sha256.toLowerCase() !== clientHash) {
    throw new FileValidationError("errors.upload.hashMismatch", file.name);
  }
  return attachment;
}

export interface DownloadResult {
  /** Caminho salvo, ou null quando o usuário cancelou o diálogo. */
  path: string | null;
  verified: boolean;
  opened: boolean;
}

/**
 * Baixa um anexo com progresso, confere o SHA-256 declarado, salva via
 * diálogo e (opcionalmente) abre o arquivo salvo no disco.
 */
export async function downloadAttachment(
  attachment: Attachment,
  options: WithProgress & { openAfterSave?: boolean } = {},
): Promise<DownloadResult> {
  const data = await apiDownloadFile(`/files/${attachment.id}`, {
    onProgress: options.onProgress,
  });

  const clientHash = await sha256Hex(data);
  if (clientHash !== attachment.sha256.toLowerCase()) {
    throw new FileValidationError("errors.download.hashMismatch", attachment.filename);
  }

  const path = await saveFileDialog(attachment.filename);
  if (path === null) {
    return { path: null, verified: true, opened: false };
  }
  await writeFile(path, data);

  let opened = false;
  if (options.openAfterSave === true) {
    const error = await openFile(path);
    opened = error === null || error === "";
  }
  return { path, verified: true, opened };
}

export { ApiError };
