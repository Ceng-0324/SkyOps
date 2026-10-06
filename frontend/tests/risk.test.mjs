import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspace, createEnvironmentStore, demoGeometry, readWindRiskResult, simulateWindRisk, windRuleFacts } from '../node_modules/.tmp/workspace-tests/workspace.mjs';
const tree = {
    raw_input: '检查对象[A]；完成条件：影像', input_format: 'text', source_type: 'mock', boundary: 'draft', execution_authorized: false, status: 'parsed', unparsed_fragments: [], clarifications: [], definition: { version: 1, nodes: [{
                id: 'a', action: 'inspect', target: { kind: 'object', label: 'A', refs: ['A'] }, depends_on: [], completion_conditions: ['影像'], parent_id: null
            }] }
};
const detection = {
    source: 'mock', obstacles: [], algorithm: 'test', detection_time: '2026-10-03T00:00:00Z'
};
const rule = (speed) => ({ passed: speed < 8, checks: [{
            rule_id: 'hard-wind-speed', passed: speed < 8, reason: 'wind', evidence: [`wind_speed_mps=${speed}`, 'max_wind_speed_mps=8.0']
        }] });
const planning = {
    raw_user_input: tree.raw_input, scenario_id: 'shenzhen_nanshan_highrise_demo', scene: { ...demoGeometry, obstacle_detection: detection }, priority_task_ids: [], completed_task_ids: []
};
const plan = {
    strategy: 'coverage', status: 'feasible', task_order: ['a'], visits: [{
            task_id: 'a', target_ref: 'A', sample_index: 0, position: [10, 0, 2]
        }], assumed_completed_task_ids: [], path: { points: [[1, 1, 2], [10, 0, 2], [1, 1, 2]], distance_m: 18.1 }, score: {
        sample_coverage_percent: 100, estimated_duration_seconds: 14, proximity_risk: 0, time_score: .8, total: 94
    }, reasons: [], equivalent_to: null, execution_authorized: false
};
const baseline = {
    status: 'candidates', task_tree: tree, scenario_id: planning.scenario_id, rule_sources: { environment: 'mock' }, rule_evaluation: rule(5.2), reasons: [], clarifications: [], limitations: [], recommended_strategy: 'coverage', scene: planning.scene, effective_bounds: demoGeometry.bounds, source: 'simulated', execution_authorized: false, candidates: [plan, { ...plan, strategy: 'focused_observation' }]
};
const request = { planning_request: planning, selected_strategy: 'coverage', event: {
        id: 'wind-1', type: 'wind_change', source: 'simulated', timestamp: '2026-10-06T12:00:00.000Z', wind_speed_mps: 8
    } };
function response(req = request, base = baseline) {
    const unknown = req.event.wind_speed_mps === null;
    const passed = !unknown && req.event.wind_speed_mps < 8;
    const original = base.candidates.find(c => c.strategy === req.selected_strategy);
    return structuredClone({
        status: unknown ? 'needs_clarification' : 'simulated', baseline: base, selected_strategy: req.selected_strategy, event: req.event, rules_after: unknown ? null : rule(req.event.wind_speed_mps), projected: null, impact: {
            direct_task_ids: original.task_order, dependent_task_ids: [], rescheduled_task_ids: [], reasons: ['全场景影响']
        }, alternatives: [{
                strategy: 'continue_original', status: unknown ? 'requires_review' : passed ? 'eligible' : 'blocked', reasons: ['规则依据'], deferred_task_ids: passed ? [] : original.task_order, projected_plan: passed ? original : null, distance_delta_m: passed ? 0 : null, duration_delta_seconds: passed ? 0 : null, execution_authorized: false
            }, {
                strategy: 'pause_for_review', status: 'requires_review', reasons: ['人工确认'], deferred_task_ids: original.task_order, projected_plan: null, distance_delta_m: null, duration_delta_seconds: null, execution_authorized: false
            }], recommended_response: passed ? 'continue_original' : 'pause_for_review', reasons: unknown ? ['未知风速'] : [], limitations: ['模拟预演'], source: 'simulated', execution_authorized: false, requires_human_confirmation: true
    });
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}
function workspace(simulate = async (req, base) => response(req, base)) {
    const w = createWorkspace({
        parse: async () => ({ task_tree: tree }), generate: async () => structuredClone(baseline), simulateRisk: simulate, replan: async () => ({}), review: async () => ({})
    }, createEnvironmentStore(async () => ({ result: detection })));
    w.store.getState().setTaskInput(tree.raw_input);
    return w;
}
async function ready(w) {
    await w.store.getState().parse();
    await w.environment.getState().detect({ point_cloud_file: 'demo.pcd' });
    await w.store.getState().generate();
    w.store.getState().adoptStrategy('coverage');
    w.store.getState().setRiskInput({ wind: '8', unknown: false });
}
for (const speed of [8, 7.9, null])
    test(`wind client preserves semantics for ${speed}`, async (t) => {
        const req = structuredClone(request);
        req.event.wind_speed_mps = speed;
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            assert.equal(url, '/missions/simulate-risk');
            assert.deepEqual(JSON.parse(options.body), req);
            const data = response(req);
            data.event.timestamp = '2026-10-06T12:00:00Z';
            return Response.json(data);
        });
        const actual = await simulateWindRisk(req, baseline);
        assert.equal(actual.recommended_response, speed !== null && speed < 8 ? 'continue_original' : 'pause_for_review');
        assert.equal(actual.execution_authorized, false);
    });
const invalidCases = {
    authorization: r => r.execution_authorized = true, confirmation: r => r.requires_human_confirmation = false, event: r => r.event.id = 'other', wind: r => r.event.wind_speed_mps = 7, timestamp: r => r.event.timestamp = 'bad', source: r => r.event.source = 'real', strategy: r => r.selected_strategy = 'focused_observation', impact: r => r.impact.direct_task_ids = ['other'], dependent: r => r.impact.dependent_task_ids = ['a'], duplicate: r => r.alternatives[1] = r.alternatives[0], recommendation: r => r.recommended_response = 'continue_original', rule_consistency: r => r.rules_after.passed = true, rule_shape: r => r.rules_after.checks[0].evidence = null, pause_route: r => r.alternatives[1].projected_plan = plan, blocked_route: r => r.alternatives[0].projected_plan = plan, delta: r => r.alternatives[1].duration_delta_seconds = 0, deferred: r => r.alternatives[1].deferred_task_ids = [], future_event: r => r.projected = baseline
};
for (const [name, mutate] of Object.entries(invalidCases))
    test(`reject mismatched risk payload: ${name}`, () => {
        const data = response();
        mutate(data);
        assert.throws(() => readWindRiskResult(data, request, baseline));
    });
for (const change of ['route', 'geometry', 'rules', 'bounds', 'tasks'])
    test(`changed ${change} baseline requires regeneration`, () => {
        const r = response();
        if (change === 'route')
            r.baseline.candidates[0].path.distance_m = 99;
        if (change === 'geometry')
            r.baseline.scene.start = [0, 0, 0];
        if (change === 'rules')
            r.baseline.rule_evaluation = rule(4);
        if (change === 'bounds')
            r.baseline.effective_bounds.maximum[0] += 1;
        if (change === 'tasks')
            r.baseline.task_tree.definition.nodes[0].completion_conditions = ['changed'];
        assert.throws(() => readWindRiskResult(r, request, baseline), /基线已变化/);
    });
test('JSON key ordering does not change snapshot identity', () => {
    const r = response();
    r.baseline = Object.fromEntries(Object.entries(r.baseline).reverse());
    assert.doesNotThrow(() => readWindRiskResult(r, request, baseline));
});
test('rule evidence has no frontend threshold fallback', () => {
    assert.deepEqual(windRuleFacts(rule(5.2)), { speed: 5.2, threshold: 8 });
    assert.deepEqual(windRuleFacts(null), { speed: null, threshold: null });
    const r = rule(3);
    r.checks[0].evidence = ['wind_speed_mps=Infinity', 'max_wind_speed_mps='];
    assert.deepEqual(windRuleFacts(r), { speed: null, threshold: null });
});
test('risk waits for adoption and uses exact planning snapshot', async () => {
    let calls = 0;
    const w = workspace(async (req, base) => {
        calls++;
        assert.equal(req.selected_strategy, 'coverage');
        assert.deepEqual(req.planning_request, planning);
        assert.deepEqual(base, baseline);
        return response(req, base);
    });
    try {
        await w.store.getState().simulateRisk();
        await w.store.getState().parse();
        await w.environment.getState().detect({ point_cloud_file: 'demo.pcd' });
        await w.store.getState().generate();
        assert.equal(w.store.getState().adoptedStrategy, null);
        w.store.getState().setRiskInput({ wind: '8', unknown: false });
        await w.store.getState().simulateRisk();
        assert.equal(calls, 0);
        w.store.getState().adoptStrategy('coverage');
        await w.store.getState().simulateRisk();
        assert.equal(calls, 1);
        assert.equal(w.store.getState().risk.status, 'success');
    }
    finally {
        w.dispose();
    }
});
for (const mutation of ['wind', 'unknown', 'task', 'geometry', 'detection', 'completed', 'priority', 'adopt', 'regenerate', 'parse', 'reset', 'dispose'])
    for (const fail of [false, true])
        test(`${mutation} invalidates late risk ${fail ? 'failure' : 'success'}`, async () => {
            const pending = deferred();
            let req, base;
            const w = workspace((r, b) => {
                req = r;
                base = b;
                return pending.promise;
            });
            try {
                await ready(w);
                const work = w.store.getState().simulateRisk();
                const s = w.store.getState();
                if (mutation === 'wind')
                    s.setRiskInput({ wind: '7', unknown: false });
                if (mutation === 'unknown')
                    s.setRiskInput({ wind: '8', unknown: true });
                if (mutation === 'task')
                    s.setTaskInput('edited');
                if (mutation === 'geometry')
                    s.setGeometry({ ...demoGeometry, clearance_m: 1 });
                if (mutation === 'detection')
                    w.environment.getState().reset();
                if (mutation === 'completed' || mutation === 'priority')
                    s.setTaskFlag(mutation, 'a', true);
                if (mutation === 'adopt')
                    s.adoptStrategy('focused_observation');
                if (mutation === 'regenerate')
                    await s.generate();
                if (mutation === 'parse')
                    await s.parse();
                if (mutation === 'reset')
                    s.reset();
                if (mutation === 'dispose')
                    w.dispose();
                fail ? pending.reject(new Error('old error')) : pending.resolve(response(req, base));
                await work;
                assert.equal(w.store.getState().risk.status, mutation === 'dispose' ? 'loading' : 'idle');
            }
            finally {
                w.dispose();
            }
        });
test('duplicate guard, retry and workspace isolation', async () => {
    let calls = 0;
    const pending = deferred();
    const w = workspace(async (req, base) => {
        if (++calls === 1)
            return pending.promise;
        return response(req, base);
    });
    const other = workspace();
    try {
        await ready(w);
        const work = w.store.getState().simulateRisk();
        await w.store.getState().simulateRisk();
        assert.equal(calls, 1);
        pending.reject(new Error('offline'));
        await work;
        assert.equal(w.store.getState().risk.error, 'offline');
        await w.store.getState().simulateRisk();
        assert.equal(w.store.getState().risk.status, 'success');
        assert.equal(other.store.getState().risk.status, 'idle');
        w.dispose();
        w.connect();
        w.environment.getState().reset();
        assert.equal(w.store.getState().risk.status, 'idle');
    }
    finally {
        w.dispose();
        other.dispose();
    }
});
for (const wind of ['', ' ', '-1', 'Infinity', 'NaN'])
    test(`invalid wind ${JSON.stringify(wind)} never reaches server`, async () => {
        const w = workspace(() => assert.fail('invalid request'));
        try {
            await ready(w);
            w.store.getState().setRiskInput({ wind, unknown: false });
            await w.store.getState().simulateRisk();
            assert.equal(w.store.getState().risk.status, 'error');
        }
        finally {
            w.dispose();
        }
    });
test('unknown wind sends explicit null', async () => {
    const w = workspace(async (req, base) => {
        assert.equal(req.event.wind_speed_mps, null);
        return response(req, base);
    });
    try {
        await ready(w);
        w.store.getState().setRiskInput({ wind: '', unknown: true });
        await w.store.getState().simulateRisk();
        assert.equal(w.store.getState().risk.data.status, 'needs_clarification');
    }
    finally {
        w.dispose();
    }
});
