#!/usr/bin/env python3
"""発注サイトGASの一括配信ツール（管理者用）。

backend/ の .gs / .html を、台帳（projects.json）にある
全社員のGASプロジェクトへ一括push＋再デプロイする。
社員側の作業ゼロ・発注サイトのURLも変わらない。

事前準備（初回だけ）:
    npm install -g @google/clasp
    clasp login                     ← 管理者のGoogleアカウント
    ※各社員のGASプロジェクトを管理者アカウントに共有してもらい、
      スクリプトID・デプロイIDを projects.json に登録する
      （projects.template.json をコピーして作る）

使い方:
    python3 gas_deploy.py --dry-run          # 何が起きるか確認だけ
    python3 gas_deploy.py                    # 全員へ push ＋ 再デプロイ
    python3 gas_deploy.py --only 社員A       # 1人だけ（台帳のname）
    python3 gas_deploy.py --no-deploy        # push のみ（デプロイしない）

仕組み（1プロジェクトごと）:
    1. 一時フォルダに .clasp.json を作る
    2. clasp pull で appsscript.json（マニフェスト）を取得
    3. コードファイルを backend/ の正本で置き換える
       （.gs は clasp の慣習に合わせ .js として置く）
    4. projects.jsonの社員別sheetIdをcode.jsへ注入・照合
    5. clasp push -f
    6. デプロイIDがあれば clasp deploy -i で同じURLのまま更新

社員ごとに残したいファイルがあれば PRESERVE_FILES に追加する
（例: 個人設定を config.gs に置いている場合など。現状は
Script Properties 管理なので不要）。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(HERE)
PROJECTS_FILE = os.path.join(HERE, "projects.json")

# 配信するファイル（backend/ 直下）
PUSH_EXTENSIONS = (".gs", ".html")

# 社員側に残すファイル名（正本で上書きしない）
PRESERVE_FILES = []
SHEET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,}$")
SHEET_ID_PLACEHOLDER = "__PROJECT_SPREADSHEET_ID__"


def normalize_sheet_id(value):
    """台帳のGoogle Sheets IDを検査して返す。"""
    value = str(value or "").strip()

    match = re.search(
        r"/spreadsheets/d/([A-Za-z0-9_-]+)", value
    )

    if match:
        value = match.group(1)

    if not SHEET_ID_PATTERN.fullmatch(value):
        raise ValueError(
            "sheetIdが未設定または不正"
        )

    return value


def validate_projects(projects):
    """配信台帳の必須値と重複を検査する。"""
    if not isinstance(projects, list) or not projects:
        raise ValueError("projectsが空")

    seen = {
        "name": set(),
        "scriptId": set(),
        "sheetId": set(),
        "dealer": set(),
    }

    for project in projects:
        name = str(project.get("name", "")).strip()
        script_id = str(
            project.get("scriptId", "")
        ).strip()

        if not name:
            raise ValueError("nameが未設定")

        if len(script_id) < 20:
            raise ValueError(f"{name}: scriptIdが未設定")

        sheet_id = normalize_sheet_id(
            project.get("sheetId", "")
        )
        dealer = str(project.get("dealer", "")).strip()
        project["name"] = name
        project["scriptId"] = script_id
        project["sheetId"] = sheet_id

        for key, value in (
            ("name", name),
            ("scriptId", script_id),
            ("sheetId", sheet_id),
            ("dealer", dealer),
        ):
            if not value:
                continue  # dealerだけは空を許す
            if value in seen[key]:
                raise ValueError(
                    f"{key}が重複: {value}"
                )
            seen[key].add(value)

    return projects


def select_projects(projects, only=None):
    """台帳全体を検査してから--only対象を絞り込む。

    重複検査（scriptId・sheetId・dealer）は台帳全体に
    対して行う必要がある。--only後のリストだけを検査すると、
    新社員レコードが他社員のsheetIdを誤って再利用していても
    検出できず、他社員シートへの誤配信につながるため。
    """
    try:
        validate_projects(projects)
    except ValueError as error:
        raise ValueError(f"projects.jsonが不正: {error}")

    if not only:
        return projects

    selected = [
        p for p in projects
        if p["name"] == only
    ]

    if not selected:
        raise ValueError(
            f"台帳に「{only}」が見つからない"
        )

    return selected


def clasp_command():
    """clasp本体か、無ければ npx 経由で実行する"""
    if shutil.which("clasp"):
        return ["clasp"]

    if shutil.which("npx"):
        return ["npx", "-y", "@google/clasp"]

    sys.exit(
        "❌ clasp が見つからない。まず\n"
        "   npm install -g @google/clasp\n"
        "   clasp login\n"
        "を実行して。"
    )


def run_clasp(base, args, cwd):
    result = subprocess.run(
        base + args,
        cwd=cwd,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()

        if "login" in output.lower() or "credentials" in output.lower():
            output += "\n→ 管理者アカウントで clasp login を実行して。"

        raise RuntimeError(
            f"clasp {' '.join(args)} 失敗:\n{output}"
        )

    return result.stdout


def source_files():
    """backend/ 直下の配信対象ファイル一覧"""
    files = [
        name
        for name in sorted(os.listdir(BACKEND_DIR))
        if name.endswith(PUSH_EXTENSIONS)
        and name not in PRESERVE_FILES
        and os.path.isfile(
            os.path.join(BACKEND_DIR, name)
        )
    ]

    if not files:
        sys.exit(f"❌ 配信対象が無い: {BACKEND_DIR}")

    return files


def stage_files(work_dir, files, sheet_id):
    """正本ファイルを作業フォルダへ配置する。

    clasp の慣習に合わせて .gs は .js として置く
    （push時にサーバ側で .gs に戻る）。
    """
    staged = []

    for name in files:
        if name.endswith(".gs"):
            target = name[:-3] + ".js"
        else:
            target = name

        shutil.copy2(
            os.path.join(BACKEND_DIR, name),
            os.path.join(work_dir, target),
        )
        staged.append(target)

    code_path = os.path.join(work_dir, "code.js")

    if not os.path.isfile(code_path):
        raise RuntimeError(
            "配信必須ファイルcode.gsが無い"
        )

    with open(code_path, encoding="utf-8") as file:
        content = file.read()

    if content.count(SHEET_ID_PLACEHOLDER) != 1:
        raise RuntimeError(
            "code.gsのsheetId置換ポイントが"
            "1件ではない"
        )

    content = content.replace(
        SHEET_ID_PLACEHOLDER,
        normalize_sheet_id(sheet_id),
    )

    with open(code_path, "w", encoding="utf-8") as file:
        file.write(content)

    validate_staged_sheet_id(code_path, sheet_id)
    return staged


def validate_staged_sheet_id(code_path, expected_id):
    """プッシュ直前のコードが社員別IDだけを指すか検査。"""
    with open(code_path, encoding="utf-8") as file:
        content = file.read()

    match = re.search(
        r"const\s+DEPLOYMENT_SPREADSHEET_ID\s*=\s*"
        r"['\"]([A-Za-z0-9_-]+)['\"]",
        content,
    )

    actual = match.group(1) if match else ""
    expected = normalize_sheet_id(expected_id)

    if actual != expected:
        raise RuntimeError(
            "配信直前のsheetIdが台帳と不一致: "
            f"{actual or '(未設定)'}"
        )

    if SHEET_ID_PLACEHOLDER in content:
        raise RuntimeError(
            "sheetId置換ポイントが残っている"
        )


def validate_project_staging(project, files):
    """pushせず、社員別コードの生成・ID照合だけ行う。"""
    with tempfile.TemporaryDirectory() as directory:
        stage_files(
            directory,
            files,
            project["sheetId"],
        )


def deploy_project(base, project, files, no_deploy):
    name = project["name"]
    script_id = project["scriptId"]
    deployment_id = str(
        project.get("deploymentId", "")
    ).strip()
    sheet_id = normalize_sheet_id(
        project.get("sheetId", "")
    )

    with tempfile.TemporaryDirectory() as work_dir:
        with open(
            os.path.join(work_dir, ".clasp.json"),
            "w",
            encoding="utf-8",
        ) as f:
            json.dump(
                {"scriptId": script_id, "rootDir": "."},
                f,
            )

        # マニフェスト（appsscript.json）と社員側の既存構成を取得
        run_clasp(base, ["pull"], work_dir)

        # 既存コードを消して正本に置き換える
        # （appsscript.json と PRESERVE_FILES は残す）。
        # GAS側は「backend/code」のようにフォルダ付きの
        # ファイル名を持てるため、サブフォルダまで再帰的に消す
        for root, _dirs, entries in os.walk(work_dir):
            for entry in entries:
                if entry in (
                    ".clasp.json", "appsscript.json",
                ):
                    continue

                if entry in PRESERVE_FILES or (
                    entry.endswith(".js")
                    and entry[:-3] + ".gs"
                    in PRESERVE_FILES
                ):
                    continue

                if entry.endswith(
                    (".js", ".gs", ".html")
                ):
                    os.remove(os.path.join(root, entry))

        stage_files(work_dir, files, sheet_id)

        print(f"  🛡 配信先シートを固定: {sheet_id}")

        run_clasp(base, ["push", "-f"], work_dir)
        print(f"  📤 push 完了（{len(files)}ファイル）")

        if no_deploy:
            return

        if not deployment_id:
            print(
                "  ⚠ deploymentId 未登録のため再デプロイは"
                "スキップ（エディタの「デプロイを管理」で"
                "IDを確認して台帳に入れる）"
            )
            return

        stamp = time.strftime("%Y-%m-%d %H:%M")
        run_clasp(
            base,
            [
                "deploy",
                "-i", deployment_id,
                "-d", f"一括配信 {stamp}",
            ],
            work_dir,
        )
        print("  🚀 再デプロイ完了（URL変わらず）")


def main():
    parser = argparse.ArgumentParser(
        description="発注サイトGASの一括配信"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="対象の確認だけ行い、何も送らない",
    )
    parser.add_argument(
        "--only",
        help="台帳のnameが一致するプロジェクトだけ配信",
    )
    parser.add_argument(
        "--no-deploy", action="store_true",
        help="pushのみ（Webアプリの再デプロイをしない）",
    )
    args = parser.parse_args()

    if not os.path.isfile(PROJECTS_FILE):
        sys.exit(
            "❌ projects.json が無い。\n"
            "   projects.template.json をコピーして、"
            "社員のスクリプトIDを登録して。"
        )

    with open(PROJECTS_FILE, encoding="utf-8") as f:
        projects = json.load(f)["projects"]

    try:
        projects = select_projects(projects, args.only)
    except ValueError as error:
        sys.exit(f"❌ {error}")

    files = source_files()

    print(f"配信ファイル: {', '.join(files)}")
    print(f"対象: {len(projects)}プロジェクト")

    if args.dry_run:
        for project in projects:
            try:
                validate_project_staging(project, files)
            except Exception as error:
                sys.exit(
                    f"❌ {project['name']}の配信前検査に"
                    f"失敗: {error}"
                )

            deploy_note = (
                "再デプロイあり"
                if str(
                    project.get("deploymentId", "")
                ).strip()
                else "pushのみ（deploymentId未登録）"
            )
            print(
                f"  ・{project['name']}"
                f"（{project['scriptId'][:12]}...）"
                f" → sheet {project['sheetId'][:12]}..."
                " → ID注入検査OK"
                f" → {deploy_note}"
            )

        print("--dry-run のため何も送っていない。")
        return

    base = clasp_command()
    failed = []

    for project in projects:
        print(f"\n=== {project['name']} ===")

        try:
            deploy_project(
                base, project, files, args.no_deploy
            )
        except Exception as error:
            import traceback
            print(f"  ❌ 失敗: {error}")
            traceback.print_exc()
            failed.append(project["name"])

    print(
        f"\n完了: {len(projects) - len(failed)}"
        f"/{len(projects)} 成功"
    )

    if failed:
        print(f"失敗: {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
