import { createServer } from "node:http";
import { SessionStore } from "./store/session-store.js";
import { HttpEngine } from "./agents/engine.js";
import { Team } from "./agents/team.js";
import { WebChatChannel } from "./gateway/webchat.js";
import { ConsoleChannel } from "./gateway/console.js";
import { TelegramChannel } from "./gateway/telegram.js";
import { IMessageChannel } from "./gateway/imessage.js";

// 起動構成:
//   リーダー: Aki (チーフ・オブ・スタッフ)
//   ワーカー: Sora (リサーチ係) / Ren (手配係)
// チャネル: WebChat(常時) / console(VISIONONE_CONSOLE=1) /
//           telegram(VISIONONE_TELEGRAM_TOKEN) / imessage(VISIONONE_BLUEBUBBLES_URL+PASSWORD)

const PORT = Number(process.env.VISIONONE_PORT ?? 8787);
const HOST = process.env.VISIONONE_HOST ?? "127.0.0.1";
const DATA_DIR = process.env.VISIONONE_DATA_DIR ?? ".visionone-data";

const store = new SessionStore(DATA_DIR);
const engine = new HttpEngine();
const personas = {
  leader: { name: "Aki", role: "リーダー (Chief of Staff)", emoji: "\u{1F9E0}" },
  workers: [
    { name: "Sora", role: "リサーチ係", emoji: "\u{1F50D}" },
    { name: "Ren", role: "手配係", emoji: "\u{1F4C5}" },
  ],
};

const team = await Team.create({ store, engine, personas, dataDir: DATA_DIR });

const channels = [];
const relayChannels = [];

async function onEnvelope(envelope) {
  await team.handle(envelope);
}

team.onOutbound = (outbound) => {
  for (const ch of relayChannels) ch.send?.(outbound);
};

const webchat = new WebChatChannel({ team, store, port: PORT, host: HOST });
channels.push(webchat);

if (process.env.VISIONONE_CONSOLE === "1") {
  const consoleCh = new ConsoleChannel({ team, store });
  channels.push(consoleCh);
  relayChannels.push(consoleCh);
}

const telegram = new TelegramChannel({ team, onEnvelope });
channels.push(telegram);
relayChannels.push(telegram);

const imessage = new IMessageChannel({ team, onEnvelope });
channels.push(imessage);
relayChannels.push(imessage);
const handleBlueBubbles = imessage.webhookHandler();

for (const ch of channels) {
  const status = await ch.start();
  console.log(`[channel:${ch.name}] ${status}`);
}
console.log(`\nVisionOne ready -> http://${HOST}:${PORT}`);
console.log("cookie API: POST /api/cookies {host, cookies}");

// BlueBubbles からの受信 webhook 用の軽量サーバ(VISIONONE_HOOK=1 で起動)
export function webhookServer(port = Number(process.env.VISIONONE_HOOK_PORT ?? 8788)) {
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/hooks/bluebubbles") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try {
        await handleBlueBubbles(JSON.parse(raw));
        res.writeHead(200).end("ok");
      } catch {
        res.writeHead(400).end("bad request");
      }
      return;
    }
    res.writeHead(404).end();
  });
  return server.listen(port, HOST);
}

if (process.env.VISIONONE_HOOK === "1") {
  webhookServer();
  console.log(`[hooks] bluebubbles webhook on http://${HOST}:${process.env.VISIONONE_HOOK_PORT ?? 8788}/api/hooks/bluebubbles`);
}

process.on("SIGINT", async () => {
  for (const ch of channels) await ch.stop();
  process.exit(0);
});
