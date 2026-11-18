import { useCallback, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  validateAttachmentCount,
  validateFile,
  uploadAttachment,
} from "../../lib/files";
import type { Attachment } from "../../types";

/**
 * Bandeja de uploads pendentes (§8.6) — por conversa, sobrevive à troca de
 * conversa ativa. Valida extensão/tamanho/contagem ANTES de subir; progresso
 * por arquivo; cancelar durante o upload; retry em falha; "ready" aguarda o
 * envio da mensagem.
 */

export type UploadState = "queued" | "uploading" | "error" | "ready";

export interface UploadEntry {
  localId: string;
  filename: string;
  sizeBytes: number;
  state: UploadState;
  /** 0–100 durante "uploading". */
  progress?: number;
  /** Chave i18n quando "error". */
  errorKey?: string;
  /** Anexo do servidor quando "ready". */
  attachment?: Attachment;
}

interface InternalEntry extends UploadEntry {
  file: File;
}

function newLocalId(): string {
  return `up-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function useUploads() {
  const [uploads, setUploads] = useState<Record<string, UploadEntry[]>>({});
  const internalRef = useRef(new Map<string, File>());
  const abortRef = useRef(new Map<string, AbortController>());

  const patch = useCallback((conversationId: string, localId: string, patchEntry: Partial<UploadEntry>) => {
    setUploads((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? []).map((entry) =>
        entry.localId === localId ? { ...entry, ...patchEntry } : entry,
      ),
    }));
  }, []);

  const runUpload = useCallback(
    async (conversationId: string, entry: InternalEntry) => {
      const controller = new AbortController();
      abortRef.current.set(entry.localId, controller);
      patch(conversationId, entry.localId, { state: "uploading", progress: 0, errorKey: undefined });
      try {
        const attachment = await uploadAttachment(entry.file, {
          signal: controller.signal,
          onProgress: ({ loaded, total }) => {
            const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
            patch(conversationId, entry.localId, { progress: percent });
          },
        });
        patch(conversationId, entry.localId, {
          state: "ready",
          progress: undefined,
          attachment,
          errorKey: undefined,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // cancelado pelo usuário: remove da bandeja
          setUploads((current) => ({
            ...current,
            [conversationId]: (current[conversationId] ?? []).filter(
              (item) => item.localId !== entry.localId,
            ),
          }));
          internalRef.current.delete(entry.localId);
        } else {
          const errorKey =
            error instanceof ApiError ? `errors.api.${error.code}` : fileErrorKeyOf(entry.file);
          patch(conversationId, entry.localId, { state: "error", progress: undefined, errorKey });
        }
      } finally {
        abortRef.current.delete(entry.localId);
      }
    },
    [patch],
  );

  /** Enfileira e sobe arquivos (botão, drag-drop, paste). Devolve mensagens de erro (chave i18n). */
  const addFiles = useCallback(
    (conversationId: string, files: File[]): string[] => {
      const errorKeys: string[] = [];
      const accepted: InternalEntry[] = [];
      const currentCount =
        (uploads[conversationId] ?? []).filter((item) => item.state !== "error").length;

      let count = currentCount;
      for (const file of files) {
        const countError = validateAttachmentCount(count);
        if (countError !== null) {
          errorKeys.push(countError);
          continue;
        }
        const fileError = validateFile(file);
        if (fileError !== null) {
          errorKeys.push(fileError);
          continue;
        }
        count += 1;
        accepted.push({
          localId: newLocalId(),
          filename: file.name,
          sizeBytes: file.size,
          state: "queued",
          file,
        });
      }

      if (accepted.length > 0) {
        setUploads((current) => ({
          ...current,
          [conversationId]: [...(current[conversationId] ?? []), ...accepted],
        }));
        for (const entry of accepted) {
          internalRef.current.set(entry.localId, entry.file);
          void runUpload(conversationId, entry);
        }
      }
      return errorKeys;
    },
    [uploads, runUpload],
  );

  const cancel = useCallback((_conversationId: string, localId: string) => {
    abortRef.current.get(localId)?.abort();
  }, []);

  const remove = useCallback((conversationId: string, localId: string) => {
    abortRef.current.get(localId)?.abort();
    abortRef.current.delete(localId);
    internalRef.current.delete(localId);
    setUploads((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? []).filter((item) => item.localId !== localId),
    }));
  }, []);

  const retry = useCallback(
    (conversationId: string, localId: string) => {
      const file = internalRef.current.get(localId);
      if (file === undefined) return;
      void runUpload(conversationId, {
        localId,
        filename: file.name,
        sizeBytes: file.size,
        state: "queued",
        file,
      });
    },
    [runUpload],
  );

  /** Anexos prontos para acompanhar a próxima mensagem. */
  const readyAttachments = useCallback(
    (conversationId: string): Attachment[] =>
      (uploads[conversationId] ?? [])
        .filter((item) => item.state === "ready" && item.attachment !== undefined)
        .map((item) => item.attachment as Attachment),
    [uploads],
  );

  /** Limpa os "ready" após o envio. */
  const clearReady = useCallback((conversationId: string) => {
    setUploads((current) => {
      const kept = (current[conversationId] ?? []).filter((item) => item.state !== "ready");
      return { ...current, [conversationId]: kept };
    });
  }, []);

  const entriesFor = useCallback(
    (conversationId: string): UploadEntry[] => uploads[conversationId] ?? [],
    [uploads],
  );

  return {
    entriesFor,
    addFiles,
    cancel,
    remove,
    retry,
    readyAttachments,
    clearReady,
  };
}

function fileErrorKeyOf(file: File): string {
  const direct = validateFile(file);
  return direct ?? "errors.send.networkFailed";
}
