// Node 22+ and an existing Chrome debugging endpoint; isolated browser storage, no test dependency.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const debug = process.env.SKYOPS_BROWSER_DEBUG_URL ?? "http://127.0.0.1:9223";
const base = process.env.SKYOPS_UI_BASE_URL ?? "http://127.0.0.1:5173";
const output = process.env.SKYOPS_SCREENSHOT_DIR;
async function connection(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);
    if (!pending.has(m.id)) return;
    const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  };
  return { errors, close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}
const browser = await connection((await fetch(`${debug}/json/version`).then(r => r.json())).webSocketDebuggerUrl);
const { browserContextId } = await browser.send("Target.createBrowserContext");
let page;
try {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const target = (await fetch(`${debug}/json/list`).then(r => r.json())).find(t => t.id === targetId);
  page = await connection(target.webSocketDebuggerUrl);
  const { send } = page;
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async expression => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(r => setTimeout(r, 75));
    }
    throw new Error(`Timeout: ${expression}`);
  };
  const click = async selector => {
    assert.ok(await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) return false; el.focus(); el.click(); return true; })()`), selector);
    await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  };
  const input = async (selector, value) => {
    await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await evaluate("new Promise(r => requestAnimationFrame(r))");
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate("new Promise(r => setTimeout(r, 200))");
  };
  const capture = async name => {
    await evaluate("Promise.all([...document.images].map(i=>i.decode())).then(()=>new Promise(r=>setTimeout(r,220)))");
    if (!output) return;
    await mkdir(output, { recursive: true });
    await evaluate("window.scrollTo(0,0)");
    const dialogOpen = await evaluate("!!document.querySelector('dialog[open]')");
    const metrics = await send("Page.getLayoutMetrics");
    const area = dialogOpen ? await evaluate("({width:innerWidth,height:innerHeight})") : metrics.cssContentSize;
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: area.width, height: area.height, scale: 1 } });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
  };
  const layout = async () => {
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, "No horizontal overflow");
    if (await evaluate("!!document.querySelector('dialog[open]')")) {
      assert.equal(await evaluate("(() => {const r=document.querySelector('.drawer-footer').getBoundingClientRect(); return r.bottom<=innerHeight+1 && r.top>=0})()"), true, "Drawer actions remain visible");
    }
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront");
  await viewport(1600, 1160);
  await send("Page.navigate", { url: base });
  await wait("document.querySelector('[data-template=building]')");
  await click('[data-template="building"] .scenario-footer button'); await click('.drawer-submit');
  await wait("document.querySelector('.ws-shell')");
  const saved = () => evaluate("JSON.parse(localStorage.getItem('skyops.mission-drafts.v1')).drafts[0]");
  const button = async text => { await evaluate(`(() => { const b=[...document.querySelectorAll('.ws-root button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b || b.disabled)throw new Error('Missing button'); b.focus();b.click(); })()`); await evaluate("new Promise(r=>requestAnimationFrame(r))"); };
  const imageReady = async () => evaluate("document.fonts.ready");
  const shot = async name => { await imageReady(); await capture(name); };
  const choose = async (selector, value) => {
    await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await evaluate("new Promise(r=>requestAnimationFrame(r))");
  };
  await button('场景');
  assert.equal(await evaluate("document.querySelector('#scene-dataset').value"),'campus');
  await wait("document.querySelector('.ws-scene-imagery')?.complete");
  await button('开始检测'); await wait("document.querySelectorAll('[data-obstacle-row]').length===3");
  await click('[data-obstacle-row="obs_1"]');
  assert.ok(await evaluate("document.querySelector('.ws-obstacle-details').textContent.includes('模拟配准')"));
  await shot('scene-mock-overlay');
  await viewport(1440,900); await layout(); await shot('scene-mock-1440');
  await viewport(390,844); await click('[data-obstacle-row="obs_1"]'); await layout(); await shot('scene-mock-mobile-detail');
  await click('button[aria-label="关闭详情"]'); await shot('scene-mock-mobile-map');
  await button('坐标核验');
  assert.equal(await evaluate("document.querySelector('.ws-scene-imagery')===null"),true);
  await button('影像叠加'); await wait("document.querySelector('.ws-scene-imagery')?.complete");
  await choose('#scene-projection','2');
  assert.equal(await evaluate("document.querySelector('.ws-scene-imagery')===null"),true);
  await button('影像叠加');
  await viewport(1600,1160); await click('.ws-collapse');
  await choose('#scene-dataset','demo');
  assert.equal(await evaluate("document.querySelector('.ws-scene-imagery')===null"),true);
  assert.equal(await evaluate("document.querySelectorAll('.ws-scene-demo-point').length"),0);
  await wait("document.querySelector('.ws-scene-canvas.leaflet-container')");
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),0);
  await shot('scene-idle');
  await button('开始检测');
  await wait("document.querySelectorAll('[data-obstacle-row]').length===2");
  const expected=await fetch(`${base}/point-cloud/detect-obstacles`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({point_cloud_file:'demo.pcd',cluster_tolerance:0.1})}).then(r=>r.json());
  assert.equal(expected.result.obstacles.length,2);
  assert.equal(await evaluate("document.querySelector('.ws-scene-result-heading').textContent.includes('Mock')"),true);
  await click('[data-obstacle-row="obs_0"]');
  await wait("document.querySelector('.ws-obstacle-details')");
  assert.equal(await evaluate("document.querySelectorAll('.ws-scene-vector')[0].textContent.includes('0.045')"),true);
  assert.equal(await evaluate("document.querySelector('[data-scene-obstacle=obs_0]').getAttribute('aria-pressed')"),'true');
  const allMarkersVisible = async () => {
    await wait("[...document.querySelectorAll('[data-scene-obstacle]')].every(el=>{const r=el.getBoundingClientRect(),b=document.querySelector('.ws-scene-canvas').getBoundingClientRect();return r.left>=b.left && r.right<=b.right && r.top>=b.top && r.bottom<=b.bottom})");
  };
  await allMarkersVisible(); await shot('scene-selected'); await layout();
  await button('定位选中障碍');
  const spacing = () => evaluate("(() => {const r=[...document.querySelectorAll('[data-scene-obstacle]')].map(el=>el.getBoundingClientRect());return Math.abs(r[1].x-r[0].x)})()");
  const beforeZoom=await spacing();
  await click('button[aria-label="放大场景"]');
  await wait(`(()=>{const r=[...document.querySelectorAll('[data-scene-obstacle]')].map(el=>el.getBoundingClientRect());return Math.abs(r[1].x-r[0].x)>${beforeZoom}})()`);
  await click('button[aria-label="显示全部障碍"]'); await allMarkersVisible();
  const canvasPoint=await evaluate("(()=>{const r=document.querySelector('.ws-scene-canvas').getBoundingClientRect();return{x:r.left+150,y:r.top+200}})()");
  const beforePan=await evaluate("document.querySelector('[data-scene-obstacle]').getBoundingClientRect().x");
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...canvasPoint,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:canvasPoint.x+45,y:canvasPoint.y+20,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:canvasPoint.x+45,y:canvasPoint.y+20,button:'left',clickCount:1});
  await wait(`document.querySelector('[data-scene-obstacle]').getBoundingClientRect().x!==${beforePan}`);
  await click('button[aria-label="显示全部障碍"]');
  await choose('#scene-projection','2');
  assert.equal(await evaluate("document.querySelector('.ws-scene-canvas').getAttribute('aria-label').includes('XZ')"),true);
  await click('button[aria-label="关闭详情"]');
  await click('[data-scene-obstacle="obs_1"]');
  assert.equal(await evaluate("document.querySelector('[data-obstacle-row=obs_1]').getAttribute('aria-pressed')"),'true');
  await click('button[aria-label="关闭详情"]');
  await choose('#scene-projection','1');
  await click('button[aria-label="显示障碍图层"]');
  assert.equal(await evaluate("document.querySelectorAll('[data-scene-obstacle]').length"),0);
  await click('[data-obstacle-row="obs_0"]');
  await wait("document.querySelectorAll('[data-scene-obstacle]').length===2");
  await click('button[aria-label="关闭详情"]');
  // Input invalidation prevents old detections from appearing under changed parameters.
  await input('#scene-height','');
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),0);
  assert.equal(await evaluate("document.querySelector('.ws-scene-footer .ws-primary').disabled"),true);
  await input('#scene-height','10000'); await button('开始检测');
  await wait("document.querySelector('.ws-scene-result-heading')");
  assert.equal(await evaluate("document.querySelector('.ws-scene-result-heading').textContent.includes('0 个障碍')"),true);
  assert.equal(await evaluate("document.querySelectorAll('[data-scene-obstacle]').length"),0);
  await shot('scene-empty');
  // Server file errors are not an empty successful scene.
  await choose('#scene-dataset','server'); await input('#scene-file','missing-f02-ui.pcd');
  await button('开始检测'); await wait("document.querySelector('.ws-scene-panel [role=alert]')");
  assert.equal(await evaluate("document.querySelector('.ws-scene-result-heading')===null"),true);
  await button('重试检测'); await wait("document.querySelector('.ws-scene-panel [role=alert]')");
  await shot('scene-error');
  await choose('#scene-dataset','demo'); await input('#scene-height','0.5');
  // Transport failure followed by retry uses the same request.
  await send('Network.enable');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await button('开始检测'); await wait("document.querySelector('.ws-scene-panel [role=alert]')");
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await button('重试检测'); await wait("document.querySelectorAll('[data-obstacle-row]').length===2");
  // Cancel waits logically, even when a real response arrives later.
  await send('Network.emulateNetworkConditions',{offline:false,latency:1200,downloadThroughput:-1,uploadThroughput:-1});
  await button('重新检测');
  assert.equal(await evaluate("document.querySelector('#scene-dataset').disabled"),true);
  await shot('scene-loading'); await button('取消等待');
  await evaluate("new Promise(r=>setTimeout(r,1600))");
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),0);
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await button('开始检测'); await wait("document.querySelectorAll('[data-obstacle-row]').length===2");
  await button('任务'); await wait("!document.querySelector('.ws-reference-map').hidden");
  await button('场景');
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),2);
  await viewport(1440,900); await click('[data-obstacle-row="obs_0"]'); await layout(); await shot('scene-1440');
  await click('button[aria-label="关闭详情"]');
  await viewport(390,844); await evaluate("document.querySelector('.ws-panel-scroll').scrollTop=0"); await layout(); await shot('scene-mobile-panel');
  await click('[data-obstacle-row="obs_0"]'); await layout(); await shot('scene-mobile-detail');
  await click('button[aria-label="关闭详情"]'); await layout(); await allMarkersVisible(); await shot('scene-mobile-map');
  await viewport(1600,1160); await click('button[aria-label="返回工作台"]');
  await wait("!document.querySelector('.ops-home').hidden");
  await click('.task-action');
  await wait("document.querySelector('.ws-root:not([hidden])')");
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),2);
  await button('场景'); await input('#scene-tolerance','0.2');
  assert.equal((await saved()).scene.tolerance,'0.2');
  await evaluate('window.__beforeSceneReload=true'); await send('Page.reload'); await wait("!window.__beforeSceneReload && document.querySelector('.ws-shell')"); await button('场景');
  assert.equal(await evaluate("document.querySelector('#scene-tolerance').value"),'0.2');
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),0);
  await button('开始检测'); await wait("document.querySelectorAll('[data-obstacle-row]').length===2");
  await click('button[aria-label="返回工作台"]');
  await click('.page-heading .primary-button'); await input('#create-name','F02 隔离任务'); await input('#create-goal','测试独立场景'); await click('.drawer-submit');
  await wait("document.querySelector('.ws-header h1').textContent==='F02 隔离任务'"); await button('场景');
  assert.equal(await evaluate("document.querySelectorAll('[data-obstacle-row]').length"),0);
  assert.equal(await evaluate("document.querySelector('#scene-tolerance').value"),'2');
  assert.deepEqual(page.errors,[]);
  console.log('F02 browser passed: real detections, empty/error/retry/cancel, settings invalidation/persistence, task isolation, map/list selection, projections, layers, desktop/mobile and reference-image separation.');
} finally {
  page?.close(); await browser.send("Target.disposeBrowserContext", { browserContextId }); browser.close();
}
