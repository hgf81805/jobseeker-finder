# ポスト検索

Threads の日本語投稿から、転職を考えている本人のつぶやきを探す社内ツール。throk の API を使い、業者の書き込みと削除済みの投稿を除外する。

## 構成

- `public/`：画面（ログイン・検索）
- `netlify/functions/`：ログインと throk への中継 API（`/api/*`）
- `netlify.toml`：Netlify の設定

## Netlify の環境変数

| 変数 | 内容 |
|---|---|
| `THROK_API_KEY` | throk の APIキー（developer.throk.ai で発行） |
| `LOGIN_HASH` | 許可するメールアドレスとパスワードの組のハッシュ |
| `LOGIN_SALT` | ハッシュのソルト（`jf-login-v1`） |
| `SESSION_SECRET` | ログイン Cookie の署名用のランダムな文字列 |

`LOGIN_HASH` は `sha256("<LOGIN_SALT>|<小文字のメールアドレス>|<パスワード>")` の16進表記。
