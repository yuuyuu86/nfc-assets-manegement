# ShareShelf — 学校・寮の共有備品管理プロトタイプ

React + TypeScript + Vite / Cloudflare Workers + Hono / D1 / Tailwind CSS + 独自CSS / Lucide React。
学生が必要なときに共有備品を使えるようにすることを目的としたデモです。

## 1. ローカルで起動（Mac / Windows / Linux）

Node.js 22.12以上とnpmを用意してください。ZIPを展開し、ターミナルで `equipment-manager` ディレクトリに移動します。

```bash
npm install
npm run db:local
npm run dev
```

表示されるURL（通常は http://localhost:5173 ）を開きます。Cloudflareアカウントはローカル起動では不要です。D1のローカルDBは `.wrangler/` に保存されます。初期マイグレーションにデモ学生2名、管理者1名、6種類13個の備品が含まれます。

- `npm run build`: 型チェックと本番ビルド
- `npm run test:db`: Python 3が必要。SQLiteのデータベース制約をテスト
- ローカルデータを初期化するには開発サーバーを停止し、プロジェクト内の `.wrangler/state` を削除した後 `npm run db:local` を実行（記録は消えます）

## 2. 動作の確認手順

1. デモ学生 A でログイン状態にする（ヘッダーのアカウント選択）。
2. 備品検索 → バスケットボール → 個体ごとの空き状況を確認。
3. 「貸出・返却端末」→ 学生証を読み取る（デモ）→ バスケットボール・#01 を選択 → タグ読み取り → 返却日時 → 貸出確定。
4. デモ学生 B に切り替え、同じ備品の空き数が減っていることを確認。ほかの個体を予約するか、貸出中の個体の返却予定より後を予約する。重複する時間帯は拒否される。
5. Bでバスケットボールの空き通知を登録。Aに戻し、端末の返却タブから同じ個体を返却。Bの通知画面を確認。
6. Aで借りた備品を返却するときに故障報告を記入すると、その備品は修理中になります。
7. デモ管理者に切り替えて、管理ダッシュボードで備品登録、個体状態変更、利用回数、報告、貸出CSV（直近200件）を確認。

## 3. Cloudflareに公開（デモ用）

```bash
npx wrangler login
npx wrangler d1 create equipment-manager
```

出力の `database_id` を `wrangler.jsonc` のダミーUUID `00000000-0000-0000-0000-000000000000` と置き換えてください。作成時に設定ファイルの更新を提案された場合は既存の設定を確認してから適用します。

```bash
npm run db:remote
npm run deploy
```

デプロイ出力のURLを開きます。Cronは5分ごとに動きます。ローカルでは画面を更新したときにもリマインド・失効処理が実行されます。実際の学校データは使用しないでください。

**重要：このアプリの認証はデモ専用です。** `X-Demo-User` ヘッダーでアカウントを切り替える設計のため、誰でもデモ管理者になれます。実運用では学校SSO等のセッション認証、端末認証、監査ログ、データ保護、管理者権限を実装する必要があります。公開デモを共有する場合は架空データだけを使用し、必要ならCloudflare Accessなどで閲覧範囲を制限してください。`DEMO_MODE=false` にするとAPIはすべて無効になります（本番認証が自動で有効になるわけではありません）。

## 4. 実装範囲

- 学生：ホーム、備品検索、個体別状態、将来の予約一覧、予約作成・取消、マイページ、貸出履歴、アプリ内通知、返却時の空き通知。
- 貸出端末：仮想学生証、仮想備品タグ、貸出・返却、返却予定設定、返却時の故障報告。
- 管理者：備品登録、個体状態変更・廃止、貸出中・期限超過・利用回数・報告確認、CSV出力。
- API：D1の永続化、SQLトリガーと一意制約による重複防止、返却処理のバッチ、Cron通知、デモ権限チェック。
- 予約：個体を指定、30日以内、最大8時間、開始15分後または終了時点で未利用なら失効。貸出は最大8時間。予約済みの個体は開始後15分以内かつ予定終了までに返却予定を設定すると予約を消化できます。貸出中の個体については予定返却後に予約可能ですが、実際の返却が遅れる可能性はあります。
- 通知はアプリ内のみ。端末へのプッシュ通知ではありません。空き通知は正常返却時に利用可能になった個体を対象とします。

### 今後の追加項目

本物のNFCリーダー・学生証、実QR読み取り、学校認証、PWA/オフライン、複数備品の一括貸出、予約変更（現在は取消して再予約）、画像アップロード、備品基本情報の編集、管理者による貸出記録訂正、予約キャンセル通知、空き通知の追加条件、通知の詳細設定。UIはTailwindと独自CSSで実装しておりshadcn/uiは未導入です。

## 5. ファイル構成

```
equipment-manager/
├── src/main.tsx             React画面とAPIクライアント
├── src/style.css            レスポンシブUI
├── worker/index.ts          Hono API・Cron
├── migrations/0001_schema.sql  テーブルと制約
├── migrations/0002_demo.sql    初期デモデータ
├── tests/test_db.py         SQLite制約テスト
├── wrangler.jsonc           Workers / D1設定
├── vite.config.ts           Vite設定
├── package.json
└── README.md
```

## 6. 確認状況

作成環境ではSQLiteのテスト12件が成功。TypeScriptの構文チェックも成功しました。npmレジストリの名前解決に失敗したため、依存関係のインストール、完全な型チェック、Viteビルド、実際のブラウザ・Workers上での統合テストは未実施です。

公式資料：https://developers.cloudflare.com/workers/framework-guides/web-apps/react/ ／ https://developers.cloudflare.com/d1/worker-api/d1-database/

## v0.2: 実機 NFC リーダー接続

既存のデモ読み取りに加え、USB キーボード入力型（HID keyboard wedge）および PC/SC の UID 読み取りに対応しました。学生証・備品タグは管理者が事前に紐づけます。学校の許可を得た検証用カードだけを使用してください。

### 既存ユーザーのアップデート

`npm install` の後、`npm run db:local` を実行して `0003_nfc.sql` を適用してください。Cloudflare 上では `npm run db:remote` の後 `npm run deploy` を実行してください。既存の貸出・予約データは消去しません。

### USB キーボード入力型（16進数 UID 出力）

1. リーダーを USB 接続し、テキストエディタでタグをかざすと UID が入力されることを確認します。
2. 管理ダッシュボードの「NFCタグ登録」で学生または備品を選択します。
3. 接続方式を「USB キーボード入力型」にし、読み取り欄を選択してカードをかざします。Enter 終端のリーダーは自動照合し、終端がない機種は「UIDを確認」を押します。
4. 学生と各備品を登録後、貸出・返却端末で学生証→備品タグの順に読み取ります。

UID は大文字16進数・偶数桁（2〜64桁）で管理し、空白・コロン・ハイフンを除去します。10進数変換、逆順、固定長補完、独自プレフィックスなどを使用するリーダーは、出力形式を確認して同一方式で登録・照合してください。PC/SC の生 UID とキーボードリーダーの独自変換された番号は互換とは限りません。

### USB PC/SC（例: ACR122U 系の UID 取得対応リーダー）

Mac / Windows / Linux で、OS が認識する PC/SC リーダーと Python 3 を用意します。必要に応じてメーカーのドライバーを導入してください。Linux は pcscd、libpcsclite-dev、swig 等が必要な場合があります。macOS でも pyscard のビルドに Xcode Command Line Tools / swig が必要な場合があります。

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r nfc/requirements.txt
python nfc/bridge.py --backend pcsc --list
python nfc/bridge.py --backend pcsc
```

Windows PowerShell では仮想環境の Python を直接利用できます：

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r nfc/requirements.txt
.venv\Scripts\python.exe nfc/bridge.py --backend pcsc --list
.venv\Scripts\python.exe nfc/bridge.py --backend pcsc
```

複数のリーダーがあるときは `--reader ACR122` のように、一覧にある名前の一部分を指定します。一意に絞ってください。

別ターミナルで `npm run dev` を起動し、Chrome で `http://localhost:5173` を開きます。管理者画面または貸出端末で「USB PC/SC」を選択し、ブリッジに表示された接続トークンを入力し、「接続して読み取る」を押します。「接続済み」が表示されてからカードをかざしてください。学生証の読み取り後は一度カードを離し、次の読み取りステップで再度「接続して読み取る」を押して備品タグをかざします。ブリッジは保持されたカードの連続読み取りを抑止し、ブラウザーは接続前のイベントを無視します。

Cloudflare にデプロイした Web アプリから接続する場合は、実際の URL のオリジンを明示してブリッジを起動してください（末尾スラッシュなし）。

```sh
python nfc/bridge.py --backend pcsc --origin https://YOUR-APP.YOUR-SUBDOMAIN.workers.dev
```

Chrome のローカルネットワークへのアクセス許可が表示されたら、信頼できる自分のアプリであることを確認して許可します。ブラウザーのバージョン・管理ポリシーによってはクラウドサイトからのループバック接続が制限されます。その場合は localhost で貸出端末を使用するかキーボード入力型を利用してください。ブリッジは 127.0.0.1:8765 のみにバインドし、許可オリジンと起動ごとのランダムトークンを照合します。トークンはブラウザーのセッション内だけに保存されます。ブリッジを外部に公開しないでください。

### 制限と検証

- PC/SC は読み取り専用の UID 取得コマンド（FF CA 00 00 00）を利用します。全機種・全カード規格の動作を保証するものではありません。FeliCa / PaSoRi 等は別の読み取り方法が必要な場合があります。
- UID は識別子であって本人認証ではありません。現状のデモ認証は自由にユーザーを切り替えられるため、本物の学生証の登録や一般公開・学校運用には使わないでください。本番には学校の認証、端末の認証、アクセス制御等が必要です。
- NFC 読み取りで自動的に貸出確定はしません。対象の照合後に利用者が確認し、既存の貸出・返却 API で確定します。
- 実機・ブラウザー・本番ビルドは未検証です。SQLite 制約とブリッジのアクセス制御についてはテスト済みです。

```sh
python3 -m unittest discover -s tests -v
```

## v0.3: SONY PaSoRi RC-S330 (macOS / FeliCa)

RC-S330 は nfcpy の対応機種（USB VID:PID `054c:02e1`）です。PC/SC ではなく nfcpy + libusb で直接 USB 通信し、NFC-F の Polling 応答から IDm 8バイトを取得します。カード内のデータを読み出したり、書き換えたりしません。備品にも FeliCa / NFC-F 対応の検証用タグを使用してください。このモードは一般的な NFC-A (NTAG 等) を読み取りません。

### Mac でのセットアップ

```sh
brew install libusb
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r nfc/requirements-pasori.txt
python nfc/bridge.py --backend pasori --list
python nfc/bridge.py --backend pasori
```

別のターミナルで `npm install`、`npm run db:local`、`npm run dev` を実行し、Chrome で http://localhost:5173 を開きます。「SONY PaSoRi / PC/SC（ローカルブリッジ）」を選び、表示されたトークンを入力します。管理者画面で検証用の学生証と備品タグを登録後、貸出端末で学生証→備品タグ→確定の順で操作します。各読み取りの前に接続ボタンを押し、接続表示後にカードをかざし、読み取ったら離してください。

USB が認識されない場合は `system_profiler SPUSBDataType` で確認し、他の NFC アプリを終了、USB ハブを外して再接続してください。`python -m nfc` で nfcpy の認識を診断できます（ブリッジを停止してから実行）。macOS は nfcpy の公式テスト対象外のため、現行 Apple Silicon 環境での実機動作は保証できません。セキュリティ設定を無効化する必要はありません。

従来の PC/SC 利用時は `python nfc/bridge.py --backend pcsc`（一覧は `--backend pcsc --list`）と指定してください。v0.3 では既定のバックエンドが PaSoRi に変わりました。Cloudflare で利用する際は `--origin https://実際のホスト名` も指定します。NFC 用 D1 スキーマの追加変更はありません。

IDm は UID 欄に大文字16桁で保存します。実際の学生証を登録する前に学校の許可と本番認証が必要です。現状は架空の学生アカウントと検証用カードでのみ試してください。

参考: https://nfcpy.readthedocs.io/en/latest/overview.html / https://nfcpy.readthedocs.io/en/latest/modules/clf.html
