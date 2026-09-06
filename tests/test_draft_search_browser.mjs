import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const repo=new URL('../',import.meta.url);
const app=readFileSync(new URL('app.js',repo),'utf8');

const css=readFileSync(new URL('style.css',repo),'utf8').replace(/@import[^\n]+/g,'');
const part=(a,b)=>{const start=app.indexOf(a),end=app.indexOf(b,start);assert.ok(start>=0&&end>start,a);return app.slice(start,end)};
const logic=[part('const normalizeForSearch =','const calculateTotal ='),
part('// --- Cart Persistence','// --- Cart Sidebar Renderer'),
part('// --- Render Items ---','// Helper to create a single item row'),
part('// --- Custom Item Logic','// --- Start Editing Order'),
part('// --- Tab Filtering ---','// --- Render Manufacturer Chips ---')].join('\n');
const harness=String.raw`
const byId=id=>document.getElementById(id);
const orderRemarks=byId('remarks'), customItemsList=byId('custom-list'),itemListContainer=byId('items'),searchInput=byId('search');
const tabAll=byId('tab-all'),tabFavorites=byId('tab-favorites'),tabHistory=byId('tab-history');
const searchWrapper=byId('search-wrapper'),cartSummary=byId('cart-summary'),historyListContainer=byId('history-list');
const syncFavsWrapper=null,customItemsWrapper=byId('custom-items-wrapper'),sortWrapper=null,addCustomItemBtn=null;
let currentUsername='UT-user', currentClientName='UT-salon-A', editingOrderId=null,currentCart={},cartOrder=[];
let currentFilter='all',currentManufacturerFilter='all',currentCategoryFilter='all',searchTimeout;
const favoriteItems=[],itemsData=Array.from({length:250},(_,i)=>({code:String(100000+i),name:'UT シャンプー '+i,manufacturer:'UTメーカー',category:'UTケア'}));
const isValidCode=()=>true,sortByCurrent=x=>x,renderManufacturerChips=()=>{},renderCategoryChips=()=>{},fetchHistory=()=>{};
const escHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const calculateTotal=()=>{byId('total').textContent=Object.values(currentCart).reduce((n,x)=>n+x.qty,0)};
const createItemRow=item=>{const row=document.createElement('div');row.className='item-row';row.textContent=item.name;row.dataset.code=item.code;return row};
const results=[],check=(ok,msg)=>{if(!ok)throw Error(msg);results.push(msg)};
window.confirm=()=>true;
window.onerror=message=>{document.body.dataset.result='FAIL';byId('results').textContent=String(message)};
`;
const checks=String.raw`
(async()=>{try{
 localStorage.clear();
 addCustomItemUI();let name=customItemsList.querySelector('.custom-name-input');
 name.value='UT 特注 "サイズ"';name.dispatchEvent(new Event('input'));
 const custom=cartOrder[0];check(currentCart[custom].qty===0,'E-1 name before quantity saved');
 currentCart['100000']={qty:1,name:'UT 通常'};cartOrder.push('100000');orderRemarks.value='UT 午後希望';saveCartToStorage();
 currentCart={};cartOrder=[];orderRemarks.value='';restoreCartFromStorage();renderCustomItemsFromCart();
 check(currentCart[custom].name==='UT 特注 "サイズ"'&&orderRemarks.value==='UT 午後希望','E-1 custom name and remarks restored');
 customItemsList.querySelector('.plus').click();customItemsList.querySelector('.plus').click();
 check(currentCart[custom].qty===2,'E-1 restored custom remains editable');
 currentCart={};cartOrder=[];restoreCartFromStorage();check(currentCart[custom].qty===2,'E-1 custom quantity restored');
 editingOrderId='history';currentCart={};orderRemarks.value='編集の備考';saveCartToStorage();editingOrderId=null;
 restoreCartFromStorage();check(currentCart[custom].qty===2&&orderRemarks.value==='UT 午後希望','E-2 editing cannot overwrite ordinary draft');
 currentClientName='UT-salon-B';currentCart={};cartOrder=[];restoreCartFromStorage();check(!Object.keys(currentCart).length&&orderRemarks.value==='','E-2 salon isolation');
 currentClientName='UT-salon-A';restoreCartFromStorage();clearCartFromStorage();currentCart={};cartOrder=[];
 restoreCartFromStorage();check(!Object.keys(currentCart).length&&orderRemarks.value==='','E-3 cleared draft stays empty');
 localStorage.setItem(getCartKey(),JSON.stringify({cart:{x:{qty:1}},order:['x'],remarks:'expired',savedAt:Date.now()-8*86400000}));
 check(restoreCartFromStorage()===0&&!localStorage.getItem(getCartKey())&&!orderRemarks.value,'E-3 seven day expiry');
 customItemsList.innerHTML='';currentFilter='favorites';currentManufacturerFilter='別メーカー';currentCategoryFilter='別カテゴリ';
 searchInput.value='シャンプー';renderItems(itemsData);check(itemListContainer.textContent.includes('お気に入り / 別メーカー / 別カテゴリ'),'E-4 active search scope visible');
 itemListContainer.querySelector('button').click();
 check(currentFilter==='all'&&currentManufacturerFilter==='all'&&currentCategoryFilter==='all'&&searchInput.value==='シャンプー'&&tabAll.classList.contains('active'),'E-4 widen search preserves query and updates tab');
 check(itemListContainer.querySelectorAll('.item-row').length===100,'E-5 first page limited to 100');
 itemListContainer.querySelector('.search-more').click();itemListContainer.querySelector('.search-more').click();
 check(itemListContainer.querySelectorAll('.item-row').length===250&&!itemListContainer.querySelector('.search-more'),'E-5 every result reachable');
 searchInput.value='シャンプー 249';renderItems(itemsData);check(itemListContainer.querySelectorAll('.item-row').length===1,'E-4 AND query applies on rerender');
 searchInput.value='存在しない品';searchInput.dispatchEvent(new Event('input'));switchTab('tab-all',true);await new Promise(r=>setTimeout(r,350));
 check(itemListContainer.querySelector('button').textContent==='特注・その他で入力する','E-5 no result offers custom');
 itemListContainer.querySelector('button').click();check(customItemsList.children.length===1,'E-5 custom action opens editable row');
 name=customItemsList.querySelector('.custom-name-input');name.value='UT 特注商品';name.dispatchEvent(new Event('input'));
 check(document.documentElement.scrollWidth<=innerWidth,'mobile no horizontal overflow');
 document.body.dataset.result='PASS';byId('results').textContent=JSON.stringify(results);
 }catch(error){document.body.dataset.result='FAIL';byId('results').textContent=error.stack}})();
`;
assert.ok(!app.includes("// Clear order remarks"),'confirmation does not clear remarks');
assert.equal((app.match(/if \(editingOrderId === null\) clearCartFromStorage\(\)/g)||[]).length,2,'both submit paths preserve draft during edits');
const dir=mkdtempSync(join(tmpdir(),'b2b-draft-search-'));
const path=join(dir,'fixture.html');
writeFileSync(path,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{padding:16px} .hidden{display:none}</style><nav><button id="tab-all">すべて</button><button id="tab-favorites">お気に入り</button><button id="tab-history">履歴</button></nav><div id="search-wrapper"><input id="search" aria-label="商品を検索"></div><div id="items"></div><div id="cart-summary">合計 <span id="total"></span></div><div id="history-list"></div><button id="add-custom-item-btn-top">特注・その他</button><div id="custom-items-wrapper"><div id="custom-list"></div></div><textarea id="remarks" aria-label="備考"></textarea><pre id="results" style="display:none"></pre><script>${harness}${logic}${checks}</script>`);
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${join(dir,'profile')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
let socket;
try {
 let tabs;
 for(let i=0;i<100;i++){try{tabs=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(tab=>tab.type==='page');if(tabs.length)break}catch{}await delay(100)}
 assert.ok(tabs?.length,'Chrome CDP startup');
 socket=new WebSocket(tabs[0].webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 let serial=0;const waiting=new Map();
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&waiting.has(data.id)){const {resolve,reject}=waiting.get(data.id);waiting.delete(data.id);data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result)}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{waiting.delete(id);reject(Error('CDP timeout: '+method))},10000);waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}))});
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await cdp('Page.navigate',{url:`file://${path}`});
 let state;
 for(let i=0;i<100;i++){await delay(100);const r=await cdp('Runtime.evaluate',{expression:'JSON.stringify({status:document.body?.dataset.result,results:document.getElementById("results")?.textContent})',returnByValue:true});state=JSON.parse(r.result.value);if(state.status)break}
 const dom=await cdp('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});writeFileSync(join(dir,'result.html'),dom.result.value);
 await delay(400);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,'mobile.png'),Buffer.from(shot.data,'base64'));
 assert.equal(state.status,'PASS',state.results||'Browser checks timed out');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 const desktop=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,'desktop.png'),Buffer.from(desktop.data,'base64'));
 console.log('PASS browser UX: '+state.results);console.log('Artifacts: '+dir);
}finally{if(socket)socket.close();child.kill();}
