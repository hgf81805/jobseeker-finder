# ポスト検索

Threads の日本語投稿から、転職を考えている本人のつぶやきを探す社内ツール。throk の API を使い、業者の書き込みと削除済みの投稿を除外する。

## 構成

- `public/`：画面（ログイン・検索）
- `netlify/functions/`：ログインと throk への中継 API（`/api/*`）
- `netlify.toml`：Netlify の設定
- `supabase/schema.sql`：Supabase に作るテーブル（SQL Editor に貼って実行）

## Netlify の環境変数

| 変数 | 内容 |
|---|---|
| `THROK_API_KEY` | throk の APIキー（developer.throk.ai で発行） |
| `LOGIN_HASH` | 許可するメールアドレスとパスワードの組のハッシュ |
| `LOGIN_SALT` | ハッシュのソルト（`jf-login-v1`） |
| `SESSION_SECRET` | ログイン Cookie の署名用のランダムな文字列 |
| `SUPABASE_URL` | Supabase の Project URL（任意。無ければ候補一覧と1日の上限は無効） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の service_role キー（サーバー専用。画面側には出さない） |
| `DAILY_CREDIT_LIMIT` | 1日（日本時間）に使えるクレジットの上限。省略時 500 |

`LOGIN_HASH` は `sha256("<LOGIN_SALT>|<小文字のメールアドレス>|<パスワード>")` の16進表記。

## Supabase に記録するもの

- `candidates`：表示した投稿と進み具合（未対応・声かけ済・返信あり・面談・成約・対象外・業者）とメモ
- `authors`：投稿者。業者フラグが付いた人は次の検索から外す
- `searches`：検索の履歴（条件・件数・使ったクレジット）
- `usage_log`：外部APIの呼び出しごとの使用量。1日の上限の判定に使う
