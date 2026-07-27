#!/usr/bin/env python3
"""社員用スプレッドシートの初期化ツール（管理者用）。

ぶんちゃんの発注シートを「コピーを作成」した直後の状態を、
社員に渡せるクリーンな状態へ自動で整える：

1. 日付タブ（2026-07-15 等）・取込ログ・_ツール記録 を削除
2. ClientMaster をヘッダ＋master行だけに初期化
3. ItemMaster を空にして IMPORTRANGE（中央管理の鏡）を設定
4. 最後に残ったタブ一覧を表示（目視確認用）

--type invoice（納品書シート）では、00_変換マスタ を中央の納品書シートから
IMPORTRANGE で鏡にする（集約ルールは共通資産＝中央更新で全社員に自動同期）。
どちらも設定後、A1で「アクセスを許可」を1回押すまで #REF! のまま。

事前にコピーしたシートを SA に共有しておくこと：
  order-auto@my-project-hanbaikanri-488406.iam.gserviceaccount.com

使い方（統合ツールの venv で実行）:
  cd <統合ツール>
  ./venv/bin/python <このファイル> --sheet-id <コピーしたシートのID> --dry-run
  ./venv/bin/python <このファイル> --sheet-id <コピーしたシートのID>

※本番シートIDに対しては動かない（誤実行ガードあり）
"""

import argparse
import os
import re
import sys

TOOL_DIR = "/Users/bunchaca/product/2nd-Brain/02-company_knowledge/actim/03-Project/b2b-order-app/imported/自動入力ツール/統合ツール"
sys.path.insert(0, TOOL_DIR)

# 絶対に触ってはいけないシート（ぶんちゃんの本番）
PROTECTED_IDS = {
    "1dpMtNXhwRRPObS42bJ9BuGL4vMsOkYkQgyeTP1rG_i4",  # 発注
    "1CVHSWE0RvQpX07WWjXWlTjTX4TalxR_X-OXaZB6DQTo",  # 納品書
    "1T3SvZP6kcz8JNWpbriGUQ38vWh9AHnzsSZ_rt7KqXdQ",  # 欠品
}

MASTER_SHEET_ID = "1dpMtNXhwRRPObS42bJ9BuGL4vMsOkYkQgyeTP1rG_i4"
# 納品書シート（変換マスタの中央マスター）。00_変換マスタをここから鏡にする。
MASTER_INVOICE_SHEET_ID = "1CVHSWE0RvQpX07WWjXWlTjTX4TalxR_X-OXaZB6DQTo"

DATE_TAB = re.compile(r"^20\d{2}-\d{2}-\d{2}")

# 日付タブ以外で削除するタブ
# （ClientMaster_配布用＝ぶんちゃんの得意先ID一覧。社員には渡さない）
DELETE_TABS = {
    "_出荷PDF取込ログ",
    "_ツール記録",
    "ClientMaster_配布用",
}

# ヘッダー行だけ残してデータを空にするタブ
# （コピー元の作業データ・お気に入り・スキャンログ）
CLEAR_DATA_TABS = [
    "TmpNewItems",
    "TmpJAN",
    "UnknownJAN",
    "Favorites",
]

CLIENT_HEADER = [
    "ログインID", "パスワード", "得意先名", "発送区分",
    "発注曜日", "新規・グループ用", "得意先コード",
]
CLIENT_MASTER_ROW = [
    "master", "actim", "マスター", "マスター", "", "", "",
]

IMPORTRANGE_FORMULA = (
    f'=IMPORTRANGE("{MASTER_SHEET_ID}", "ItemMaster!A1:G")'
)

# 00_変換マスタも中央の鏡にする（統合ツールはA:C列＝変換前/集約コード/
# 集約後名のみ使用）。以後は中央を更新すれば全社員に自動反映される。
INVOICE_CONVERSION_TAB = "00_変換マスタ"
INVOICE_CONVERSION_IMPORTRANGE = (
    f'=IMPORTRANGE("{MASTER_INVOICE_SHEET_ID}", "00_変換マスタ!A:C")'
)

# 納品書シートモードでヘッダーだけ残すタブ
INVOICE_CLEAR_TABS = ["_納品日移動管理", "02_納品書データ"]

RESTORE_BACKUP_TAB = re.compile(r"^_修復前_")


def cleanup_invoice_sheet(client, spreadsheet, dry_run):
    """納品書シートのコピーを社員用に掃除する。

    - 日付タブ・_修復前_バックアップ → 削除
    - _納品日移動管理・02_納品書データ → ヘッダーだけ残す
    - 00_変換マスタ → IMPORTRANGE（中央の鏡）。集約ルールは共通資産で自動同期
    """
    worksheets = client.retry(spreadsheet.worksheets)

    targets = [
        ws for ws in worksheets
        if DATE_TAB.match(ws.title)
        or RESTORE_BACKUP_TAB.match(ws.title)
    ]

    print(f"削除するタブ: {len(targets)}枚")
    print("ヘッダーだけ残す: "
          + "・".join(INVOICE_CLEAR_TABS))
    print(f"IMPORTRANGEの鏡に: {INVOICE_CONVERSION_TAB}")

    if dry_run:
        rest = [
            ws.title for ws in worksheets
            if ws not in targets
        ]
        print(f"残るタブ: {rest}")
        print("--dry-run のため何も変更していない。")
        return

    titles = [ws.title for ws in worksheets]

    for tab_name in INVOICE_CLEAR_TABS:
        if tab_name not in titles:
            continue

        tab = client.retry(
            spreadsheet.worksheet, tab_name
        )
        header = client.retry(tab.row_values, 1)
        client.retry(tab.clear)

        if header:
            client.retry(
                tab.update,
                values=[header],
                range_name="A1",
                value_input_option="RAW",
            )

        print(f"  🧹 空化: {tab_name}")

    # 00_変換マスタ を中央の鏡に（clearしないとIMPORTRANGEがスピルできない）
    if INVOICE_CONVERSION_TAB in titles:
        conv = client.retry(
            spreadsheet.worksheet, INVOICE_CONVERSION_TAB
        )
        client.retry(conv.clear)
        client.retry(
            conv.update,
            values=[[INVOICE_CONVERSION_IMPORTRANGE]],
            range_name="A1",
            value_input_option="USER_ENTERED",
        )
        print(f"  🪞 IMPORTRANGE化: {INVOICE_CONVERSION_TAB}")

    for ws in targets:
        client.retry(spreadsheet.del_worksheet, ws)
        print(f"  🗑 削除: {ws.title}")

    remaining = [
        ws.title
        for ws in client.retry(spreadsheet.worksheets)
    ]
    print("\n✅ 掃除完了。残ったタブ:")
    for title in remaining:
        print(f"  ・{title}")

    print(
        "\n次にやること：\n"
        "1. 00_変換マスタのA1で「アクセスを許可」を1回押す"
        "（ぶんちゃんのブラウザでOK。押すまで #REF! のまま）\n"
        "   → 押すと中央の変換マスタが鏡になり、以後は自動同期"
    )


def main():
    parser = argparse.ArgumentParser(
        description="社員用スプレッドシートの初期化"
    )
    parser.add_argument("--sheet-id", required=True)
    parser.add_argument(
        "--type",
        choices=["order", "invoice"],
        default="order",
        help="order=発注シート（既定） / invoice=納品書シート",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="何をするか表示だけして、変更しない",
    )
    args = parser.parse_args()

    sheet_id = args.sheet_id.strip()

    if sheet_id in PROTECTED_IDS:
        sys.exit(
            "❌ これは本番シート。初期化できない。\n"
            "   コピーした社員用シートのIDを指定して。"
        )

    from core.sheets import SheetsClient

    client = SheetsClient()
    client.connect(
        os.path.join(TOOL_DIR, "credentials.json")
    )
    spreadsheet = client.open_spreadsheet(sheet_id)

    print(f"対象: {spreadsheet.title}")

    if args.type == "invoice":
        cleanup_invoice_sheet(
            client, spreadsheet, args.dry_run
        )
        return

    worksheets = client.retry(spreadsheet.worksheets)
    titles = [ws.title for ws in worksheets]

    targets = [
        ws for ws in worksheets
        if DATE_TAB.match(ws.title)
        or ws.title in DELETE_TABS
    ]

    print(f"削除するタブ: {len(targets)}枚")
    for ws in targets:
        print(f"  🗑 {ws.title}")

    print("初期化: ClientMaster（ヘッダ＋master行のみ）")
    print("初期化: ItemMaster（IMPORTRANGEの鏡に）")
    print(
        "データ空化（ヘッダのみ残す）: "
        + "・".join(CLEAR_DATA_TABS)
    )

    if args.dry_run:
        rest = [
            t for t in titles
            if t not in {ws.title for ws in targets}
        ]
        print(f"残るタブ: {rest}")
        print("--dry-run のため何も変更していない。")
        return

    # 全タブは削除できない仕様のため、先に初期化→後で削除
    client_ws = client.retry(
        spreadsheet.worksheet, "ClientMaster"
    )
    client.retry(client_ws.clear)
    client.retry(
        client_ws.update,
        values=[CLIENT_HEADER, CLIENT_MASTER_ROW],
        range_name="A1:G2",
        value_input_option="RAW",
    )

    item_ws = client.retry(
        spreadsheet.worksheet, "ItemMaster"
    )
    client.retry(item_ws.clear)
    client.retry(
        item_ws.update,
        values=[[IMPORTRANGE_FORMULA]],
        range_name="A1",
        value_input_option="USER_ENTERED",
    )

    for tab_name in CLEAR_DATA_TABS:
        if tab_name not in titles:
            continue

        tab = client.retry(
            spreadsheet.worksheet, tab_name
        )
        header = client.retry(tab.row_values, 1)
        client.retry(tab.clear)

        if header:
            client.retry(
                tab.update,
                values=[header],
                range_name="A1",
                value_input_option="RAW",
            )

        print(f"  🧹 空化: {tab_name}")

    for ws in targets:
        client.retry(spreadsheet.del_worksheet, ws)
        print(f"  🗑 削除: {ws.title}")

    remaining = [
        ws.title
        for ws in client.retry(spreadsheet.worksheets)
    ]
    print("\n✅ 初期化完了。残ったタブ:")
    for title in remaining:
        print(f"  ・{title}")

    print(
        "\n次にやること：\n"
        "1. ItemMasterのA1で「アクセスを許可」を1回押す"
        "（ぶんちゃんのブラウザでOK）\n"
        "2. GASエディタから「デプロイ→新しいデプロイ→"
        "ウェブアプリ」でURLを発行\n"
        "3. 社員のGoogleアカウントにシートを共有（編集者）\n"
        "4. AI秘書に scriptId / deploymentId / dealerコード"
        "を渡す（config.js追記と台帳登録をやる）"
    )


if __name__ == "__main__":
    main()
