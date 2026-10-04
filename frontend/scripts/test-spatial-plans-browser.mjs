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
  await evaluate(`window.__requests=[];window.__nativeFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.__nativeFetch(...args);if(String(args[0]).endsWith('/missions/plan-candidates')){window.__requests.push(JSON.parse(args[1].body));window.__candidates=await r.clone().json()}return r}`);
  await button('方案');
  assert.ok(await evaluate("document.querySelector('.ws-plan-panel').textContent.includes('请先在任务页')"));
  await button('任务'); await button('在地图中选择目标'); await button('绑定为作业目标');
  await button('明确任务字段'); await button('理解任务');
  await wait("document.querySelector('.ws-tree-nodes li')"); await click('button[aria-label="关闭详情"]');
  await button('添加'); await mapClick(790,620); await mapClick(980,900); await mapClick(690,940); await mapClick(605,741); await button('完成');
  await button('在地图上设置'); await mapClick(540,1000);
  await button('场景'); await button('开始检测'); await wait("document.querySelectorAll('[data-obstacle-row]').length===3");
  await button('方案'); await button('生成候选方案');
  await wait("document.querySelectorAll('[data-select-plan]').length===3");
  const data=await evaluate('window.__candidates'),request=await evaluate('window.__requests[0]');
  assert.equal(data.status,'candidates'); assert.equal(data.execution_authorized,false);
  assert.deepEqual(request.scene.start,[108,56,0]); assert.equal(request.scene.targets[0].observation_points.length,4);
  assert.equal(request.scene.obstacle_detection.obstacles.length,3);
  await wait("document.querySelector('[data-route=primary]')");
  await layout(); await shot('plans-desktop');
  const compare = async id => { await evaluate(`(()=>{const el=document.querySelector('[aria-label="选择对照方案"]');el.value=${JSON.stringify(id)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await evaluate("new Promise(r=>requestAnimationFrame(r))"); };
  const selected = await evaluate("document.querySelector('[data-select-plan][aria-pressed=true]').dataset.selectPlan");
  const other=data.candidates.find(c=>c.strategy!==selected && c.status==='feasible').strategy;
  await compare(other); await wait("document.querySelectorAll('[data-route]').length===2"); await shot('plans-comparison');
  await click(`[data-select-plan="${other}"]`); assert.equal(await evaluate("document.querySelector('[aria-label=\"选择对照方案\"]').value"),'');
  await click('[data-plan-visit="1"]');
  await wait("document.querySelector('[data-route-visit=\"1\"]').classList.contains('is-selected')");
  // Selecting a map visit preserves its focused node while details are already open.
  await click('[data-route-visit="2"]');
  assert.equal(await evaluate("document.activeElement?.dataset.routeVisit"),'2');
  await click('button[aria-label="关闭详情"]');
  assert.equal(await evaluate("document.activeElement?.dataset.routeVisit"),'2');
  await click('[data-route-visit="1"]');
  await wait("document.activeElement===document.querySelector('.ws-inspector-heading h2')");
  await click('button[aria-label="关闭详情"]');
  assert.equal(await evaluate("document.activeElement?.dataset.routeVisit"),'1');
  await button('方案详情');
  await button('设为当前草案'); assert.ok(await evaluate("document.querySelector('.ws-task-footer').textContent.includes('已设为当前草案')"));
  await viewport(1440,900); await layout(); await shot('plans-1440');
  await viewport(800,900); await layout(); await shot('plans-800');
  await viewport(390,844); await layout(); await shot('plans-mobile-detail');
  await click('button[aria-label="关闭详情"]'); await layout(); await shot('plans-mobile-map');
  await click('.ws-collapse'); await layout(); await shot('plans-mobile-list');
  await viewport(1600,1160);
  if (await evaluate("document.querySelector('.ws-task-panel').inert")) await click('.ws-collapse');
  await evaluate("document.querySelector('.ws-plan-settings').open=true");
  await click('[data-completed-task]');
  assert.equal(await evaluate("document.querySelectorAll('[data-select-plan]').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('[data-route]').length"),0);
  await button('生成候选方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  await click('[data-select-plan="supplementary_capture"]');
  assert.ok(await evaluate("document.querySelector('.ws-plan-details').textContent.includes('无剩余任务')"));
  assert.equal(await evaluate("document.querySelectorAll('[data-route]').length"),0);
  await shot('plans-no-remaining');
  await click('[data-completed-task]');
  await input('[data-plan-setting=resolution]','0.1');
  assert.ok(await evaluate("document.querySelector('.ws-plan-panel').textContent.includes('50,000')"));
  assert.equal(await evaluate("document.querySelector('.ws-task-footer button').disabled"),true);
  await input('[data-plan-setting=resolution]','8');
  await send('Network.enable'); await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await button('生成候选方案'); await wait("document.querySelector('.ws-plan-panel [role=alert]')");
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await button('重试生成方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  // Completion declarations apply to tasks, including all of their observation samples.
  await button('任务'); await button('编辑');
  const taskDsl=JSON.stringify({version:1,nodes:[
    {id:'a',action:'inspect',target:{kind:'object',label:'A',refs:['A']},completion_conditions:['取得影像'],parent_id:null,depends_on:[]},
    {id:'b',action:'capture',target:{kind:'object',label:'A',refs:['A']},completion_conditions:['取得照片'],parent_id:null,depends_on:['a']}
  ]});
  await input('#ws-task-input',taskDsl); await button('理解任务'); await wait("document.querySelectorAll('.ws-tree-nodes > li').length===2");
  await click('button[aria-label="关闭详情"]'); await button('方案');
  await evaluate("document.querySelector('.ws-plan-settings').open=true");
  await click('[data-priority-task="b"]'); await click('[data-completed-task="a"]');
  await button('生成候选方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  const partial=await evaluate('window.__candidates');
  assert.equal(partial.candidates.find(c=>c.strategy==='coverage').visits.length,8);
  const supplementary=partial.candidates.find(c=>c.strategy==='supplementary_capture');
  assert.equal(supplementary.visits.length,4); assert.deepEqual(supplementary.assumed_completed_task_ids,['a']);
  assert.equal(supplementary.score.sample_coverage_percent,100);
  await click('[data-select-plan="supplementary_capture"]');
  assert.equal(await evaluate("document.querySelectorAll('[data-plan-visit]').length"),6);
  assert.ok(await evaluate("document.querySelector('.ws-plan-details').textContent.includes('完成声明：a')"));
  await shot('plans-partial-completion');
  await click('[data-select-plan="coverage"]');
  assert.equal(await evaluate("document.querySelectorAll('[data-route-visit]').length"),5);
  assert.ok(await evaluate("[...document.querySelectorAll('[data-route-visit]')].some(el=>el.textContent.includes('+'))"));
  await click('[data-plan-visit="5"]');
  assert.ok(await evaluate("document.querySelector('.ws-plan-map-point.is-selected')"));
  // Returned business states are displayed, with no route or adopt action for unavailable candidates.
  await evaluate(`window.fetch=async(...args)=>{if(!String(args[0]).endsWith('/missions/plan-candidates'))return window.__nativeFetch(...args);const r=structuredClone(window.__candidates);r.recommended_strategy=null;r.status='no_feasible_plan';r.candidates.forEach(c=>{c.status='budget_exceeded';c.path=null;c.score=null;c.reasons=['测试：计算预算耗尽']});return new Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}})}`);
  await button('重新生成方案'); await wait("document.querySelector('.ws-plan-details')?.textContent.includes('计算预算耗尽')");
  assert.equal(await evaluate("document.querySelectorAll('[data-route]').length"),0); await shot('plans-budget');
  await evaluate(`window.fetch=async(...args)=>{if(!String(args[0]).endsWith('/missions/plan-candidates'))return window.__nativeFetch(...args);const r=structuredClone(window.__candidates);r.status='blocked';r.recommended_strategy=null;r.candidates=[];r.reasons=['测试：场景规则阻止规划'];return new Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}})}`);
  await button('重新生成方案'); await wait("document.querySelector('.ws-plan-panel').textContent.includes('场景规则阻止规划')");
  assert.equal(await evaluate("document.querySelector('.ws-inspector')===null"),true); await shot('plans-blocked');
  await evaluate('window.fetch=window.__nativeFetch');
  await button('重新生成方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  await click('button[aria-label="关闭详情"]');
  // An in-flight response cannot restore candidates after parameters change.
  await send('Network.emulateNetworkConditions',{offline:false,latency:1200,downloadThroughput:-1,uploadThroughput:-1});
  await button('重新生成方案'); await input('[data-plan-setting=speed]','6');
  await evaluate('new Promise(r=>setTimeout(r,1600))');
  assert.equal(await evaluate("document.querySelectorAll('[data-select-plan]').length"),0);
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await button('生成候选方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  await button('任务'); await click('.ws-point-row'); await input('#ws-point-height','40'); await button('保存高度'); await click('button[aria-label="关闭详情"]');
  await button('方案'); assert.equal(await evaluate("document.querySelectorAll('[data-select-plan]').length"),0);
  await button('生成候选方案'); await wait("document.querySelectorAll('[data-select-plan]').length===3");
  await button('场景'); await input('#scene-height','0.6'); await button('方案');
  assert.equal(await evaluate("document.querySelectorAll('[data-select-plan]').length"),0);
  assert.ok(await evaluate("document.querySelector('.ws-plan-panel').textContent.includes('完成障碍检测')"));
  await evaluate("window.__beforeReload=true"); await send('Page.reload');
  await wait("!window.__beforeReload && document.querySelector('.ws-shell')"); await button('方案');
  assert.equal(await evaluate("document.querySelectorAll('[data-select-plan]').length"),0);
  assert.ok(await evaluate("document.querySelector('.ws-plan-panel').textContent.includes('理解任务')"));
  assert.deepEqual(page.errors,[]);
  console.log('F03 browser passed: real paired geometry, candidates, comparison, visits, draft choice, completion semantics, invalidation, stale responses, network retry, unavailable states and responsive views.');
} finally {
  page?.close(); await browser.send("Target.disposeBrowserContext", { browserContextId }); browser.close();
}
