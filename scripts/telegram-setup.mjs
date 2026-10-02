// Helper for wiring up the Telegram bot. Run with your env loaded:
//   node --env-file=.env.local scripts/telegram-setup.mjs <command> [arg]
//
//   me                  Verify the bot token and print the bot's @username
//   chats               List chats the bot has recently seen (use this to find
//                       the admin group's ID: add the bot to the group, send a
//                       message there, then run this)
//   webhook <https-url> Point Telegram at <https-url>/api/telegram/webhook
//   webhook-info        Show the current webhook and any delivery errors
//   webhook-delete      Remove the webhook (e.g. before switching hosts)

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Run with: node --env-file=.env.local scripts/telegram-setup.mjs <command>");
  process.exit(1);
}

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error(`Telegram error: ${json.description}`);
    process.exit(1);
  }
  return json.result;
};

const [command, arg] = process.argv.slice(2);

if (command === "me") {
  const me = await api("getMe");
  console.log(`Bot OK: @${me.username} (${me.first_name})`);
  console.log(`Put this in .env.local:  TELEGRAM_BOT_USERNAME=${me.username}`);
} else if (command === "chats") {
  const updates = await api("getUpdates");
  const chats = new Map();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat) chats.set(chat.id, chat);
  }
  if (chats.size === 0) console.log("No chats seen yet. Add the bot to the group and send a message there, then retry.");
  for (const chat of chats.values()) {
    console.log(`${chat.id}\t${chat.type}\t${chat.title ?? chat.username ?? chat.first_name ?? ""}`);
  }
  console.log("\nUse the group's id (negative number) as TELEGRAM_ADMIN_GROUP_ID.");
  console.log("Note: getUpdates returns nothing while a webhook is set — run webhook-delete first if needed.");
} else if (command === "webhook") {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!arg || !arg.startsWith("https://")) {
    console.error("Usage: webhook https://your-project.vercel.app");
    process.exit(1);
  }
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set.");
    process.exit(1);
  }
  const url = `${arg.replace(/\/$/, "")}/api/telegram/webhook`;
  await api("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  console.log(`Webhook set: ${url}`);
} else if (command === "webhook-info") {
  console.log(JSON.stringify(await api("getWebhookInfo"), null, 2));
} else if (command === "webhook-delete") {
  await api("deleteWebhook", { drop_pending_updates: true });
  console.log("Webhook removed.");
} else {
  console.log("Commands: me | chats | webhook <https-url> | webhook-info | webhook-delete");
}
