# VisionOne 🛰 — チーム型パーソナルエージェント プロトタイプ

**Instinct の「メッセンジャーらしい親密さ」** と **GrokBot の「チーム・クッキーログイン・強力な Computer Use」** の中間を目指す、マルチチャネル・マルチエージェントの個人アシスタントプロトタイプ。Node.js 標準ライブラリのみで動作(依存ゼロ)。

## Instinct / GrokBot の課題への対応

| 課題 | visionone での実装 |
|---|---|
| Instinct: Messenger 以外から連絡できない | Gateway がエンベロープ形式に正規化 → WebChat / Console(動作) + Telegram / iMessage(アダプタ同梱) |
| Instinct: PC-Use が Claude/OpenCode に劣る | 自前実装せず `VISIONONE_PCUSE_CMD` で最強の PC-Use Skill を後段エンジン化(アダプタ点: `src/skills/computer-use.js`) |
| Instinct: 相手が一人しかいない | リーダー(Aki) + ワーカー(Sora/Ren)のチーム。@指名ルーティングとリーダーによる委任 |
| Instinct: 会話が1チャットのみ | スレッドごとに独立セッション(`src/store/session-store.js`)、UIでスレッド追加 |
| Instinct: リアクションの人間味 | Bot が受信メッセージに絵文字リアクションを返す(envelope の第一級概念) |
| GrokBot: クッキーで自動ログイン | `POST /api/cookies` でクッキー投入 → Bot はログイン誘導なしで処理(`src/skills/`) |
| GrokBot: チーム + 共有クラウドPC | 共有 SessionVault + ComputerUse エンジンを全 Bot で共用 |

## クイックスタート

```bash
npm start          # → http://127.0.0.1:8787
npm test           # node --test (9 tests)
```

Web UI で:
1. 「＋ 新しいスレッド」で複数会話を作れる
2. 「予約して / 調査して」でリーダー Aki が Sora / Ren に委任 → PC-Use が走る
3. `@Sora` `@Ren` で直接指名できる
4. メッセージにボタンでリアクションを付けられる
5. Cookie Login 欄に `host` + `k=v; k2=v2`(または JSON / cookies.txt)で自動ログイン登録
6. 会話とリアクションはスレッドごとに履歴保存(`.visionone-data/`)

## Webとして動かす

VisionOneは最初からWebアプリです(ブラウザUI + HTTP API)。3段階の動かし方:

**1. 手元で動かす(ローカル)**
```bash
npm start   # → http://127.0.0.1:8787
```

**2. 同じWi-Fiのスマホ・別PCから動かす(LAN公開)**
```bash
VISIONONE_HOST=0.0.0.0 npm start
# → http://<あなたのPCのIP>:8787 にアクセス
```
⚠ 注意: これで他の誰でもアクセスできるようになります。自宅Wi-Fiなど信頼できるネットワーク限定にすること。

**3. Dockerで動かす(サーバー/クラウド)**
```bash
docker build -t visionone .
docker run -p 8787:8787 -v visionone-data:/app/.visionone-data visionone
# → http://localhost:8787
```
データ(会話・クッキー)は `.visionone-data/` に保存されるので、ボリュームマウントすればコンテナ再起動でも消えません。

**4. クラウドに置いてどこからでもアクセスする(Render / Railway / Fly.io)**

設定ファイル(render.yaml / railway.json / fly.toml)は同梱済み。最有力のRenderでの手順:

1. [render.com](https://render.com) にサインアップ(GitHubアカウントでOK)
2. ダッシュボードで **New + → Blueprint** を選び、`VisionOne-Beta` リポジトリを接続
   → `render.yaml` が自動で読まれる
3. 環境変数の入力を求められたら入力:
   - `VISIONONE_BASIC_USER` / `VISIONONE_BASIC_PASSWORD`: **必須。好きなIDとパスワード**(これがサイトの鍵になる)
   - `VISIONONE_LLM_URL` / `VISIONONE_LLM_API_KEY`: あれば(任意)
4. **Apply** → 数分でビルド&起動 → `https://visionone-beta-xxxx.onrender.com` のURLが発行される
5. URLを開く → ブラウザ標準のID/パスワード画面が出る → 入力するとチャットUIが使える

Railway / Fly.io は各ダッシュボード or CLI でリポジトリを接続するだけ(railway.json / fly.toml を同梱済み)。

**注意:**
- Renderなどの無料枠は**ディスクが一時的**(再デプロイで会話・クッキーが消える)。永続化したいなら(paid)ディスク追加 or Fly.io Volume `.visionone-data` をマウント
- クッキー(vault.json)を扱うため、**Basic認証なしで公開するのは絶対にしないこと**
- 常時動かしたいTelegram/iMessage連携は、常時起動のサーバー(クラウド or 家のMac)が必要

## アーキテクチャ

```
src/
  gateway/     チャネル層: envelope.js(正規化) / webchat / console / telegram / imessage(BlueBubbles)
  agents/      team.js(リーダー+ワーカー、@ルーティング、委任) / engine.js(Echo or OpenAI互換HTTP)
  skills/      computer-use.js(PC-Useエンジン) / cookie-login.js / vault.js(共有クッキー保管庫)
  store/       session-store.js(スレッド別セッション + 永続化)
web/           Messenger風チャットUI(スレッド・リアクション・チーム表示)
test/          node:test 9件
```

データフロー: `チャネル → envelope 正規化 → Team(ルーティング/委任) → PC-Use/応答エンジン → スレッド保存 → 各チャネルへ送出`

## 環境変数

| 変数 | 効果 |
|---|---|
| `VISIONONE_PORT` / `VISIONONE_HOST` | WebChat の待ち受け(既定 127.0.0.1:8787) |
| `VISIONONE_DATA_DIR` | スレッド/クッキー保存先(既定 `.visionone-data`) |
| `VISIONONE_CONSOLE=1` | ターミナル REPL チャネル有効化 |
| `VISIONONE_TELEGRAM_TOKEN` | Telegram ロングポーリング有効化 |
| `VISIONONE_BLUEBUBBLES_URL` / `VISIONONE_BLUEBUBBLES_PASSWORD` | iMessage(BlueBubbles)接続。`VISIONONE_HOOK=1` で webhook サーバ起動 |
| `VISIONONE_PCUSE_CMD` | 実PC-Useエンジン(stdin にタスクJSON、stdout に結果)。未設定なら scripted スタブ |
| `VISIONONE_LLM_URL` / `VISIONONE_LLM_API_KEY` / `VISIONONE_LLM_MODEL` | OpenAI互換 API で応答品質を上げる(未設定なら Echo エンジン) |
| `VISIONONE_BASIC_USER` / `VISIONONE_BASIC_PASSWORD` | 公開時にBasic認証を有効化(ブラウザにID/PW画面が出る)。未設定なら認証なし |

## HTTP API

- `GET /` — Web UI
- `GET /api/state` — チーム + 全スレッド
- `POST /api/messages` — `{threadId, text}` 送信
- `POST /api/react` — `{threadId, messageId, emoji}` リアクション
- `POST /api/cookies` — `{host, cookies}` クッキーログイン登録
- `POST /api/hooks/bluebubbles` — iMessage 受信 webhook(`VISIONONE_HOOK=1`)

## 実運用への拡張ポイント(MVPロードマップ)

1. **PC-Use 実エンジン接続**: `VISIONONE_PCUSE_CMD` に OpenCode / Claude Code の PC-Use Skill ラッパを指定し、永続 VM 上で実行
2. **チャネル拡張**: OpenClaw Gateway をチャネル背後に置けば LINE / Discord / Slack / Signal など 20+ チャネルを同一 envelope に統合可能
3. **絵文字リアクションの実チャネル対応**: Telegram `setMessageReaction`、BlueBubbles tapback 送出など `send()` の type:"reaction" 分岐に追加
4. **安全性**: 送信前プレビュー承認(`recipient + full body → yes`)を Team.emit 前に挿入するポリシーレイヤ
5. **委任の高度化**: keyword ルール → LLM function calling への差し替え(engine.js)

## セキュリティ注記

`vault.json` は 0600 で保存しますが、クッキーは機微な認証情報です。本番では KMS や OS キーチェーン、Bot ごとのスコープ分離を入れてください(現状は GrokBot と同様の「共有PC」モデルで、全 Bot がセッションを共用します)。
