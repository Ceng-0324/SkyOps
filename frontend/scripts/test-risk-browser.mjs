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
  const button = async text => { await evaluate(`(() => { const b=[...document.querySelectorAll('.ws-root button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b || b.disabled)throw new Error('Missing button'); b.focus();b.click(); })()`); await evaluate("new Promise(r=>requestAnimationFrame(r))"); };
  const imageReady = async () => evaluate("Promise.all([...document.querySelectorAll('svg image')].map(el=>{const i=new Image();i.src=el.getAttribute('href');return i.decode()}))");
  const shot = async name => { await imageReady(); await capture(name); };
  const coordinates = async (x,y) => evaluate(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('[data-testid=reference-map]').getScreenCTM());return{x:p.x,y:p.y}})()`);
  const mapClick = async (x,y) => { const p=await coordinates(x,y); await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1}); await evaluate("new Promise(r=>requestAnimationFrame(r))"); };
  await evaluate(`window.__requests=[];window.__nativeFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.__nativeFetch(...args);if(String(args[0]).endsWith('/missions/plan-candidates')){window.__requests.push(JSON.parse(args[1].body));window.__candidates=await r.clone().json()}if(String(args[0]).endsWith('/missions/simulate-risk')){window.__riskRequest=JSON.parse(args[1].body);window.__riskResult=await r.clone().json()}return r}`);
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

  await button('风险');
  assert.equal(await evaluate('document.querySelector("#risk-run").disabled'),true,'Requires explicit adoption');
  await button('方案');
  const adopted=await evaluate("document.querySelector('[data-select-plan][aria-pressed=true]').dataset.selectPlan");
  await button('设为当前草案');
  const viewed=data.candidates.find(c=>c.strategy!==adopted && c.status==='feasible').strategy;
  await click(`[data-select-plan="${viewed}"]`);
  await button('风险');
  await input('#risk-wind','8');
  await button('开始预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议暂停复核')");
  await wait("document.querySelectorAll('.is-risk-affected').length === 4");
  assert.equal(await evaluate('window.__riskRequest.selected_strategy'),adopted,'Preview uses adopted draft rather than viewed candidate');
  assert.deepEqual(await evaluate('window.__riskRequest.planning_request'),request);
  await viewport(1440,900); await layout(); await shot('risk-desktop');
  await viewport(390,844); await layout(); await shot('risk-mobile-result');
  await button('事件设置'); await shot('risk-mobile-event');
  await button('空间影响'); await shot('risk-mobile-map');
  await viewport(1440,900);
  await click('[data-risk-visit="2"]');
  await wait("document.activeElement.dataset.routeVisit === '2'");
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-pressed")'),'true');
  await evaluate(`document.querySelector('#scene-projection').value='2';document.querySelector('#scene-projection').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait("document.querySelector('.ws-scene-canvas').getAttribute('aria-label').includes('XZ')");
  assert.ok(await evaluate("document.querySelectorAll('.is-risk-affected').length > 0"));
  await button('影像叠加');
  await click('button[aria-label="显示完整路线"]');
  for (const [label,key] of [['调整任务面板宽度','ArrowRight'],['调整预演结果宽度','ArrowLeft']]) {
    const selector=`[role="separator"][aria-label="${label}"]`;
    const before=await evaluate(`Number(document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow'))`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});
    assert.equal(await evaluate(`Number(document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow'))`),before+24);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  }
  const drag=await evaluate(`(()=>{const r=document.querySelector('[aria-label="调整预演结果宽度"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...drag});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...drag,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x-40,y:drag.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x-40,y:drag.y,button:'left',clickCount:1});
  assert.equal(await evaluate(`Number(document.querySelector('[aria-label="调整预演结果宽度"]').getAttribute('aria-valuenow'))`),364);
  await input('#risk-wind','7');
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"),0,'Editing clears influence rings');
  assert.ok(await evaluate("document.querySelector('.ws-risk-empty').textContent.includes('结果已失效')"));
  await button('重新预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('可考虑继续原方案')");
  await click('#risk-unknown');
  assert.equal(await evaluate("document.querySelector('#risk-wind').disabled"),true);
  await button('重新预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('缺少可用风速')");
  await click('#risk-unknown');await input('#risk-wind','-1');
  assert.equal(await evaluate("document.querySelector('#risk-run').disabled"),true);
  await input('#risk-wind','8');
  await evaluate(`window.__workingFetch=window.fetch;window.fetch=(...args)=>String(args[0]).endsWith('/missions/simulate-risk')?Promise.reject(new Error('模拟网络中断')):window.__workingFetch(...args)`);
  await button('重新预演');
  await wait("document.querySelector('.ws-risk-error')");
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"),0);
  await evaluate('window.fetch=window.__workingFetch');await button('重试预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议暂停复核')");
  // Hold a real response until after an input edit, then prove it cannot revive stale results.
  await evaluate(`window.fetch=async(...args)=>{const r=await window.__workingFetch(...args);if(String(args[0]).endsWith('/missions/simulate-risk')){await new Promise(resolve=>{window.__releaseRisk=resolve})}return r}`);
  await button('重新预演');await wait('window.__releaseRisk');
  await input('#risk-wind','6');await evaluate('window.__releaseRisk();window.fetch=window.__workingFetch');
  await evaluate('new Promise(r=>setTimeout(r,100))');
  assert.ok(await evaluate("document.querySelector('.ws-risk-empty').textContent.includes('结果已失效')"));
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"),0);
  // A changed backend baseline must never be presented against an adopted draft.
  await evaluate(`window.fetch=async(...args)=>{const r=await window.__workingFetch(...args);if(!String(args[0]).endsWith('/missions/simulate-risk'))return r;const data=await r.json();data.baseline.scene.start[0]+=1;return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})}`);
  await button('重新预演');
  await wait("document.querySelector('.ws-risk-error')?.textContent.includes('规划基线已变化')");
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"),0);
  await evaluate('window.fetch=window.__workingFetch');await button('重试预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('可考虑继续原方案')");
  for (const width of [1101,1100,768,390,320]) {
    await viewport(width,844);await layout();
    if(width<=1100)for(const region of ['事件设置','空间影响','预演结果']){await button(region);await layout();}
  }
  await button('事件设置');await input('#risk-wind','8');await button('重新预演');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议暂停复核')");
  await wait("document.activeElement.id === 'ws-risk-results'");
  await button('事件设置');await click('[data-risk-visit="1"]');
  await wait("document.activeElement.dataset.routeVisit === '1'");
  // Added-task preview reuses the same adopted draft and exposes actual backend comparisons.
  await viewport(1440,900);
  await button('新增任务');
  assert.equal(await evaluate("document.querySelector('#risk-run').disabled"),true);
  await input('#risk-completion','取得对象 A 四面的细节影像');
  await evaluate(`document.querySelector('.ws-risk-order').open=true`);
  await click('[data-risk-order="after"]');
  await click('#risk-run');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议比较重规划方案')");
  const added=await evaluate('window.__riskRequest');
  assert.equal(added.event.type,'task_added');
  assert.deepEqual(added.event.geometry,[]);
  assert.deepEqual(added.planning_request,request);
  assert.equal(added.selected_strategy,adopted);
  assert.equal(added.event.task.depends_on.length,1);
  await wait("document.querySelector('[data-route=comparison]') && document.querySelector('[data-route=primary]')");
  assert.ok(await evaluate("document.querySelector('.ws-risk-delta').textContent.includes('路径距离')"));
  await evaluate(`document.querySelector('.ws-panel-scroll').scrollTop=0;document.querySelector('.ws-risk-results').scrollTop=0;document.activeElement.blur()`);
  await shot('task-risk-desktop');
  await viewport(390,844);await layout();await button('预演结果');await shot('task-risk-mobile-result');
  await button('事件设置');await shot('task-risk-mobile-event');
  await button('空间影响');await shot('task-risk-mobile-map');
  await viewport(1440,900);
  await click('.ws-risk-route-switch label:nth-child(1) input');
  assert.equal(await evaluate("document.querySelectorAll('[data-route=comparison]').length"),0);
  await click('.ws-risk-route-switch label:nth-child(1) input');
  await click('.ws-risk-route-switch label:nth-child(2) input');
  assert.equal(await evaluate("document.querySelectorAll('[data-route=primary]').length"),0);
  const routeChecks = () => evaluate("[...document.querySelectorAll('.ws-risk-route-switch input')].map(e=>e.checked)");
  const selectedVisits = () => evaluate("[...document.querySelectorAll('.ws-risk-map [data-route-visit][aria-pressed=true]')].map(e=>e.dataset.routeIndices)");
  const originalLabel = await evaluate("document.querySelector('.ws-risk-map [data-route-visit=\"1\"]').getAttribute('aria-label')");
  await click('.ws-risk-map [data-route-visit="1"]');
  assert.deepEqual(await routeChecks(), [true, false], 'Original marker must not enable the preview');
  assert.deepEqual(await selectedVisits(), ['1']);
  assert.equal(await evaluate("document.querySelector('.ws-risk-map [data-route-visit=\"1\"]').getAttribute('aria-label')"), originalLabel);
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"), 0, 'Original visits must not acquire added-task influence');
  await click('.ws-risk-route-switch label:nth-child(2) input');
  assert.deepEqual(await selectedVisits(), [], 'Changing routes clears indices from the previous route');
  assert.ok(await evaluate("document.querySelectorAll('.is-risk-affected').length>0"));
  await click('.ws-risk-map [data-route-visit="1"]');
  assert.deepEqual(await routeChecks(), [true, true]);
  assert.ok((await selectedVisits()).length > 0);
  await click('.ws-risk-route-switch label:nth-child(2) input');
  assert.deepEqual(await selectedVisits(), [], 'Preview selection must not select the same index on the original');
  await click('.ws-risk-route-switch label:nth-child(1) input');
  assert.deepEqual(await routeChecks(), [false, false]);
  assert.equal(await evaluate("document.querySelectorAll('.ws-risk-map [data-route-visit]').length"), 0);
  await button('在地图中查看');
  assert.deepEqual(await routeChecks(), [false, true], 'Explicit sidebar navigation reveals the preview');
  assert.ok((await selectedVisits()).length > 0);
  await click('.ws-risk-route-switch label:nth-child(1) input');
  await input('#risk-completion','新的完成条件');
  assert.equal(await evaluate("document.querySelectorAll('[data-route=comparison]').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.is-risk-affected').length"),0);
  await evaluate(`document.querySelectorAll('.ws-risk-order')[1].open=true`);
  await click('[data-risk-order="before"]');
  assert.ok(await evaluate("document.querySelector('#risk-task-error').textContent.includes('循环')"));
  assert.equal(await evaluate("document.querySelector('#risk-run').disabled"),true);
  await click('[data-risk-order="before"]');
  const select=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await evaluate('new Promise(r=>requestAnimationFrame(r))')};
  await select('#risk-target','new');await input('#risk-new-target','D');
  for(const [axis,value] of [['X','120'],['Y','40'],['Z','0']])await input(`[aria-label="观察点 1 ${axis}"]`,value);
  await input('[aria-label="观察点 1 X"]','9999');
  assert.ok(await evaluate("document.querySelector('#risk-task-error').textContent.includes('超出')"));
  await input('[aria-label="观察点 1 X"]','120');await click('#risk-run');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议比较重规划方案')");
  assert.deepEqual(await evaluate('window.__riskRequest.event.geometry'),[{ref:'D',observation_points:[[120,40,0]]}]);
  // Put the new target first so the same ordinal identifies different tasks.
  await click('[data-risk-order="after"]');
  await click('[data-risk-order="before"]');
  await click('#risk-run');
  await wait("document.querySelector('.ws-risk-conclusion')?.textContent.includes('建议比较重规划方案')");
  const reordered = await evaluate("window.__riskResult.alternatives.find(a=>a.strategy==='replan').projected_plan");
  const original = data.candidates.find(c=>c.strategy===adopted);
  assert.notEqual(reordered.visits[0].task_id, original.visits[0].task_id, 'Fixture must change the task at visit 1');
  await click('.ws-risk-map [data-route-visit="1"]');
  assert.ok(await evaluate("document.querySelector('.ws-risk-map [data-route-visit=\"1\"]').classList.contains('is-risk-affected')"));
  await click('.ws-risk-route-switch label:nth-child(2) input');
  assert.deepEqual(await selectedVisits(), []);
  await click('.ws-risk-map [data-route-visit="1"]');
  assert.deepEqual(await routeChecks(), [true, false]);
  assert.deepEqual(await selectedVisits(), ['1']);
  assert.equal(await evaluate("document.querySelector('.ws-risk-map [data-route-visit=\"1\"]').classList.contains('is-risk-affected')"), false);
  assert.equal(await evaluate("document.querySelector('.ws-risk-map [data-route-visit=\"1\"]').getAttribute('aria-label')"), originalLabel);
  await click('.ws-risk-route-switch label:nth-child(2) input');
  assert.deepEqual(await selectedVisits(), []);
  // A response for an edited event must not restore either route or comparison.
  await evaluate(`window.fetch=async(...args)=>{const r=await window.__workingFetch(...args);if(String(args[0]).endsWith('/missions/simulate-risk'))await new Promise(resolve=>window.__releaseAdded=resolve);return r}`);
  await click('#risk-run');await wait('window.__releaseAdded');
  await button('风速变化');await evaluate('window.__releaseAdded();window.fetch=window.__workingFetch');
  await evaluate('new Promise(r=>setTimeout(r,100))');
  assert.equal(await evaluate("document.querySelectorAll('.ws-risk-delta').length"),0);
  await button('新增任务');
  for(const width of [1101,1100,768,390,320]){await viewport(width,844);await layout();if(width<=1100)for(const region of ['事件设置','空间影响','预演结果']){await button(region);await layout();}}
  assert.deepEqual(page.errors,[]);
  console.log('Risk browser regression passed: added targets, dependencies, comparison toggles, task edits and event switching; adoption, wind boundaries, stale responses, retry, baseline mismatch, map selection, resizing and responsive layouts.');
} finally {
  page?.close(); await browser.send('Target.disposeBrowserContext', { browserContextId }); browser.close();
}
