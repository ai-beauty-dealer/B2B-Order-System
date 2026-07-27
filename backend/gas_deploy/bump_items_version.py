#!/usr/bin/env python3
"""全店舗の商品マスタバージョンを一括で上げる（管理者用）。

ItemMaster をシート直接編集（サービスアカウント書き込み等）した
あとに実行すると、各サロン端末が1時間以内のバージョンチェックで
新しいマスタを取り直す（何もしなくても24時間キャッシュ切れで
反映はされる。これは「即時反映」用）。

使い方:
    python3 bump_items_version.py             # 台帳の全店舗
    python3 bump_items_version.py --only 花光  # 1店舗だけ（台帳のname）

仕組み:
    各店舗の doGet action=bump_items_version を呼ぶ。
    鍵はその店舗のスプレッドシートID（projects.json の sheetId）。
    GAS側は自分の SPREADSHEET_ID と一致しない鍵を拒否する。
"""

import argparse
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECTS_FILE = os.path.join(HERE, "projects.json")

TIMEOUT_SECONDS = 30


def bump(project):
    name = project.get("name", "(名無し)")
    deployment_id = project.get("deploymentId")
    sheet_id = project.get("sheetId")

    if not deployment_id or not sheet_id:
        return name, "スキップ（deploymentId/sheetIdなし）"

    url = (
        "https://script.google.com/macros/s/"
        f"{deployment_id}/exec"
        f"?action=bump_items_version&key={sheet_id}"
    )

    try:
        with urllib.request.urlopen(
            url, timeout=TIMEOUT_SECONDS
        ) as response:
            result = json.load(response)
    except Exception as error:
        return name, f"❌ 通信失敗: {error}"

    if result.get("status") == "success":
        return name, f"✅ 新バージョン {result.get('dataVersion')}"

    return name, f"❌ 拒否: {result.get('message')}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only", help="台帳のnameで1店舗だけ実行"
    )
    args = parser.parse_args()

    with open(PROJECTS_FILE, encoding="utf-8") as file:
        projects = json.load(file)["projects"]

    if args.only:
        projects = [
            p for p in projects
            if p.get("name") == args.only
        ]

        if not projects:
            print(f"台帳に「{args.only}」が見つからない。")
            sys.exit(1)

    failed = False

    for project in projects:
        name, message = bump(project)
        print(f"{name}: {message}")

        if message.startswith("❌"):
            failed = True

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
