import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { detectObstacles, createEnvironmentStore, useEnvironmentStore, selectSelectedObstacle } from "../node_modules/.tmp/environment-tests/environment.mjs";

const request = { point_cloud_file: "demo.pcd", cluster_tolerance: 0.1 };
const obstacle = { id: "obstacle-1", position: [1, 2, 3], size: [4, 5, 6], confidence: 0.8, obstacle_type: "unknown" };
const response = (obstacles = [obstacle], source = "simulated") => ({ result: {
  obstacles, source, detection_time: "2026-01-01T00:00:00Z", algorithm: "height_threshold_euclidean",
} });

test("HTTP client posts the contract; store exposes loading then success with exact provenance", async (t) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/point-cloud/detect-obstacles");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), request);
    await pending;
    return Response.json(response());
  });
  const store = createEnvironmentStore();
  assert.equal(store.getState().status, "idle");
  const work = store.getState().detect(request);
  assert.equal(store.getState().status, "loading");
  release();
  await work;
  assert.equal(store.getState().status, "success");
  assert.deepEqual(store.getState().result, response().result);
});

test("failure is not empty success; retry uses a snapshot of the failed request", async () => {
  const seen = [];
  const store = createEnvironmentStore(async value => {
    seen.push({ ...value });
    if (seen.length === 1) throw new Error("service unavailable");
    return response([], "real");
  });
  const input = { ...request };
  await store.getState().detect(input);
  input.point_cloud_file = "changed.pcd";
  assert.equal(store.getState().status, "error");
  assert.equal(store.getState().error, "service unavailable");
  assert.equal(store.getState().result, null);
  await store.getState().retry();
  assert.deepEqual(seen, [request, request]);
  assert.equal(store.getState().status, "success");
  assert.deepEqual(store.getState().result, response([], "real").result);
});

test("React hook consumes an isolated store with a selector without starting a request", () => {
  let calls = 0;
  const store = createEnvironmentStore(async () => { calls++; return response(); });
  function Consumer() {
    const status = useEnvironmentStore(state => state.status, store);
    const selected = useEnvironmentStore(selectSelectedObstacle, store);
    return `${status}:${selected === null ? "none" : selected.id}`;
  }
  assert.equal(renderToStaticMarkup(createElement(Consumer)), "idle:none");
  assert.equal(calls, 0);
});

test("selected-obstacle selector returns the current result object only", async () => {
  const store = createEnvironmentStore(async () => response());
  assert.equal(selectSelectedObstacle(store.getState()), null);
  await store.getState().detect(request);
  store.getState().selectObstacle("obstacle-1");
  assert.deepEqual(selectSelectedObstacle(store.getState()), obstacle);
  store.getState().reset();
  assert.equal(selectSelectedObstacle(store.getState()), null);
});

for (const status of [400, 403, 404, 413, 422, 500, 503]) {
  test(`HTTP ${status} remains an error, not an empty obstacle result`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(
      { detail: status === 422 ? [{ msg: "invalid parameter" }] : `failure ${status}` }, { status },
    ));
    const store = createEnvironmentStore();
    await store.getState().detect(request);
    assert.equal(store.getState().status, "error");
    assert.equal(store.getState().result, null);
    assert.equal(store.getState().error, status === 422
      ? "request: invalid parameter" : `failure ${status}`);
  });
}

for (const kind of ["network", "invalid JSON", "non-Error rejection"]) {
  test(`${kind} is visible and retry recovers`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      if (kind === "invalid JSON") return new Response("not JSON", { status: 200 });
      throw kind === "network" ? new TypeError("Failed to fetch") : null;
    });
    const store = createEnvironmentStore();
    await store.getState().detect(request);
    assert.equal(store.getState().status, "error");
    assert.ok(store.getState().error);
    assert.equal(store.getState().result, null);
    t.mock.method(globalThis, "fetch", async () => Response.json(response()));
    await store.getState().retry();
    assert.equal(store.getState().status, "success");
    assert.equal(store.getState().error, null);
  });
}

test("reset stays idle after the outstanding request finishes", async () => {
  const pending = deferred();
  const store = createEnvironmentStore(() => pending.promise);
  const states = [];
  const unsubscribe = store.subscribe(state => states.push(state.status));
  const work = store.getState().detect(request);
  store.getState().reset();
  pending.resolve(response());
  await work;
  unsubscribe();
  assert.deepEqual(states, ["loading", "idle"]);
  assert.equal(store.getState().result, null);
});

test("retry is a no-op outside error and stores are isolated", async () => {
  let calls = 0;
  const store = createEnvironmentStore(async () => { calls++; return response(); });
  const other = createEnvironmentStore();
  await store.getState().retry();
  assert.equal(calls, 0);
  await store.getState().detect(request);
  await store.getState().retry();
  assert.equal(calls, 1);
  assert.equal(other.getState().status, "idle");
});

const invalidPayloads = [
  null, [], {}, { result: null }, { result: [] }, { result: { obstacles: [] } },
  ...["source", "detection_time", "algorithm", "obstacles"].map(key => {
    const value = response(); delete value.result[key]; return value;
  }),
  ...["unknown", null, 1].map(source => response([], source)),
  ...["", "not-a-date", 123].map(detection_time => ({ result: { ...response().result, detection_time } })),
  ...["", null, 42].map(algorithm => ({ result: { ...response().result, algorithm } })),
  { result: { ...response().result, obstacles: {} } },
  ...[null, {}, { ...obstacle, id: "" }, { ...obstacle, id: 1 },
    { ...obstacle, position: [1, 2] }, { ...obstacle, position: [1, 2, 3, 4] },
    { ...obstacle, position: ["1", 2, 3] }, { ...obstacle, position: [null, 2, 3] },
    { ...obstacle, size: [-1, 2, 3] }, { ...obstacle, confidence: 1.1 },
    { ...obstacle, confidence: -0.1 }, { ...obstacle, confidence: "0.5" },
    { ...obstacle, obstacle_type: null },
  ].map(item => response([item])),
  response([obstacle, obstacle]),
];

for (const [index, payload] of invalidPayloads.entries()) {
  test(`malformed JSON response ${index} stays error, selectors are safe and retry recovers`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    const store = createEnvironmentStore();
    await store.getState().detect(request);
    assert.equal(store.getState().status, "error");
    assert.equal(store.getState().result, null);
    assert.match(store.getState().error, /Invalid point-cloud response/);
    assert.equal(selectSelectedObstacle(store.getState()), null);
    assert.doesNotThrow(() => store.getState().selectObstacle("obstacle-1"));
    await assert.rejects(detectObstacles(request), { name: "PointCloudResponseError" });
    t.mock.method(globalThis, "fetch", async () => Response.json(response([], "mock")));
    await store.getState().retry();
    assert.equal(store.getState().status, "success");
    assert.deepEqual(store.getState().result, response([], "mock").result);
  });
}

for (const token of ["1e400", "-1e400"]) {
  test(`non-finite JSON coordinate ${token} is rejected`, async (t) => {
    const raw = JSON.stringify(response()).replace('"position":[1,2,3]', `"position":[${token},2,3]`);
    t.mock.method(globalThis, "fetch", async () => new Response(raw));
    const store = createEnvironmentStore();
    await store.getState().detect(request);
    assert.equal(store.getState().status, "error");
    assert.equal(store.getState().result, null);
  });
}

for (const source of ["mock", "simulated", "real"]) {
  test(`valid ${source} response preserves fractional offset timestamp and additional fields`, async (t) => {
    const payload = response([{ ...obstacle, position: [-1, 0, 2], size: [0, 0, 0] }], source);
    payload.result.detection_time = "2026-10-03T12:00:00.123456+08:00";
    payload.result.future_field = "preserved";
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    assert.deepEqual(await detectObstacles(request), payload);
  });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("detect and retry while loading cannot submit a duplicate or replace the request", async () => {
  const pending = deferred();
  let calls = 0;
  const store = createEnvironmentStore(() => { calls++; return pending.promise; });
  const work = store.getState().detect(request);
  const duplicate = store.getState().detect({ point_cloud_file: "other.pcd" });
  const retry = store.getState().retry();
  pending.resolve(response());
  await Promise.all([work, duplicate, retry]);
  assert.equal(calls, 1);
});

for (const outcome of ["resolve", "reject"]) {
  test(`reset invalidates late ${outcome} even after a newer detection succeeds`, async () => {
    const old = deferred();
    let calls = 0;
    const store = createEnvironmentStore(() => ++calls === 1 ? old.promise : Promise.resolve(response([], "mock")));
    const work = store.getState().detect(request);
    store.getState().reset();
    assert.equal(store.getState().status, "idle");
    await store.getState().retry();
    assert.equal(calls, 1);
    await store.getState().detect(request);
    old[outcome](outcome === "resolve" ? response() : new Error("late error"));
    await work;
    assert.equal(store.getState().status, "success");
    assert.deepEqual(store.getState().result, response([], "mock").result);
  });
}

test("selection only accepts current IDs and never survives a new detection with reused IDs", async () => {
  const store = createEnvironmentStore(async () => response());
  store.getState().selectObstacle("obstacle-1");
  assert.equal(store.getState().selectedObstacleId, null);
  await store.getState().detect(request);
  store.getState().selectObstacle("obstacle-1");
  assert.equal(store.getState().selectedObstacleId, "obstacle-1");
  store.getState().selectObstacle("missing");
  assert.equal(store.getState().selectedObstacleId, null);
  store.getState().selectObstacle("obstacle-1");
  store.getState().selectObstacle(null);
  assert.equal(store.getState().selectedObstacleId, null);
  store.getState().selectObstacle("obstacle-1");
  const work = store.getState().detect(request);
  assert.equal(store.getState().selectedObstacleId, null);
  await work;
  assert.equal(store.getState().selectedObstacleId, null);
  store.getState().selectObstacle("obstacle-1");
  store.getState().reset();
  assert.equal(store.getState().selectedObstacleId, null);
  assert.equal(store.getState().result, null);
});


test("scene form preserves explicit parameters and rejects blank, invalid and unsafe integers", async () => {
  const { defaultSceneInput, sceneRequest } = await import("../node_modules/.tmp/environment-tests/environment.mjs");
  assert.deepEqual(sceneRequest(defaultSceneInput).request, { point_cloud_file: "demo.pcd", height_threshold: 0.5, min_points: 10, cluster_tolerance: 0.1 });
  for (const patch of [{ file: " " }, { height: "" }, { height: "-1" }, { height: "Infinity" }, { minPoints: "0" }, { minPoints: "1.5" }, { minPoints: "9007199254740992" }, { tolerance: "" }, { tolerance: "0.09" }, { tolerance: "NaN" }]) {
    const result = sceneRequest({ ...defaultSceneInput, ...patch });
    assert.equal(result.request, null); assert.ok(result.error);
  }
  assert.equal(sceneRequest({ ...defaultSceneInput, height: "0", minPoints: "1" }).error, null);
});

test("local obstacle projections preserve metres, negative coordinates and degenerate boxes", async () => {
  const { obstacleBounds, sceneBounds } = await import("../node_modules/.tmp/environment-tests/environment.mjs");
  const o = { id: "a", position: [-10, 20, 5], size: [4, 6, 2], confidence: 0.5, obstacle_type: "unknown" };
  assert.deepEqual(obstacleBounds(o, 1), { minimum: [-12, 17], maximum: [-8, 23] });
  assert.deepEqual(obstacleBounds(o, 2), { minimum: [-12, 4], maximum: [-8, 6] });
  const far = { ...o, position: [100, -20, 15], size: [0, 0, 0] };
  const b = sceneBounds([o, far], 1);
  assert.ok(b.minimum[0] < -12 && b.maximum[0] > 100 && b.minimum[1] < -20 && b.maximum[1] > 23);
  const zero = sceneBounds([far], 2);
  assert.ok(zero.minimum[0] < 100 && zero.maximum[0] > 100);
  assert.ok(sceneBounds([], 1));
  assert.equal(sceneBounds([{ ...o, position: [1e308, 0, 0], size: [1e308, 1, 1] }], 1), null);
  assert.equal(obstacleBounds({ ...o, position: [1e308, 0, 0], size: [1.7e308, 1, 1] }, 1), null);
});
