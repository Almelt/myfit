# MyFit

BurnFit 風の個人用筋トレ記録アプリ。ビルド不要のバニラ JS の PWA で、最終的に Android で自分専用アプリとして使う。
ユーザーとのやり取り・UI 文言・コメントはすべて日本語。

## 環境の前提
- Windows 11。**Node.js / npm / Python / Java / Flutter は未インストール**。npm パッケージ・バンドラ・TypeScript を前提にしない
- 使えるのは PowerShell 5.1、Git Bash、Microsoft Edge（headless でテストに使う）
- 外部ライブラリは使っていない（チャートも canvas で自前描画）。追加する場合は先にユーザーに相談する

## コマンド
```powershell
# 動作確認用サーバー（http://localhost:8080/）
powershell -ExecutionPolicy Bypass -File serve.ps1
# スモークテスト（headless Edge で主要フローを自動操作。終了コード 0=PASS / 1=FAIL）
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-smoke.ps1
```
コードを変更したら必ず `tests/run-smoke.ps1` を実行し、結果（PASS/FAIL と件数）を報告する。
新機能を足したら `tests/smoke.html` にもチェックを追加する。見た目の確認は Edge の `--screenshot`（`--window-size=390,844`）で撮って Read で見る。

## 構成
| ファイル | 役割 |
|---|---|
| `index.html` | 骨組み。scripts は **exercises → foods → store → plan → app の順**（app.js が末尾で `render()` を呼ぶため、依存先を先に読み込む） |
| `js/app.js` | 画面描画（`viewXxx()` が `{title, html, actions?, after?}` を返す）、操作（`actions` マップ）、チャート、休憩タイマー |
| `js/plan.js` | ルールベースの今日のおすすめ・目標カロリー/PFC・アドバイス |
| `js/store.js` | localStorage（キー `myfit.v1`）への保存。`normalize()` で既定値とマージ |
| `js/exercises.js` / `js/foods.js` | 種目・食品のマスタデータ |
| `sw.js` | オフライン用 Service Worker（ネット優先・3秒でキャッシュへ） |

### データモデル（`Store.data`）
`workouts[]`（`{id,date:'YYYY-MM-DD',start,end,title,memo,exercises:[{exId,sets:[{w,r,t,d,done}]}]}`）、`active`（進行中のワークアウト）、`routines[]`、`customExercises[]`（削除は `hidden:true`、過去記録のため消さない）、`body[]`（1日1件）、`meals[]`（kcal/PFC は数量を掛けた後の値）、`profile`、`settings`。
フィールドを追加したら `store.js` の `defaults()` と `normalize()` に入れる（古いバックアップの復元でも壊れないように）。

## 実装の決まりごと
- イベントは document への委譲。ボタンは `data-action="名前"` を付け、`actions` に処理を書く。入力は `input` / `change` リスナーで `data-*` 属性を見て分岐
- ユーザー入力を HTML に入れるときは必ず `esc()` を通す
- データを変えたら `Store.save()` → 必要なら `render()`。入力中の要素は再描画せず部分更新する（フォーカスが外れるため）
- 画面遷移は `goTo()` / `replaceScreen()` / `navBack()` を使う。Android の戻るボタン対応のため history と `ui.stack` を連動させている
  - シートやスクリーンを閉じるときは **`hideSheet()` を直接呼ばず `navBack()`**（popstate と二重に閉じてずれる）
- 日付は `'YYYY-MM-DD'` 文字列（ローカル時刻）。`dateStr()` / `parseDate()` / `addDays()` を使い、`toISOString()` は使わない（UTC にずれる）
- 検索はひらがな対応（`toKatakana()`）。漢字名の食品には `foods.js` で読みを付ける

## 落とし穴
- `js/` / `css/` / `index.html` を変えたら **`sw.js` の `CACHE` を上げる**（例 `myfit-v2` → `myfit-v3`）。新しいファイルは `ASSETS` にも追加
- トップレベルの `const` は `window` のプロパティにならない。テストで iframe から触るときは `w.eval('Store.data')` のように書く
- `.ps1` に日本語を書くときは **UTF-8（BOM 付き）** で保存する。BOM なしだと PowerShell 5.1 が誤読し、コメントの次の行が消えたように動く
- PowerShell で関数名 `R` などの 1 文字は既存エイリアスと衝突する
- `[hidden]` を CSS の `display` が上書きしないよう `[hidden]{display:none!important}` を置いている

## 方針・今後
- おすすめ・食事アドバイスは**ルールベース**（AI/API は使わない、とユーザーが決定済み）
- 次の大きなステップは **Android ネイティブ化（Capacitor 想定）**。その上で
  - アプリを閉じていても休憩終了を通知（ローカル通知。PWA では確実にできない）
  - Garmin 連携：Garmin Connect → ヘルスコネクト → アプリで歩数・睡眠・心拍・消費カロリーを読み、日次レポートに表示（Garmin 公式 API は企業向け審査制で個人利用は困難）
- git へのコミット・push はユーザーに頼まれたときだけ行う

## 公開（GitHub Pages）
- リポジトリ: https://github.com/Almelt/myfit （public、`main` ブランチのルートを公開）
- 公開URL: https://almelt.github.io/myfit/ （スマホはここからインストール）
- 更新手順: `sw.js` の `CACHE` を上げる → `tests/run-smoke.ps1` が PASS → コミット → `git push`。数分で反映される
- `gh` は PATH に入っていない場合があるので `& "$env:ProgramFiles\GitHub CLI\gh.exe"` で呼ぶ
- コミットの作者は非公開アドレス `258854664+Almelt@users.noreply.github.com`（個人のメールアドレスをコミットやファイルに入れない）
- PowerShell 5.1 では `git commit -F -` にヒアドキュメントを渡せない。メッセージはファイルに書いて `-F ファイル` で渡す
