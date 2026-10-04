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
  const imageReady = async () => evaluate("Promise.all([...document.querySelectorAll('svg image')].map(el=>{const i=new Image();i.src=el.getAttribute('href');return i.decode()}))");
  const shot = async name => { await imageReady(); await capture(name); };
  const coordinates = async (x,y) => evaluate(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('[data-testid=reference-map]').getScreenCTM());return{x:p.x,y:p.y}})()`);
  const mapClick = async (x,y) => { const p=await coordinates(x,y); await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1}); await evaluate("new Promise(r=>requestAnimationFrame(r))"); };
  await layout(); await shot('workspace-desktop');
  await button('理解任务');
  await wait("document.querySelector('.ws-warning')");
  assert.ok(await evaluate("document.querySelector('.ws-tree').textContent.includes('还需要补充信息')"));
  await click('button[aria-label="关闭详情"]');
  await button('在地图中选择目标'); await button('绑定为作业目标');
  assert.equal((await saved()).spatial.bound,true);
  await button('明确任务字段'); await button('理解任务');
  await wait("document.querySelector('.ws-tree-nodes li')");
  assert.equal(await evaluate("document.querySelectorAll('.ws-warning').length"),0);
  assert.equal(await evaluate("document.querySelector('.ws-tree-nodes').textContent.includes('示例建筑 A')"),true);
  await shot('task-parsed'); await click('button[aria-label="关闭详情"]');
  await button('添加'); await mapClick(790,602); await mapClick(982,781); await mapClick(752,954); await button('完成');
  assert.equal((await saved()).spatial.points.length,3);
  await button('在地图上设置'); await mapClick(493,977);
  assert.equal((await saved()).spatial.start.id,'start');
  await click('.ws-point-row');
  await input('#ws-point-height','35.5'); await button('保存高度');
  assert.equal((await saved()).spatial.points[0].z,35.5);
  await input('#ws-point-height',''); await button('保存高度');
  assert.ok(await evaluate("!document.querySelector('#ws-height-error').hidden"));
  assert.equal((await saved()).spatial.points[0].z,35.5);
  await input('#ws-point-height','35.5');
  const p=await coordinates(790,602);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+18,y:p.y-10,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+18,y:p.y-10,button:'left',clickCount:1});
  const moved=(await saved()).spatial.points[0]; assert.notEqual(moved.x,790); assert.equal(moved.z,35.5);
  await evaluate("document.querySelector('[data-point=p1]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await wait(`JSON.parse(localStorage.getItem('skyops.mission-drafts.v1')).drafts[0].spatial.points[0].x > ${moved.x}`);
  await shot('workspace-bound');
  await click('button[aria-label="关闭详情"]');
  const originalView=await evaluate("document.querySelector('[data-testid=reference-map]').getAttribute('viewBox')");
  await click('button[aria-label="放大地图"]');
  assert.notEqual(await evaluate("document.querySelector('[data-testid=reference-map]').getAttribute('viewBox')"),originalView);
  await click('button[aria-label="恢复初始视图"]');
  assert.equal(await evaluate("document.querySelector('[data-testid=reference-map]').getAttribute('viewBox')"),originalView);
  await click('button[aria-label="地图图层"]'); await click('.ws-layers input');
  assert.equal(await evaluate("document.querySelector('svg image')===null"),true); await click('.ws-layers input'); await click('button[aria-label="地图图层"]');
  // Both panels support mouse resizing plus bounded keyboard alternatives.
  const handle=await evaluate("(()=>{const r=document.querySelector('[aria-label=调整任务面板宽度]').getBoundingClientRect();return{x:r.x+4,y:400}})()");
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...handle,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+60,y:handle.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+60,y:handle.y,button:'left',clickCount:1});
  assert.equal(await evaluate("Math.round(document.querySelector('.ws-task-panel').getBoundingClientRect().width)"),416);
  await evaluate("document.querySelector('[aria-label=调整任务面板宽度]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await click('.ws-point-row'); await evaluate("document.querySelector('[aria-label=调整对象详情宽度]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End'});
  await wait("document.querySelector('[aria-label=调整对象详情宽度]').getAttribute('aria-valuenow')==='420'");
  await evaluate("document.querySelector('[aria-label=调整对象详情宽度]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await button('移除观察点'); assert.equal((await saved()).spatial.points.length,2);
  await button('添加'); await mapClick(605,741); await button('完成');
  assert.deepEqual((await saved()).spatial.points.map(p=>p.number),[2,3,4]);
  const snapshot=(await saved()).spatial;
  await evaluate("window.__reload=true"); await send('Page.reload'); await wait("!window.__reload && document.querySelector('.ws-shell')");
  assert.deepEqual((await saved()).spatial,snapshot);
  assert.equal(await evaluate("document.querySelectorAll('[data-point]').length"),4);
  // Input changes clear prior results; multiple-task dependencies are returned by the real F01 endpoint.
  await button('编辑'); await input('#ws-task-input','检查对象[A]；完成条件：取得影像，同时拍摄点[B]；完成条件：取得照片，然后测绘区域[C]；完成条件：覆盖全区');
  await button('理解任务'); await wait("document.querySelectorAll('.ws-tree-nodes > li').length===3");
  assert.ok(await evaluate("document.querySelector('.ws-tree-summary').textContent.includes('2 条依赖')"));
  await click('button[aria-label="关闭详情"]');
  await input('#ws-task-input','检查这里');
  await button('查看任务结构'); assert.equal(await evaluate("document.querySelectorAll('.ws-tree-nodes > li').length"),0);
  await click('button[aria-label="关闭详情"]');
  // Network failure remains retryable, never a successful parse.
  await send('Network.enable'); await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await button('理解任务'); await wait("document.querySelector('.ws-task-footer button').textContent.includes('重试')");
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await button('重试理解任务'); await wait("document.querySelector('.ws-warning')");
  await click('button[aria-label="关闭详情"]');
  await viewport(1440,900); await layout(); await shot('workspace-1440');
  await viewport(390,844); await evaluate("document.querySelector('.ws-panel-scroll').scrollTop=0"); await layout(); await shot('workspace-mobile-panel');
  assert.equal(await evaluate("document.querySelector('.ws-collapse').getAttribute('aria-label')"),'收起任务面板');
  await click('.ws-collapse');
  assert.equal(await evaluate("document.querySelector('.ws-collapse').getAttribute('aria-label')"),'展开任务面板');
  await layout(); await shot('workspace-mobile-map');
  await evaluate("document.querySelector('[data-point=p2]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await layout(); await shot('workspace-mobile-detail');
  assert.ok(await evaluate("document.querySelector('.ws-inspector').getBoundingClientRect().right<=innerWidth"));
  await click('button[aria-label="关闭详情"]');
  await viewport(1440,900); await click('.ws-collapse');
  const beforeReference=(await saved()).spatial;
  await button('打开独立场景参考工具');
  await wait("document.querySelector('.ws-reference main')");
  await button('生成任务方案');
  await wait("document.querySelector('.ws-reference main').textContent.includes('任务方案') && !document.querySelector('#mission-task-input')");
  const referenceView = async index => {
    await click(`.ws-reference main nav button:nth-child(${index})`);
    await evaluate("new Promise(r=>requestAnimationFrame(r))");
  };
  await referenceView(3);
  await wait("document.querySelector('.ws-reference .recharts-surface')");
  assert.ok(await evaluate("document.querySelector('.ws-reference main').textContent.includes('风险推理')"));
  await referenceView(4);
  assert.ok(await evaluate("document.querySelector('.ws-reference main').textContent.includes('异常重规划')"));
  await referenceView(5);
  await wait("document.querySelector('.ws-reference .recharts-surface')");
  assert.ok(await evaluate("document.querySelector('.ws-reference main').textContent.includes('任务复盘')"));

  await button('返回任务编辑');
  assert.deepEqual((await saved()).spatial,beforeReference);
  await click('button[aria-label="返回工作台"]');
  await wait("!document.querySelector('.ops-home').hidden");
  await click('.page-heading .primary-button'); await input('#create-name','隔离任务'); await input('#create-goal','拍摄目标'); await click('.drawer-submit');
  await wait("document.querySelector('.ws-header h1').textContent==='隔离任务'");
  assert.equal(await evaluate("document.querySelectorAll('[data-point]').length"),0);
  assert.equal(await evaluate("document.querySelector('[data-object]').classList.contains('is-bound')"),false);
  assert.deepEqual(page.errors,[]);
  console.log('Spatial workspace passed: real F01 parse/clarification/dependencies/retry; binding, point add/drag/keyboard/delete/height/start; panel resizing; layers/camera; persistence, task isolation and responsive layouts.');
} finally {
  page?.close(); await browser.send("Target.disposeBrowserContext", { browserContextId }); browser.close();
}
