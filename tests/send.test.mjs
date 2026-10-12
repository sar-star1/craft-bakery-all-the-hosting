import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54778";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
const tg = stubTelegram();
const srv = await start(54778);
const { check, done } = makeChecker();

tables.clients = [{ id: "cl-1", business_name: "Test Bakery", telegram_chat_id: "777" }];
tables.messages = [{ id: "m0", client_id: "cl-1", direction: "in", text: "Привіт, є акція?", created_at: new Date().toISOString() }];
tables.conversations = [{ id: "conv-1", client_id: "cl-1", captured_fields: {} }];
tables.pending_replies = [
  { id: "p-offer", client_id: "cl-1", conversation_id: null, draft_text: "Тижнева пропозиція!", reply_type: "seasonal_offer", status: "awaiting_approval", edited: false,
    attachments: [{ url: "https://x/storage/v1/object/public/campaign-files/promo.jpg", name: "promo.jpg", type: "image/jpeg" }, { url: "https://x/storage/v1/object/public/campaign-files/price.pdf", name: "price.pdf", type: "application/pdf" }] },
  { id: "p-chat", client_id: "cl-1", conversation_id: null, draft_text: "Так, є.", reply_type: "order_flow", status: "awaiting_approval", edited: false, attachments: [] },
  { id: "p-react", client_id: "cl-1", conversation_id: null, draft_text: "Дякуємо!", reply_type: "order_flow", status: "awaiting_approval", edited: false, attachments: [], reaction: "👍", reaction_message_id: 42 },
  { id: "p-summary", client_id: "cl-1", conversation_id: "conv-1", draft_text: "Підсумок: ...", reply_type: "order_flow", status: "awaiting_approval", edited: false, attachments: [], shows_summary: true },
];
tables.agent_examples = [];
tables.agent_events = [];

const { sendPendingReply } = await import("../lib/replies.ts");
let r = await sendPendingReply("p-offer");
check("campaign draft is sent", r.ok === true, JSON.stringify(r));
check("text first, then photo, then document", tg.map((c) => c.method).join(",") === "sendMessage,sendPhoto,sendDocument", tg.map((c) => c.method).join(","));
check("jpeg goes as a photo by URL, pdf as a document", tg[1]?.body.photo?.endsWith("promo.jpg") && tg[2]?.body.document?.endsWith("price.pdf"));
check("files logged to the conversation", tables.messages.filter((m) => m.direction === "out" && m.text.startsWith("📎")).length === 2);
check("campaign messages are not recorded as style examples", tables.agent_examples.length === 0);
r = await sendPendingReply("p-offer");
check("a second approve is refused (no double send)", r.ok === false && r.alreadyHandled === true && tg.length === 3);
r = await sendPendingReply("p-chat");
check("a normal reply becomes a style example with the client's message", tables.agent_examples.length === 1 && tables.agent_examples[0].client_message === "Привіт, є акція?" && tables.agent_examples[0].quality === "approved");

tg.length = 0;
await sendPendingReply("p-react");
check("held reply: reaction first (on the client's message), then the text", tg[0]?.method === "setMessageReaction" && tg[0].body.message_id === 42 && tg[0].body.chat_id === "777" && tg[0].body.reaction[0].emoji === "👍" && tg[1]?.method === "sendMessage", JSON.stringify(tg));
check("the reaction outcome is logged", tables.agent_events.some((e) => e.kind === "reaction" && e.detail.ok === true && e.detail.emoji === "👍"), JSON.stringify(tables.agent_events));

// the message holding an order summary is remembered, so a 👍 on it can approve the order
tables.conversations[0].captured_fields = { draft_order: { lines: [], summary_at_inbound: 2 } };
tg.length = 0;
await sendPendingReply("p-summary");
const sentId = 900 + tg.findIndex((c) => c.method === "sendMessage") + 1;
check("approving a held summary records its Telegram message id", tables.conversations[0].captured_fields.draft_order.summary_message_id === sentId, JSON.stringify(tables.conversations[0].captured_fields));

tg.length = 0;
const { announceNewOrder } = await import("../lib/orders.ts");
await announceNewOrder({ orderId: "o1", origin: "чату", venueName: "Кав'ярня Лагідна", fop: "ФОП Коваленко І. П.", address: "Київ, вул. Хрещатик 10", paymentMethod: "cashless", total: 1974, deliveryFee: 250, summary: "Наполеон ×1, Еклер ×6", needsReview: false, approvalNote: "клієнт підтвердив текстом" });
const text = tg[0]?.body.text ?? "";
check("group alert shows назва, ФОП, адреса, оплата", ["Назва: Кав'ярня Лагідна", "ФОП: ФОП Коваленко І. П.", "Адреса: Київ, вул. Хрещатик 10", "Оплата: Безготівка"].every((l) => text.includes(l)), text);
check("alert shows the total with delivery, how it was approved, and a confirm button", text.includes("1974") && text.includes("з доставкою 250") && /Підтвердження: клієнт підтвердив текстом/.test(text) && tg[0].body.reply_markup.inline_keyboard[0][0].callback_data === "os:o1:new", text);

const { runTool } = await import("../lib/agent/tools.ts");
const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const tctx = { supabase: null, client: { id: "cl-1", business_name: "T", pipeline_stage: "in_conversation" }, conversationId: "c", flags, inboundCount: 1 };
let rr = await runTool("react_to_message", { emoji: "🙏" }, tctx);
check("tool records an allowed reaction and tells the agent to still reply", flags.reaction === "🙏" && /normal reply/.test(rr), rr);
rr = await runTool("react_to_message", { emoji: "🖕" }, tctx);
check("a disallowed emoji is refused and does not replace the choice", rr.startsWith("Not allowed") && flags.reaction === "🙏", rr);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
