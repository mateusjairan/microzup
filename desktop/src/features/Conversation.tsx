import { useEffect, useRef, useState } from "react";
import { MessageCircle, Paperclip, Send } from "lucide-react";
import { api, downloadFile } from "../lib/api";
import { formatDayLabel, formatSize, formatTime } from "../lib/format";
import { useApp } from "../store";
import { Avatar, EmptyState, IconButton, Input } from "../components/ui";
import { t } from "../i18n/pt-BR";
import type { Attachment, Message } from "../types";

function MessageRow({
  message,
  isOwn,
  senderName,
}: {
  message: Message;
  isOwn: boolean;
  senderName: string;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    let active = true;
    api
      .get<Attachment[]>(`/messages/${message.id}/attachments`)
      .then((list) => {
        if (active) setAttachments(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [message.id]);

  return (
    <div className={`flex gap-2 px-4 py-1 ${isOwn ? "flex-row-reverse" : ""}`}>
      <Avatar name={senderName} size={28} />
      <div className={`max-w-[70%] ${isOwn ? "items-end" : ""}`}>
        <div className="mb-0.5 text-xs text-[var(--text-3)]">
          {senderName} · {formatTime(message.created_at)}
          {message.edited_at && " · editada"}
        </div>
        <div
          className={`inline-block rounded-lg px-3 py-1.5 text-sm ${
            isOwn ? "bg-[var(--accent-soft)]" : "bg-[var(--bg-surface)] border border-[var(--border)]"
          }`}
        >
          {message.body}
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              onClick={() => downloadAttachment(attachment)}
              className="mt-1 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1 text-left text-xs hover:bg-[var(--bg-hover)]"
            >
              <Paperclip size={12} />
              <span className="truncate">{attachment.filename}</span>
              <span className="text-[var(--text-3)]">{formatSize(attachment.size_bytes)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

async function downloadAttachment(attachment: Attachment) {
  await downloadFile(`/files/${attachment.id}`, attachment.filename);
}

export function Conversation() {
  const activeId = useApp((s) => s.activeConversationId);
  const conversations = useApp((s) => s.conversations);
  const messages = useApp((s) =>
    activeId ? s.messagesByConversation[activeId] : undefined,
  );
  const user = useApp((s) => s.user);
  const users = useApp((s) => s.users);
  const typing = useApp((s) => (activeId ? s.typing[activeId] : undefined));
  const setMessages = useApp((s) => s.setMessages);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = conversations.find((c) => c.conversation.id === activeId);
  const conversation = summary?.conversation;

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    api
      .get<Message[]>(`/conversations/${activeId}/messages?limit=200`)
      .then((list) => {
        if (!cancelled) setMessages(activeId, list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeId, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [activeId, messages?.length]);

  const ownName = (id: string) => users.find((u) => u.id === id)?.display_name ?? "?";

  async function upload(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file);
    return api.upload<Attachment>("/files", form);
  }

  async function send() {
    if (!conversation || (!draft.trim() && files.length === 0)) return;
    setSending(true);
    const clientId = crypto.randomUUID();
    try {
      const result = await api.post<Message>("/messages", {
        conversation_id: conversation.id,
        client_id: clientId,
        body: draft.trim(),
        attachment_ids: files.map((f) => f.id),
      });
      useApp.getState().addMessage(result);
      setDraft("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      /* mantém rascunho */
    } finally {
      setSending(false);
    }
  }

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    for (const file of selected) {
      const attachment = await upload(file);
      setFiles((prev) => [...prev, attachment]);
    }
  }

  if (!conversation) {
    return (
      <div className="flex-1">
        <EmptyState icon={<MessageCircle size={40} />} title={t.conversation.empty} />
      </div>
    );
  }

  const title = conversation.kind === "channel" ? conversation.name : ownName(conversation.id) || "Conversa";
  const typingUsers = (typing ?? []).filter((id) => id !== user?.id);

  let lastDay = "";

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          {typingUsers.length > 0 && (
            <div className="text-xs text-[var(--text-3)]">
              {typingUsers.map((id) => ownName(id)).join(", ")} {t.conversation.typing}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        {(messages ?? []).map((message) => {
          const day = formatDayLabel(message.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={message.id}>
              {showDay && (
                <div className="my-2 text-center text-xs text-[var(--text-3)]">{day}</div>
              )}
              <MessageRow
                message={message}
                isOwn={message.sender_id === user?.id}
                senderName={ownName(message.sender_id)}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-[var(--border)] p-3">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <span
                key={f.id}
                className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs"
              >
                <Paperclip size={12} /> {f.filename}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />
          <IconButton onClick={() => fileRef.current?.click()} title="Anexar">
            <Paperclip size={18} />
          </IconButton>
          <Input
            value={draft}
            placeholder={t.conversation.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <IconButton onClick={() => void send()} disabled={sending} title={t.conversation.send}>
            <Send size={18} />
          </IconButton>
        </div>
      </footer>
    </main>
  );
}
