import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
// Tests don't wait for the client to finish typing (the wait has its own test).
process.env.AGENT_REPLY_DELAY_SECONDS ??= "0";
