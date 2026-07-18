export interface WhatsappAiReadyResult {
  mode?: string;
  wppReady?: boolean;
  wppError?: string;
}

export interface WhatsappAiChat {
  snsId?: string;
  snsNickname?: string;
  snsAvatar?: string;
  isGroup?: boolean;
  groupId?: string;
  [key: string]: unknown;
}

export interface WhatsappAiMessage {
  type?: string;
  body?: string | { caption?: string; [key: string]: unknown };
  send_type?: 1 | 2;
  send_time?: string | number;
  message_id?: string;
  send_id?: string;
  [key: string]: unknown;
}

export interface GetMessagesOptions {
  includeMedia?: boolean;
}

export type NewMessageCallback = (message: WhatsappAiMessage) => void;

export interface WhatsappAiSdk {
  ready(): Promise<WhatsappAiReadyResult>;
  getActiveChat(): Promise<WhatsappAiChat | null>;
  getMessages(limit?: number, options?: GetMessagesOptions): Promise<WhatsappAiMessage[]>;
  getMeId(): Promise<string | null>;
  getInputContent(): Promise<string>;
  getAudioBlobUrl(dataId: string): Promise<string | null>;
  revokeAudioBlobUrl(url: string): Promise<boolean>;
  fillInput(text: string, replace?: boolean): Promise<unknown>;
  sendReply(text: string): Promise<unknown>;
  loadMoreHistory(count?: number): Promise<unknown>;
  onNewMessage(callback: NewMessageCallback): () => void;
}

declare global {
  interface Window {
    WhatsappAI?: WhatsappAiSdk;
  }
}

export {};
