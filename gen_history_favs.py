import json
import os

B2B_ITEMS_PATH = '/tmp/b2b_items.json'
CRM_PRODUCTS_PATH = '/Users/bunchaca/product/2nd-Brain/00_システム/devtools/crm_tool/salon_products.json'
OUTPUT_PATH = '/Users/bunchaca/product/2nd-Brain/99_Sbox/B2B-Order-App/history_favorites.json'

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

    history_favorites = {}

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
            
            if valid_codes:
                # 重複排除
                history_favorites[salon_name] = sorted(list(set(valid_codes)))

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_favorites, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Generated {OUTPUT_PATH}")
    print(f"   Salons with favorites: {len(history_favorites)}")

if __name__ == "__main__":
    main()
