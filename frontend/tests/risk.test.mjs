import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspace, createEnvironmentStore, demoGeometry, readWindRiskResult, windRuleFacts, simulateRisk, readTaskRiskResult, taskProjection, buildTaskRiskEvent, emptyTaskRiskInput } from '../node_modules/.tmp/workspace-tests/workspace.mjs';
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
        const actual = await simulateRisk(req, baseline);
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

const taskInput = { ...emptyTaskRiskInput(), targetRef: 'A', completion: '取得细节影像', after: ['a'] };
const addedRequest = { ...request, event: buildTaskRiskEvent(taskInput, planning, baseline) };
function addedResponse(req = addedRequest, base = baseline, state = 'feasible') {
    const expanded = taskProjection(req, base);
    const projected = structuredClone(base);
    projected.scene = expanded.scene;
    projected.task_tree.raw_input = expanded.raw_user_input;
    projected.task_tree.input_format = 'json';
    projected.task_tree.definition = JSON.parse(expanded.raw_user_input);
    projected.candidates = [structuredClone(base.candidates[0])];
    const p = projected.candidates[0];
    p.task_order.push(req.event.task.id);
    p.visits.push({ ...p.visits[0], task_id: req.event.task.id });
    p.path.distance_m += 12; p.score.estimated_duration_seconds += 11;
    const ok = state === 'feasible';
    if (!ok) {
        p.status = state === 'budget_exceeded' ? 'budget_exceeded' : 'infeasible';
        p.path = null; p.score = null; p.task_order = []; p.visits = [];
        projected.recommended_strategy = null;
        projected.status = state === 'needs_clarification' ? state : state === 'blocked' ? state : 'no_feasible_plan';
        if (state === 'needs_clarification') projected.task_tree.status = 'needs_clarification';
        if (state === 'needs_clarification' || state === 'blocked') { projected.effective_bounds = null; projected.candidates = []; }
        if (state === 'blocked') projected.rule_evaluation = rule(8);
    }
    const alt = (strategy, status, deferred) => ({ strategy, status, reasons: ['依据'], deferred_task_ids: deferred,
        projected_plan: null, distance_delta_m: null, duration_delta_seconds: null, execution_authorized: false });
    const pending = [...base.candidates[0].task_order, req.event.task.id];
    const replan = alt('replan', ok ? 'eligible' : state === 'needs_clarification' ? 'requires_review' : state, ok ? [] : pending);
    if (ok) Object.assign(replan, { projected_plan: p, distance_delta_m: 12, duration_delta_seconds: 11 });
    return structuredClone({ status: state === 'needs_clarification' ? state : 'simulated', baseline: base, projected,
        selected_strategy: req.selected_strategy, event: req.event, rules_after: projected.rule_evaluation,
        impact: { direct_task_ids: [req.event.task.id], dependent_task_ids: [], rescheduled_task_ids: [], reasons: [] },
        alternatives: [alt('continue_original','blocked',[req.event.task.id]), alt('pause_for_review','requires_review',pending), replan],
        recommended_response: ok ? 'replan' : 'pause_for_review', reasons: [], limitations: [], source: 'simulated',
        execution_authorized: false, requires_human_confirmation: true });
}
for (const state of ['feasible', 'infeasible', 'budget_exceeded', 'blocked', 'needs_clarification']) {
    test(`added task client accepts ${state} without inventing a route`, async t => {
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            assert.equal(url, '/missions/simulate-risk');
            assert.deepEqual(JSON.parse(options.body), addedRequest);
            return Response.json(addedResponse(addedRequest, baseline, state));
        });
        const result = await simulateRisk(addedRequest, baseline);
        assert.equal(result.alternatives[2].projected_plan !== null, state === 'feasible');
    });
}
const addedInvalid = {
    auth: r => r.execution_authorized = true,
    event: r => r.event.task.completion_conditions = ['other'],
    timestamp: r => r.event.timestamp = 'invalid',
    baseline: r => r.baseline.scene.start[0]++,
    geometry: r => r.projected.scene.targets[0].observation_points[0][0]++,
    dsl: r => r.projected.task_tree.raw_input = '{}',
    tasks: r => r.projected.task_tree.definition.nodes[0].completion_conditions = ['changed'],
    rule: r => r.rules_after.passed = false,
    impact: r => r.impact.dependent_task_ids = ['a'],
    ordering: r => r.impact.rescheduled_task_ids = ['a'],
    recommendation: r => r.recommended_response = 'continue_original',
    missing_alternative: r => r.alternatives.pop(),
    false_delta: r => r.alternatives[2].distance_delta_m = 0,
    pause_route: r => r.alternatives[1].projected_plan = plan,
    fake_visit: r => r.projected.candidates[0].visits[1].position[0]++,
    unknown_task: r => r.projected.candidates[0].task_order.push('other'),
    completed: r => r.projected.candidates[0].assumed_completed_task_ids = ['a'],
    no_new_task: r => r.projected.candidates[0].task_order.pop(),
};
for (const [name, mutate] of Object.entries(addedInvalid)) test(`added task rejects ${name}`, () => {
    const value = addedResponse(); mutate(value);
    assert.throws(() => readTaskRiskResult(value, addedRequest, baseline));
});
test('task form reuses existing geometry and never mutates baseline', () => {
    const original = structuredClone(planning);
    const event = buildTaskRiskEvent(taskInput, planning, baseline);
    assert.deepEqual(event.geometry, []); assert.deepEqual(event.task.depends_on, ['a']);
    assert.deepEqual(planning, original);
});
const invalidInputs = {
    completion: { completion: '' }, target: { targetRef: 'missing' },
    unknown_dependency: { after: ['missing'] }, cycle: { before: ['a'] },
    duplicate_dependency: { after: ['a','a'] }, long_completion: { completion: 'x'.repeat(513) },
    duplicate_target: { targetMode: 'new', newTarget: 'A', points: [['1','1','2']] },
    empty_point: { targetMode: 'new', newTarget: 'D', points: [['','1','2']] },
    nan_point: { targetMode: 'new', newTarget: 'D', points: [['NaN','1','2']] },
    bounds: { targetMode: 'new', newTarget: 'D', points: [['9999','1','2']] },
    duplicate_points: { targetMode: 'new', newTarget: 'D', points: [['1','1','2'],['1.0','1','2']] },
};
for (const [name, change] of Object.entries(invalidInputs)) test(`invalid added input ${name} is rejected`, () => {
    assert.throws(() => buildTaskRiskEvent({ ...taskInput, ...change }, planning, baseline));
});
test('new target coordinates preserve Z and explicit units', () => {
    const event = buildTaskRiskEvent({ ...taskInput, targetMode:'new', newTarget:'D', points:[['6','6','2']] }, planning, baseline);
    assert.deepEqual(event.geometry, [{ref:'D', observation_points:[[6,6,2]]}]);
});
test('transitive dependency cycle and completed descendant are rejected', () => {
    const base = structuredClone(baseline);
    base.task_tree.definition.nodes.push({ ...base.task_tree.definition.nodes[0], id:'b', depends_on:['a'] });
    assert.throws(() => buildTaskRiskEvent({ ...taskInput, after:['b'], before:['a'] }, planning, base), /循环/);
    assert.throws(() => buildTaskRiskEvent({ ...taskInput, after:[], before:['a'] }, { ...planning, completed_task_ids:['b'] }, base), /已声明完成/);
});
for (const mutation of ['event_type','task_fields','geometry','adopt']) for (const fail of [false,true]) {
    test(`added task ${mutation} isolates late ${fail?'error':'success'}`, async () => {
        const pending=deferred(); const w=workspace(()=>pending.promise);
        try {
            await ready(w); w.store.getState().setRiskEventType('task_added');
            w.store.getState().setTaskRiskInput(taskInput);
            const run=w.store.getState().simulateRisk();
            assert.equal(w.store.getState().risk.status,'loading');
            if(mutation==='event_type')w.store.getState().setRiskEventType('wind_change');
            if(mutation==='task_fields')w.store.getState().setTaskRiskInput({...taskInput,completion:'新条件'});
            if(mutation==='geometry')w.store.getState().setGeometry({...demoGeometry,clearance_m:1});
            if(mutation==='adopt')w.store.getState().adoptStrategy('focused_observation');
            fail?pending.reject(new Error('offline')):pending.resolve(addedResponse());await run;
            assert.equal(w.store.getState().risk.status,'idle');
        }finally{w.dispose();}
    });
}
test('invalid task input never calls server', async () => {
    const w=workspace(()=>assert.fail('invalid request'));
    try{await ready(w);w.store.getState().setRiskEventType('task_added');await w.store.getState().simulateRisk();assert.equal(w.store.getState().risk.status,'error');}finally{w.dispose();}
});

test('added task accepts different completion credits across candidate strategies', () => {
    const req=structuredClone(addedRequest),base=structuredClone(baseline);
    req.planning_request.completed_task_ids=['a'];
    base.candidates.push({...structuredClone(base.candidates[0]),strategy:'supplementary_capture',status:'no_remaining_tasks',task_order:[],visits:[],path:null,score:null,assumed_completed_task_ids:['a']});
    const r=addedResponse(req,base);const p=structuredClone(r.projected.candidates[0]);
    p.strategy='supplementary_capture';p.assumed_completed_task_ids=['a'];p.task_order=[req.event.task.id];p.visits=p.visits.filter(v=>v.task_id===req.event.task.id);
    r.projected.candidates.push(p);
    assert.doesNotThrow(()=>readTaskRiskResult(r,req,base));
});
