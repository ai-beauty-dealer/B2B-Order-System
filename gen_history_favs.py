"""history_favorites.json を生成する。

このファイルは GitHub Pages から誰でも取得できる場所に置かれるため、
キーには得意先名を使わない（得意先名は無認証APIの clientName にそのまま
使えてしまうため）。ClientMaster G列の得意先コードをキーにする。
"""

import json
import os
import sys

TOOL_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '自動入力ツール', '統合ツール',
)
sys.path.insert(0, TOOL_DIR)

B2B_ITEMS_PATH = '/tmp/b2b_items.json'
CRM_PRODUCTS_PATH = '/Users/bunchaca/product/2nd-Brain/00_システム/devtools/crm_tool/salon_products.json'
OUTPUT_PATH = '/Users/bunchaca/product/2nd-Brain/99_Sbox/B2B-Order-App/history_favorites.json'


def load_client_codes():
    """ClientMasterから {得意先名: 得意先コード} を取得する。"""
    from core import config as tool_config
    from core import importer
    from core.sheets import SheetsClient

    cfg = tool_config.load_config()
    creds = tool_config.resolve_credentials_path(cfg)
    spreadsheet_id = cfg.get('order_spreadsheet_id', '')

    if not spreadsheet_id:
        raise RuntimeError('統合ツールの order_spreadsheet_id が未設定です。')

    sheets = SheetsClient()
    sheets.connect(creds)

    _names, codes = importer.load_client_master_full(sheets, spreadsheet_id)
    return codes


def main():
    if not os.path.exists(B2B_ITEMS_PATH):
        print(f"Error: {B2B_ITEMS_PATH} not found.")
        return

    with open(B2B_ITEMS_PATH, 'r', encoding='utf-8') as f:
        b2b_data = json.load(f)
        b2b_items = b2b_data.get('data', [])

    # B2Bの商品コードをセット化（文字列として保持）
    b2b_codes = {str(item['code']): item['name'] for item in b2b_items}
    # 名前からコードへの逆引き（コード不一致時のフォールバック用）
    b2b_names_to_code = {item['name'].strip(): str(item['code']) for item in b2b_items}

    with open(CRM_PRODUCTS_PATH, 'r', encoding='utf-8') as f:
        crm_data = json.load(f)
        salons_by_day = crm_data.get('salons', {})

    client_codes = load_client_codes()

    history_favorites = {}
    unmapped = []

    for day, salons in salons_by_day.items():
        for salon_name, products in salons.items():
            valid_codes = []
            for p in products:
                code = str(p.get('product_code'))
                name = p.get('product_name', '').strip()

                # 1. コードで一致確認
                if code in b2b_codes:
                    valid_codes.append(code)
                # 2. 名前で一致確認（コードが違う場合）
                elif name in b2b_names_to_code:
                    valid_codes.append(b2b_names_to_code[name])

            if not valid_codes:
                continue

            client_code = str(client_codes.get(salon_name, '')).strip()

            # 得意先コードが無いサロンは公開ファイルに出さない。
            # 得意先名をキーにすると無認証APIの入力候補を配ることになるため。
            if not client_code:
                unmapped.append(salon_name)
                continue

            existing = set(history_favorites.get(client_code, []))
            history_favorites[client_code] = sorted(existing | set(valid_codes))

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_favorites, f, ensure_ascii=False, indent=2)

    print(f"✅ Generated {OUTPUT_PATH}")
    print(f"   Salons with favorites: {len(history_favorites)}")

    if unmapped:
        print(f"\n⚠ ClientMaster G列（得意先コード）が空のため除外: {len(unmapped)}件")
        print("   このサロンは「履歴からお気に入りを同期」が使えません。")
        print("   G列を埋めて再実行してください:")
        for name in sorted(set(unmapped)):
            print(f"     - {name}")


if __name__ == "__main__":
    main()
