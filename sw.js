// sw.js — Service Worker（PWA用）
//
// 【設計方針・設計レビューで潰した罠】
// R-2: GAS（script.google.com）への通信は絶対に横取りしない。
//      注文・履歴・商品データは常にライブ。SWは静的資産だけ扱う。
// R-3: 画面(html/js/css)は network-first（オンラインなら常に最新）。
//      これで push した修正がすぐ反映される。古い版に固定されない。
//      不変物（アイコン・ライブラリ）だけ cache-first で高速化。
//      例外: バージョンクエリ付き資産（app.js?v= / style.css?v= / config.js?v=）は
//      cache-first。v が変われば別URL＝キャッシュミスで新版を取るため、
//      index.html（network-first維持）の ?v= 更新が反映の起点になる。R-3思想と両立。
// R-6: 緊急停止するには、このファイルの中身を下記「キルスイッチ」に
//      置き換えて push すればよい（末尾のコメント参照）。
//
// キャッシュ名にバージョンを持たせ、更新時に古いキャッシュを消す。

const CACHE_VERSION = 'v2.25.0';
const CACHE_NAME = 'b2b-order-' + CACHE_VERSION;

// 起動に必要な最小資産（オフライン時のフォールバック用）
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './style.css',
  './lib/html5-qrcode.min.js',
  './icon-192.png',
  './icon-512.png',
];

// 変更されない前提の資産（cache-first で高速化）
const IMMUTABLE_HINTS = ['/lib/', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}) // 一部取得失敗でもインストールは進める
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('b2b-order-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET以外（発注POST等）は一切触らない
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // R-2: GASや外部ドメインは横取りしない（常にネットワークへ素通し）
  if (url.origin !== self.location.origin) return;

  // 不変物 → cache-first
  if (IMMUTABLE_HINTS.some((hint) => url.pathname.includes(hint))) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchAndCache(req))
    );
    return;
  }

  // バージョンクエリ付き js/css → cache-first（vが変われば別URLなので古い版に固定されない）
  if (url.searchParams.has('v') && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchAndCache(req))
    );
    return;
  }

  // R-3: 画面(html/js/css) → network-first、失敗時のみキャッシュ
  event.respondWith(
    fetchAndCache(req).catch(() => caches.match(req))
  );
});

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
    }
    return res;
  });
}

// ── キルスイッチ（緊急停止したいとき）───────────────────
// 上の内容を全部消して、下記だけにして push すると、
// 全端末のSWが自分を登録解除して通常サイトに戻る。
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', (e) => {
//     e.waitUntil(self.registration.unregister()
//       .then(() => self.clients.matchAll())
//       .then((clients) => clients.forEach((c) => c.navigate(c.url))));
//   });
