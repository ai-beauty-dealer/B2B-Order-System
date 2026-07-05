# 発注サイト PWA化 設計図

作成日: 2026-07-04
状態: **設計のみ・未実装（GOサイン待ち）**
目的: サロン様がスマホ「ホーム画面のアイコンから1タップ」で発注画面へ。開くまでの摩擦をゼロにする。
対象: 発注サイト（GitHub Pages）。**GAS（受注処理）は一切触らない**。

---

## 1. 完成イメージ

- サロン様がスマホで一度「ホーム画面に追加」する
- 以後はアイコンをタップ → 全画面でアプリのように起動 → 「◯◯サロンとして続ける」を1タップ → 発注画面
- App Store不要・インストール不要・中身は今のサイトのまま

## 2. 追加する部品（すべてサイト側・追加のみ）

| ファイル | 役割 |
|---|---|
| `manifest.json`（新規） | アプリ名・アイコン・全画面表示の宣言 |
| `sw.js`（新規） | Service Worker。静的資産をキャッシュして起動を速く |
| `icon-192.png` / `icon-512.png`（新規） | ホーム画面アイコン（maskable対応） |
| `index.html`（追記） | manifestリンク・SW登録・iOS用metaタグ |
| `app.js`（追記） | 「続ける」再開UI・iOS向け追加案内・任意のインストールボタン |

## 3. 設計レビューで潰した罠（2周実施）

### 🔴 R-1【最重要】start_urlが ?dealer= を失う → 誤送信
- PWAは manifest の start_url で起動する。`?dealer=tanaka` を付けて追加しても、起動時にパラメータが消えて **default(ぶんちゃん)に繋がる**恐れ → 田中さんのサロンの注文がぶんちゃんのシートに混ざる大事故
- **対策**: dealerコードをlocalStorageに記憶し、config.jsを「①URLの?dealer ②無ければ記憶したdealer ③どちらも無ければdefault」の順で解決するよう改修。マルチディーラーが本番稼働した今、これは必須の前提

### 🔴 R-2【最重要】Service WorkerがGAS通信をキャッシュ → 注文が消える
- SWがscript.google.comへの通信をキャッシュすると、注文が送られない/古い履歴が出る/在庫が更新されない、という静かな事故になる
- **対策**: SWは**同origin（GitHub Pages）の静的資産だけ**を扱う。script.google.comは絶対に横取りしない（network-only）。データのキャッシュは既存のlocalStorage（version付き）に任せる＝二重管理しない

### 🔴 R-3【重要】古いバージョンに固定される罠
- SWがapp.js等を焼き付けると、こちらが修正をpushしても**古い版が出続ける**（今の `?v=` 方式もSWに横取りされると効かなくなる）
- **対策**: シェル（html/js/css）は **network-first＋キャッシュfallback**（オンラインなら常に最新、オフライン時だけキャッシュ）。ライブラリ・アイコンなど不変物だけ cache-first。キャッシュ名にバージョンを持たせ、SW有効化時に古いキャッシュを削除
- 補足: 開発が活発な今はnetwork-first、安定したらstale-while-revalidateへ移行を検討

### 🟡 R-4 iOSは自動インストール不可 → iPhone勢に何も出ない
- Android Chromeは `beforeinstallprompt` でインストールボタンを出せるが、**iOS Safariは非対応**。サロン様はiPhone/iPad多め
- **対策**: iOS判定 → 「共有ボタン → ホーム画面に追加」の**イラスト付き案内**を出す。Androidは自動プロンプト＋手動ボタン

### 🟡 R-5 共用iPadでの自動ログイン漏れ
- パスワードは全サロン共通(`actim`)。自動ログインだと端末を持つ人は誰でもそのサロンに入れる
- **【2026-07-04 ぶんちゃん決定】自動ログイン採用**（サロンごとに自分の端末を使う前提なので実害小・利便優先）。アイコン起動→即発注画面
- 実装の安全弁: ①起動時600msだけ「別のサロンでログインする」脱出リンクを出す ②ログアウトでセッション削除→次回は手動 ③自動ログインが認証失敗したらセッションを消して手動へ（無限ループ防止）

### 🟡 R-6 緊急停止（キルスイッチ）の用意
- 万一SWが不具合を起こすと、サロン様が古い版に固定されて動けなくなる可能性
- **対策**: いつでも「自身を登録解除する空のSW」をpushできるよう手順を用意。SW自体を最小限に保つ

### 🟢 R-7 その他の細部（レビュー2周目）
- manifestの `scope` を `/B2B-Order-System/` に合わせる（外すとSWがページを制御できない）
- 既存localStorageキャッシュ（b2b_items_cache等）とSWは棲み分け済み（R-2で担保）
- maskableアイコンにsafe zoneを確保（Androidの丸トリミング対策）
- localhostはSWが動く（https例外）ので、本番前にローカルで登録・更新挙動を確認できる
- 保存セッションがサーバー側と食い違ったとき（PW変更等）は、最初の通信失敗で素直に再ログイン画面へ

## 4. manifest.json（案）

```json
{
  "name": "AI Beauty Dealer 発注",
  "short_name": "発注",
  "start_url": ".",
  "scope": "/B2B-Order-System/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1e3a5f",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```
※ start_urlは相対。dealerの維持はlocalStorageフォールバック（R-1）で担保する。

## 5. Service Worker（方針）

```
インストール時: シェル資産をプリキャッシュ
fetch時:
  - script.google.com への通信 → 一切横取りしない（network-only）  ← R-2
  - index.html / app.js / config.js / style.css → network-first、失敗時cache  ← R-3
  - icon / html5-qrcode.min.js 等の不変物 → cache-first
activate時: 旧バージョンのキャッシュを削除
```

## 6. 実装フェーズ（GOが出たら）

1. アイコン生成（192/512、maskable）
2. manifest.json＋sw.js＋index.html追記（＋config.jsのdealerフォールバック=R-1）
3. app.jsに「続ける」再開UI＋iOS案内
4. **ローカル（localhost）でSW登録・更新・オフライン挙動を確認**
5. **最重要検証**: ?dealer=付きでホーム追加→起動してもdealerが維持されるか（R-1）
6. push → 本番で「普通に発注できる」を最優先確認 → 追加・起動・続ける の順に確認
7. 問題あれば即キルスイッチSWをpush（R-6）

## 7. 効果の見込み

- 起動摩擦の除去（業界事例: Flipkart CV+70%、Alibaba +76%）
- 「アプリがある」心理的定着 → 発注頻度・継続の向上
- GAS無変更のため受注が止まるリスクなし。リスクはサイト内に限定
