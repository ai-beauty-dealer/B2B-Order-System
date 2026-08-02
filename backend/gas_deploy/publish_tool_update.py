#!/usr/bin/env python3
"""統合ツールの更新を全社員へ配信する（管理者用）。

1コマンドで以下を全部やる：
1. クリーンなZIPを作成（venv・data.db・credentials等は除外）
2. デスクトップの配布セットへ保存（新規社員への手渡し用）
3. 業務データのない専用シートの「_ツール配信」へ書き込み
   → 各社員のツールが次回起動時（start.bat）に自動で更新される

使い方（統合ツールのvenvで実行）:
  ./venv/bin/python <このファイル>            # 配信
  ./venv/bin/python <このファイル> --dry-run  # 内容確認のみ

注意:
- start.bat だけは自動更新の対象外（実行中のバッチの上書きは危険）。
  変えたときは社員に新しいZIPを渡す必要がある
"""

import argparse
import ast
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile

TOOL_DIR = "/Users/bunchaca/product/2nd-Brain/02-company_knowledge/actim/03-Project/b2b-order-app/imported/自動入力ツール/統合ツール"
KIT_DIR = "/Users/bunchaca/Desktop/統合ツール_社員配布セット_最新"

CHANNEL_FILE = os.path.join(TOOL_DIR, "update_channel.json")
CHANNEL_TAB = "_ツール配信"

EXCLUDES = [
    "venv",
    "__pycache__",
    ".git",  # コミット履歴ごと社員へ渡さない
    "CLAUDE-SECURITY-*",  # 脆弱性レポートは配布物に含めない
    "logs",
    "backups",
    "reports",
    "credentials.json",
    "data.db",
    "data.db-wal",  # WAL/SHMも配布物に入れない（管理者の実データ漏洩防止）
    "data.db-shm",
    "config.json",
    "import_clients_from_pdf.py",
    "build_win.bat",  # 開発者用exeビルド。社員配布物に含めない
    "dist",  # build_win.bat の出力
    "package",  # build_win.bat の出力
    ".deps_installed",
    ".tool_version",
]

ZIP_ROOT = "B2B-OrderTool"
CHUNK_SIZE = 40000

SHEET_ID_KEYS = (
    "order_spreadsheet_id",
    "invoice_spreadsheet_id",
    "stockout_spreadsheet_id",
    "stock_spreadsheet_id",
    "archive_spreadsheet_id",
    "update_spreadsheet_id",
)

sys.path.insert(0, TOOL_DIR)


def normalize_spreadsheet_id(value):
    """Google SheetsのURLまたはIDからID部分だけを返す。"""
    value = str(value or "").strip()
    match = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", value)

    if match:
        value = match.group(1)

    if not re.fullmatch(r"[A-Za-z0-9_-]{20,}", value):
        raise ValueError("更新配信シートのURLまたはIDが不正")

    return value


def save_update_channel(value):
    """共通配信シートIDを社員配布用設定に保存する。"""
    spreadsheet_id = normalize_spreadsheet_id(value)

    with open(CHANNEL_FILE, "w", encoding="utf-8") as file:
        json.dump(
            {"spreadsheet_id": spreadsheet_id},
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")

    return spreadsheet_id


def load_update_channel():
    """共通配信シートIDを読む。"""
    try:
        with open(CHANNEL_FILE, encoding="utf-8") as file:
            value = json.load(file).get("spreadsheet_id", "")
    except (OSError, json.JSONDecodeError, AttributeError):
        value = ""

    if not str(value).strip():
        raise RuntimeError(
            "update_channel.jsonが未設定。"
            " --sheetに専用シートのURLを指定する"
        )

    return normalize_spreadsheet_id(value)


def validate_distribution_defaults():
    """配布コードに管理者固有設定が混入していないか検査。"""
    from core.config import (
        DEFAULT_CONFIG,
        DEFAULT_SHARED_CODES,
        parse_code_list,
    )

    populated = [
        key for key in SHEET_ID_KEYS
        if str(DEFAULT_CONFIG.get(key, "")).strip()
    ]

    if populated:
        joined = "・".join(populated)
        raise RuntimeError(
            "配布用DEFAULT_CONFIGにシートIDが残っている: "
            f"{joined}"
        )

    for key in ("no_merge_codes", "manual_input_codes"):
        actual = set(parse_code_list(DEFAULT_CONFIG.get(key, [])))

        if actual != set(DEFAULT_SHARED_CODES):
            raise RuntimeError(
                f"配布用{key}が共通初期値と一致しない"
            )

    if str(DEFAULT_CONFIG.get("credentials_file", "")).strip():
        raise RuntimeError(
            "配布用DEFAULT_CONFIGの認証ファイル欄が"
            "空ではない"
        )


def load_protected_sheet_ids():
    """社員配布に混入させない管理者シートID。"""
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "setup_employee_sheet.py",
    )

    with open(path, encoding="utf-8") as file:
        tree = ast.parse(file.read(), filename=path)

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue

        if any(
            isinstance(target, ast.Name)
            and target.id == "PROTECTED_IDS"
            for target in node.targets
        ):
            return set(ast.literal_eval(node.value))

    raise RuntimeError("PROTECTED_IDSを読み取れない")


def validate_staged_files(root):
    """展開後の配布物に管理者IDが残っていないか検査。"""
    required = (
        "start.bat",
        "サロン向け_発注サイト使い方マニュアル.pdf",
    )
    missing = [
        name for name in required
        if not os.path.isfile(os.path.join(root, name))
    ]
    if missing:
        raise RuntimeError(
            "社員配布物の必須ファイルが無い: " + "・".join(missing)
        )

    protected_ids = load_protected_sheet_ids()
    hits = []

    for base, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)

            try:
                with open(path, encoding="utf-8") as file:
                    content = file.read()
            except (OSError, UnicodeDecodeError):
                continue

            if any(value in content for value in protected_ids):
                hits.append(os.path.relpath(path, root))

    if hits:
        raise RuntimeError(
            "社員配布物に管理者シートIDが残っている: "
            + "・".join(sorted(hits))
        )


def build_zip():
    """クリーンなZIPをメモリ上に作る（決定的な内容）"""
    validate_distribution_defaults()

    with tempfile.TemporaryDirectory() as staging:
        root = os.path.join(staging, ZIP_ROOT)

        rsync = ["rsync", "-a"]

        for pattern in EXCLUDES:
            rsync += ["--exclude", pattern]
            rsync += ["--exclude", f"*/{pattern}"]

        subprocess.run(
            rsync + [TOOL_DIR + "/", root + "/"],
            check=True,
        )

        validate_staged_files(root)

        buffer = io.BytesIO()

        with zipfile.ZipFile(
            buffer, "w", zipfile.ZIP_DEFLATED
        ) as archive:
            for base, _dirs, files in sorted(
                os.walk(root)
            ):
                for name in sorted(files):
                    path = os.path.join(base, name)
                    arcname = os.path.join(
                        ZIP_ROOT,
                        os.path.relpath(path, root),
                    )
                    archive.write(path, arcname)

        return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(
        description="統合ツール更新の一括配信"
    )
    parser.add_argument(
        "--dry-run", action="store_true"
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="安全検査済みZIPを配布セットへ保存するが、外部配信しない",
    )
    parser.add_argument(
        "--sheet",
        help=(
            "初回だけ、更新配信専用シートの"
            "URLまたはIDを指定"
        ),
    )
    parser.add_argument(
        "--viewer",
        action="append",
        default=[],
        help=(
            "閲覧権限を付ける社員専用SAのメール。"
            "複数回指定可"
        ),
    )
    args = parser.parse_args()

    if args.sheet:
        spreadsheet_id = save_update_channel(args.sheet)
        print("更新配信シートIDを保存した。")
    elif args.dry_run or args.build_only:
        # 配信シート作成前でもZIPの安全検査はできる。
        spreadsheet_id = ""
    else:
        spreadsheet_id = load_update_channel()

    payload = build_zip()
    digest = hashlib.md5(payload).hexdigest()
    version = time.strftime("%Y%m%d-%H%M")

    encoded = base64.b64encode(payload).decode()
    chunks = [
        encoded[i:i + CHUNK_SIZE]
        for i in range(0, len(encoded), CHUNK_SIZE)
    ]

    # 危険物の混入チェック
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()

        for banned in (
            "credentials.json", "data.db", "config.json",
        ):
            if any(banned in n for n in names):
                sys.exit(f"❌ {banned} が混入している。中止。")

    print(f"バージョン: {version}")
    print(f"サイズ: {len(payload) / 1024:.0f}KB"
          f" / チャンク: {len(chunks)}個"
          f" / ファイル数: {len(names)}")
    print(f"MD5: {digest}")

    if args.dry_run:
        print("--dry-run のため配信していない。")
        return

    if args.build_only:
        os.makedirs(KIT_DIR, exist_ok=True)
        kit_zip = os.path.join(
            KIT_DIR,
            f"B2B-OrderTool_{time.strftime('%Y-%m-%d')}.zip",
        )
        with open(kit_zip, "wb") as file:
            file.write(payload)
        print(f"📦 配布セットへ保存: {os.path.basename(kit_zip)}")
        print("--build-only のため更新シートへ配信していない。")
        return

    # ① デスクトップ配布セットへ（日付ZIPを置き換え）
    os.makedirs(KIT_DIR, exist_ok=True)

    for name in os.listdir(KIT_DIR):
        if name.startswith("B2B-OrderTool_") and (
            name.endswith(".zip")
        ):
            os.remove(os.path.join(KIT_DIR, name))

    kit_zip = os.path.join(
        KIT_DIR,
        f"B2B-OrderTool_{time.strftime('%Y-%m-%d')}.zip",
    )

    with open(kit_zip, "wb") as f:
        f.write(payload)

    print(f"📦 配布セットへ保存: {os.path.basename(kit_zip)}")

    # ② 配信タブへ書き込み（各ツールが起動時に取得）
    from core.sheets import SheetsClient

    client = SheetsClient()
    client.connect(
        os.path.join(TOOL_DIR, "credentials.json")
    )
    spreadsheet = client.open_spreadsheet(spreadsheet_id)

    for viewer in args.viewer:
        client.retry(
            spreadsheet.share,
            str(viewer).strip(),
            perm_type="user",
            role="reader",
            notify=False,
        )
        print(f"👁 閲覧権限を追加: {viewer}")

    import gspread as gspread_module

    try:
        worksheet = client.retry(
            spreadsheet.worksheet, CHANNEL_TAB
        )
    except gspread_module.WorksheetNotFound:
        worksheet = client.retry(
            spreadsheet.add_worksheet,
            title=CHANNEL_TAB,
            rows=len(chunks) + 10,
            cols=4,
        )

        try:
            client.retry(worksheet.hide)
        except Exception:
            pass

    if worksheet.row_count < len(chunks) + 1:
        client.retry(
            worksheet.resize, rows=len(chunks) + 10
        )

    client.retry(worksheet.clear)

    note = (
        "統合ツール自動更新の配信データ。手で編集しない"
    )
    client.retry(
        worksheet.update,
        values=[[version, digest, len(chunks), note]],
        range_name="A1:D1",
        value_input_option="RAW",
    )
    client.retry(
        worksheet.update,
        values=[[chunk] for chunk in chunks],
        range_name=f"A2:A{1 + len(chunks)}",
        value_input_option="RAW",
    )

    print(
        f"🚀 配信完了（{CHANNEL_TAB}）。"
        "各社員のツールは次回起動時に自動更新される。"
    )
    print("※ start.bat を変えた場合だけは"
          "新しいZIPを手で渡すこと")


if __name__ == "__main__":
    main()
