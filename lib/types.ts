export type OrderSource = "website_form" | "telegram" | "manual";
export type OrderStatus =
  | "pending_review"
  | "new"
  | "confirmed"
  | "in_progress"
  | "ready"
  | "completed";
export type DepositStatus = "paid" | "pending" | "n/a";

export interface OrderLine {
  name: string;
  category: string;
  qty: number;
  unit_price: number;
  subtotal: number;
}

// Free-form for manual entries ({ notes }); website orders also carry the
// itemised cart and delivery/contact details here.
export interface OrderDetails {
  notes?: string;
  items?: OrderLine[];
  address?: string;
  email?: string;
  phone?: string;
  // Whether the order form carried a personal-link token (diagnostic only).
  ref_received?: boolean;
}

export interface Order {
  id: string;
  client_id: string | null;
  source: OrderSource;
  customer_name: string;
  customer_contact: string | null;
  item_summary_uk: string;
  item_summary_en: string | null;
  item_details_uk: OrderDetails | null;
  item_details_en: OrderDetails | null;
  status: OrderStatus;
  deposit_status: DepositStatus;
  total_amount: number | null;
  due_date: string | null;
  raw_message: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_COLUMNS: OrderStatus[] = [
  "pending_review",
  "new",
  "confirmed",
  "in_progress",
  "ready",
  "completed",
];

export function nextStatus(status: OrderStatus): OrderStatus {
  const idx = STATUS_COLUMNS.indexOf(status);
  return idx < STATUS_COLUMNS.length - 1 ? STATUS_COLUMNS[idx + 1] : status;
}

export function prevStatus(status: OrderStatus): OrderStatus {
  const idx = STATUS_COLUMNS.indexOf(status);
  return idx > 0 ? STATUS_COLUMNS[idx - 1] : status;
}

export type ClientStatus = "active" | "engaged" | "dormant";
export type ClientSource = "instagram" | "website_form" | "manual_migration";
export type PipelineStage =
  | "new_lead"
  | "cold"
  | "warm"
  | "menu_sent"
  | "first_order"
  | "recurring"
  | "dormant";

export const PIPELINE_STAGES: PipelineStage[] = [
  "new_lead",
  "cold",
  "warm",
  "menu_sent",
  "first_order",
  "recurring",
  "dormant",
];

export interface Client {
  id: string;
  business_name: string;
  contact_name: string | null;
  telegram_chat_id: string | null;
  status: ClientStatus;
  pipeline_stage: PipelineStage;
  standing_order_notes: string | null;
  // What a not-yet-ordering lead is asking about (cold) or what is holding
  // them back (warm). Written by the agent, editable by admins.
  blocker_note: string | null;
  last_contact_at: string | null;
  last_order_at: string | null;
  source: ClientSource | null;
  created_at: string;
}

export type ConversationStatus = "gathering" | "confirming" | "committed" | "abandoned";

export interface Conversation {
  id: string;
  client_id: string | null;
  captured_fields: Record<string, unknown>;
  status: ConversationStatus;
  last_message_at: string;
}

export interface MassOrderFlag {
  id: string;
  client_id: string | null;
  conversation_id: string | null;
  matched_text: string | null;
  resolved: boolean;
  created_at: string;
}

export type PendingReplyType = "order_flow" | "weekly_reminder" | "remarketing" | "seasonal_offer";
export type PendingReplyStatus = "awaiting_approval" | "approved_sent" | "rejected";

export const PENDING_REPLY_TYPES: PendingReplyType[] = [
  "order_flow",
  "weekly_reminder",
  "remarketing",
  "seasonal_offer",
];

export interface PendingReply {
  id: string;
  client_id: string | null;
  conversation_id: string | null;
  draft_text: string;
  reply_type: PendingReplyType;
  status: PendingReplyStatus;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  name_uk: string;
  name_en: string | null;
  min_order: number;
  note_uk: string | null;
  note_en: string | null;
  sort_order: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_uk: string;
  name_en: string | null;
  description_uk: string | null;
  description_en: string | null;
  price: number;
  original_price: number | null;
  promo_label: string | null;
  weight: string | null;
  storage_note: string | null;
  badge: string | null;
  freezable: boolean;
  min_order_override: number | null;
  photo_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SiteContent {
  key: string;
  content_uk: string | null;
  content_en: string | null;
  content_json: unknown;
  updated_at: string;
}

export interface DeliveryTermsBlock {
  heading: string;
  lines: string[];
}

export interface PromoBannerContent {
  active: boolean;
  title: string;
  subtitle: string;
}

export interface CapacityRule {
  id: string;
  rule_type: string;
  value: string;
  notes: string | null;
}

export interface Message {
  id: string;
  client_id: string | null;
  conversation_id: string | null;
  direction: "in" | "out";
  text: string;
  telegram_message_id: number | null;
  created_at: string;
}
