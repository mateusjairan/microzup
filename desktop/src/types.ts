export type Role = "admin" | "member";
export type PresenceStatus = "available" | "busy" | "away" | "dnd" | "invisible" | "offline";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  sector_id: string | null;
  is_active: boolean;
  presence?: PresenceStatus;
}

export interface Sector {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface AdminStats {
  users: number;
  sectors: number;
  conversations: number;
  messages: number;
  attachments: number;
}

export interface Conversation {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  sector_id: string | null;
  peer_id: string | null;
}

export interface Message {
  id: string;
  seq: number;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface Attachment {
  id: string;
  message_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

export interface ConversationSummary {
  conversation: Conversation;
  unread_count: number;
  last_message: Message | null;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface Tokens {
  access: string;
  refresh: string;
}
