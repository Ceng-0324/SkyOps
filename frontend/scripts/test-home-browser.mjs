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
  await wait("document.querySelectorAll('.scenario').length === 4");
  assert.equal(await evaluate("document.querySelectorAll('.task').length"), 0, "No fabricated recent tasks");
  await layout(); await capture("desktop");
  await click('[data-template="building"] .scenario-footer button');
  await wait("document.querySelector('dialog[open]')");
  assert.equal(await evaluate("document.activeElement.id"), "create-heading");
  assert.equal(await evaluate("document.querySelector('#create-name').value"), "建筑外立面巡检");
  await capture("create-desktop");
  const bounds = await evaluate("(() => {const r=document.querySelector('.drawer-resizer').getBoundingClientRect();return{x:r.x+4,y:400}})()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...bounds, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: bounds.x - 110, y: bounds.y, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bounds.x - 110, y: bounds.y, button: "left", clickCount: 1 });
  assert.equal(await evaluate("Math.round(document.querySelector('dialog').getBoundingClientRect().width)"), 686);
  await evaluate("document.querySelector('.drawer-resizer').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home" });
  await wait("document.querySelector('.drawer-resizer').getAttribute('aria-valuenow') === '440'");
  await layout();
  await input("#create-name", "A 区验证任务");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "查看建筑巡检模板", "Focus returns to trigger");
  await click('[data-template="building"] .scenario-footer button');
  assert.equal(await evaluate("document.querySelector('#create-name').value"), "A 区验证任务", "Cancelled fields survive reopening");
  // Native modal tab traversal cannot reach the background.
  for (let i = 0; i < 12; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate("document.activeElement === document.body || !!document.activeElement.closest('dialog')"), true);
  }
  await click(".drawer-cancel");
  await click(".page-heading .primary-button");
  assert.equal(await evaluate("document.querySelector('.drawer-submit').disabled"), true);
  await input("#create-name", " "); await input("#create-goal", " ");
  assert.equal(await evaluate("document.querySelector('.drawer-submit').disabled"), true);
  await input("#create-name", "自定义验证任务"); await input("#create-goal", "检查目标建筑"); await input("#create-completion", "取得四面影像");
  await click(".drawer-submit");
  await wait("document.querySelector('section[aria-label=任务工作区] textarea')");
  assert.equal(await evaluate("document.querySelector('section[aria-label=任务工作区] textarea').value"), "检查目标建筑\n完成条件：取得四面影像");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('skyops.mission-drafts.v1')).drafts.length"), 1);
  await input('section[aria-label="任务工作区"] textarea', "修改后的任务\n完成条件：取得照片");
  await wait("JSON.parse(localStorage.getItem('skyops.mission-drafts.v1')).drafts[0].rawInput.includes('修改后的任务')");
  await click(".mission-entry-bar button");
  await wait("!document.querySelector('.ops-home').hidden");
  await click(".task-action");
  assert.equal(await evaluate("document.querySelector('section[aria-label=任务工作区] textarea').value"), "修改后的任务\n完成条件：取得照片");
  await evaluate("window.__beforeHomeReload = true");
  await send("Page.reload");
  await wait("!window.__beforeHomeReload && document.readyState === 'complete'");
  await wait("document.querySelector('section[aria-label=任务工作区] textarea')");
  assert.equal(await evaluate("document.querySelector('section[aria-label=任务工作区] textarea').value"), "修改后的任务\n完成条件：取得照片", "Reload resumes actual input");
  await click(".mission-entry-bar button");
  await input('.searchbox input', "不存在的任务");
  assert.equal(await evaluate("document.querySelectorAll('.scenario').length"), 0);
  await click(".gallery-empty button");
  await evaluate("[...document.querySelectorAll('.filter')].find(b=>b.textContent==='应急').click()");
  await wait("document.querySelectorAll('.scenario').length === 1");
  assert.equal(await evaluate("document.querySelector('.scenario-footer button') === null"), true, "Planned scenario cannot create a task");
  await evaluate("document.querySelector('.filter').click()");
  await viewport(390, 844); await layout(); await capture("mobile");
  await click(".source-credit summary"); await layout();
  assert.equal(await evaluate("document.querySelector('.source-panel').getBoundingClientRect().right <= innerWidth"), true);
  await click(".source-credit summary");
  await click('[data-template="campus"] .scenario-footer button');
  await layout(); await capture("create-mobile");
  assert.equal(await evaluate("document.querySelector('dialog').getBoundingClientRect().width"), 390);
  await click(".drawer-cancel");
  await viewport(1440, 900); await layout();
  await click('[data-template="mapping"] .scenario-footer button'); await layout(); await click(".drawer-cancel");
  // A failed save remains usable, with a visible persistence warning.
  await evaluate("Storage.prototype.setItem = function(){throw new DOMException('quota','QuotaExceededError')}");
  await click('[data-template="mapping"] .scenario-footer button'); await click(".drawer-submit");
  await wait("document.querySelector('.mission-entry-bar [role=alert]')");
  await click(".mission-entry-bar button");
  assert.equal(await evaluate("document.querySelectorAll('.task').length"), 2);
  // Corrupt prior storage is left untouched, including when a new in-memory draft is created.
  await evaluate("window.__beforeHomeReload = true");
  await send("Page.reload");
  await wait("!window.__beforeHomeReload && document.readyState === 'complete'"); await wait("document.querySelector('.page-heading')");
  await evaluate("localStorage.setItem('skyops.mission-drafts.v1','{broken')");
  await evaluate("window.__beforeHomeReload = true");
  await send("Page.reload");
  await wait("!window.__beforeHomeReload && document.readyState === 'complete'"); await wait("document.querySelector('.home-error')");
  await click('[data-template="building"] .scenario-footer button'); await click(".drawer-submit");
  await wait("document.querySelector('.mission-entry-bar')");
  assert.equal(await evaluate("localStorage.getItem('skyops.mission-drafts.v1')"), "{broken");
  assert.deepEqual(page.errors, []);
  console.log("Home browser passed: template/filter/search, modal focus and resize, validation, isolated drafts, workspace handoff, reload, responsive layouts, storage failure and corruption protection.");
} finally {
  page?.close(); await browser.send("Target.disposeBrowserContext", { browserContextId }); browser.close();
}
