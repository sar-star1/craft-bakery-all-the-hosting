// Sample clients/conversations/drafts for testing the Clients and Pending
// Replies views before Supabase and the Telegram bot are wired up. Shapes
// match the real tables exactly (see supabase/schema.sql).
import type { Client, Conversation, PendingReply } from "./types";

export const mockClients: Client[] = [
  {
    id: "client_1",
    business_name: "Corner Cafe Kyiv",
    contact_name: "Ірина Сидоренко",
    telegram_chat_id: "100000001",
    status: "active",
    pipeline_stage: "recurring",
    standing_order_notes: "Круасани, 200 шт на тиждень, доставка вт/пт.",
    last_contact_at: "2026-09-17T09:00:00Z",
    last_order_at: "2026-08-19T10:00:00Z",
    source: "manual_migration",
    created_at: "2026-01-10T10:00:00Z",
  },
  {
    id: "client_2",
    business_name: "Lviv Hotel Group",
    contact_name: "Тарас Мельник",
    telegram_chat_id: "100000002",
    status: "engaged",
    pipeline_stage: "recurring",
    standing_order_notes: "Асорті випічки на сніданок, 80 шт, щопонеділка.",
    last_contact_at: "2026-08-30T08:00:00Z",
    last_order_at: "2026-08-16T10:00:00Z",
    source: "website_form",
    created_at: "2026-02-02T10:00:00Z",
  },
  {
    id: "client_3",
    business_name: "Fresh Mart Kyiv",
    contact_name: "Оксана Гриценко",
    telegram_chat_id: null,
    status: "dormant",
    pipeline_stage: "dormant",
    standing_order_notes: "Стандартизована лінійка, 12 SKU, щотижня.",
    last_contact_at: "2026-08-15T10:00:00Z",
    last_order_at: "2026-08-15T10:00:00Z",
    source: "manual_migration",
    created_at: "2026-01-20T10:00:00Z",
  },
  {
    id: "client_4",
    business_name: "Sunny Side Cafe",
    contact_name: "Максим Бойко",
    telegram_chat_id: "100000004",
    status: "engaged",
    pipeline_stage: "qualifying",
    standing_order_notes: null,
    last_contact_at: "2026-09-20T14:00:00Z",
    last_order_at: null,
    source: "instagram",
    created_at: "2026-09-19T10:00:00Z",
  },
  {
    id: "client_5",
    business_name: "Kyiv Book Cafe",
    contact_name: "Дарина Ткач",
    telegram_chat_id: "100000005",
    status: "engaged",
    pipeline_stage: "menu_sent",
    standing_order_notes: null,
    last_contact_at: "2026-09-19T11:00:00Z",
    last_order_at: null,
    source: "website_form",
    created_at: "2026-09-18T09:00:00Z",
  },
];

export const mockConversations: Conversation[] = [
  {
    id: "conv_1",
    client_id: "client_1",
    captured_fields: { requested_quantity: 250, previous_quantity: 200 },
    status: "confirming",
    last_message_at: "2026-09-17T09:00:00Z",
  },
  {
    id: "conv_2",
    client_id: "client_2",
    captured_fields: {},
    status: "committed",
    last_message_at: "2026-08-30T08:00:00Z",
  },
  {
    id: "conv_3",
    client_id: "client_3",
    captured_fields: {},
    status: "abandoned",
    last_message_at: "2026-08-15T10:00:00Z",
  },
];

export const mockPendingReplies: PendingReply[] = [
  {
    id: "reply_1",
    client_id: "client_1",
    conversation_id: "conv_1",
    draft_text:
      "Доброго дня! Так, з наступного тижня можемо робити 250 круасанів замість 200. Підтверджуємо доставку вт/пт як зазвичай.",
    reply_type: "order_flow",
    status: "awaiting_approval",
    created_at: "2026-09-17T09:01:00Z",
  },
  {
    id: "reply_2",
    client_id: "client_3",
    conversation_id: "conv_3",
    draft_text:
      "Доброго дня! Давно не було замовлень від Fresh Mart Kyiv по стандартизованій лінійці — чи актуально ще щотижневе постачання?",
    reply_type: "remarketing",
    status: "awaiting_approval",
    created_at: "2026-09-16T08:00:00Z",
  },
  {
    id: "reply_3",
    client_id: "client_2",
    conversation_id: "conv_2",
    draft_text:
      "Доброго дня! Нагадуємо про щопонеділкове замовлення асорті випічки — підтвердити на цей тиждень?",
    reply_type: "weekly_reminder",
    status: "approved_sent",
    created_at: "2026-09-14T07:00:00Z",
  },
];
