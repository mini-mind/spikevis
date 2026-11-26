/**
 * 进入子图编辑测试(进子图轮新增):
 * - 成组 -> 进子图改内部(改参数/改名/加节点/连线/断线/删节点)-> 校验通过 -> 写出;
 *   由 tools/run_subgraph_checks.py 用官方库做同样的编辑并比对内容相等;
 * - 阴性对照:故意漏做子图内部的一处参数修改,对账脚本必须报出差异;
 * - 撤销/重做跨进子图编辑连续可用(undo 到底回初始文档,同一引用);
 * - 子图端口保护:内部 Input/Output 端口删除被拒绝(人话原因);剪枝传播
 *   改到端口 shape 被拒绝;根层 Input/Output 删除不受影响;
 * - 两层嵌套:组中组,在第二层改参数、第一层改名,导出官方读回比对相等;
 * - 多端口子图:导出闸门拦截(官方库实测读不回),本测试同时写出该文件供
 *   tools/run_subgraph_checks.py 用官方库验证"默认读回必失败";
 * - 视图层:buildViewDataAt 按层建视图、类型按全路径键;clampViewPath 夹失效路径;
 *   changedNamesAt 取局部脏名字;changedNodeNames 在根层把内部变过的组标脏。
 *
 * 编辑序列与 tools/reference_subgraph_edit.py 逐条对应。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changedNamesAt, changedNodeNames,
  createHistory, inferTypes, readNir, validateDocument, writeNir,
} from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { buildViewDataAt, clampViewPath } from '../src/io/nirIO.js';
import { getBackend, makeGraph, makeNode, num } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SRC = path.join(ROOT, 'test', 'complex_nir_test_model.nir');
const OUT_DIR = path.join(ROOT, 'test', 'output');

/** input(8) -> linear(4x8) -> scale(4) -> output(4),全空 metadata */
function chainDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [8]) }),
      linear: makeNode('Linear', { weight: num('f32', [4, 8], Array.from({ length: 32 }, (_, i) => i + 1)) }),
      scale: makeNode('Scale', { scale: num('f32', [4], [1, 2, 3, 4]) }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'linear'], ['linear', 'scale'], ['scale', 'output']]),
  };
}

async function loadComplex() {
  const backend = await getBackend();
  return readNir(fs.readFileSync(SRC), backend);
}

async function writeOut(doc, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const backend = await getBackend();
  const bytes = await writeNir(doc, backend);
  fs.writeFileSync(path.join(OUT_DIR, name), bytes);
  return bytes;
}

/**
 * complex 模型进子图编辑序列(与 reference_subgraph_edit.py 的 complex 部分对应):
 * 1. 顶层成组 threshold1+delay1 -> block(单入单出,端口 shape [256]);
 * 2. 进 block:setUniform threshold1.threshold = 0.75;
 * 3. 进 block:重命名 delay1 -> delay_gate;
 * 4. 进 block:新建 Delay 节点 delay_new(256 通道);
 * 5. 进 block:连 threshold1->delay_new、delay_new->delay_gate、delay_new->output(端口);
 * 6. 进 block:断开 delay_new->delay_gate;删 delay_gateway…… 即删 delay_gate(链保持完好)。
 * skipParam 为 true 时漏做第 2 步(阴性对照用)。
 */
async function runComplexSubgraphEdits(skipParam = false) {
  const doc = await loadComplex();
  const history = createHistory(doc);
  const steps = [
    { action: { kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'block' }, label: '编成一组 block' },
    ...(skipParam ? [] : [{ action: { kind: 'setUniform', path: ['block', 'threshold1'], field: 'threshold', value: 0.75 }, label: '修改 block 里 threshold1 的 threshold' }]),
    { action: { kind: 'rename', path: ['block'], oldName: 'delay1', newName: 'delay_gate' }, label: '重命名 block 里的 delay1 → delay_gate' },
    { action: { kind: 'addNode', path: ['block'], type: 'Delay', name: 'delay_new', shape: [256] }, label: '在 block 里新建节点 delay_new' },
    { action: { kind: 'connect', path: ['block'], src: 'threshold1', dst: 'delay_new' }, label: '连线 threshold1 → delay_new' },
    { action: { kind: 'connect', path: ['block'], src: 'delay_new', dst: 'delay_gate' }, label: '连线 delay_new → delay_gate' },
    { action: { kind: 'connect', path: ['block'], src: 'delay_new', dst: 'output' }, label: '连线 delay_new → output' },
    { action: { kind: 'disconnect', path: ['block'], src: 'delay_new', dst: 'delay_gate' }, label: '断开 delay_new → delay_gate' },
    { action: { kind: 'removeNode', path: ['block'], name: 'delay_gate', confirmed: true }, label: '删除节点 delay_gate' },
  ];
  for (const step of steps) {
    const { doc: next, label, warnings } = applyEditAction(history.current, step.action);
    assert.deepEqual(warnings, [], '本序列的编辑不应触发连通性预警');
    history.commit(next, label);
  }
  return { history, initialDoc: doc, finalDoc: history.current };
}

describe('进子图编辑(complex 模型,端到端导出)', () => {
  it('成组后进子图做参数/改名/增删/连线,校验通过并写出', async () => {
    const { history, initialDoc, finalDoc } = await runComplexSubgraphEdits(false);

    // 校验闸门:编辑结果必须是干净文档
    const v = validateDocument(finalDoc);
    assert.equal(v.ok, true, `编辑结果应通过校验: ${JSON.stringify(v.issues)}`);

    // 顶层读数:11 个节点(12-2+1)、10 条边;block 是子图
    assert.equal(Object.keys(finalDoc.graph.children).length, 11);
    assert.equal(finalDoc.graph.edgePairs.length, 10);
    const block = finalDoc.graph.children.block;
    assert.equal(block.type, 'NIRGraph');
    // 子图内部读数:threshold1(已改名留下)、delay_new 在;delay_gate 已删;
    // 内部链 input -> threshold1 -> delay_new -> output(端口)
    assert.deepEqual(Object.keys(block.children).sort(), ['delay_new', 'input', 'output', 'threshold1']);
    assert.deepEqual(
      block.edgePairs.map(([a, b]) => `${a}->${b}`),
      ['input->threshold1', 'threshold1->delay_new', 'delay_new->output'],
    );
    // 子图内部参数已改:threshold1.threshold 全部 0.75
    assert.deepEqual(Array.from(block.children.threshold1.fields.threshold.data), Array(256).fill(0.75));
    // 端口 shape 未被内部编辑动过(接口保持一致)
    assert.deepEqual(Array.from(block.children.input.fields.shape.data), [256n]);
    assert.deepEqual(Array.from(block.children.output.fields.shape.data), [256n]);

    // addNode 的 path 必须真的透传:delay_new 只能在 block 里,不能漏到根图
    assert.ok(!finalDoc.graph.children.delay_new, '子图内部新建的节点不得漏到根图');

    // 撤销到底应回到初始文档(引用相等),重做到底回到最终文档
    let back = history.current;
    let guard = 0;
    while (history.canUndo() && guard < 30) {
      back = history.undo();
      guard += 1;
    }
    assert.equal(back, initialDoc, 'undo 到底应回到初始文档(同一引用)');
    let fwd = back;
    guard = 0;
    while (history.canRedo() && guard < 30) {
      fwd = history.redo();
      guard += 1;
    }
    assert.equal(fwd, finalDoc, 'redo 到底应回到编辑后的文档(同一引用)');

    await writeOut(finalDoc, 'subgraph_edited.nir');
  });

  it('阴性对照:漏做子图内部的参数修改,写出用于"必须报差异"的文件', async () => {
    const { finalDoc } = await runComplexSubgraphEdits(true);
    const v = validateDocument(finalDoc);
    assert.equal(v.ok, true, '阴性对照文件本身仍应是干净文档');
    await writeOut(finalDoc, 'subgraph_edited_negative.nir');
  });
});

describe('两层嵌套(chain 合成模型,端到端导出)', () => {
  /**
   * 与 reference_subgraph_edit.py 的 nested 部分对应:
   * 1. linear+scale 成组 block;
   * 2. 根层加 LI 节点 li(4 通道),改接 block->li->output;
   * 3. block+li 再成组 outer(两层嵌套);
   * 4. 进第二层 ['outer','block']:linear.weight 整体 ×2;
   * 5. 在第一层 ['outer']:重命名 li -> li_gate。
   * skipScale 为 true 时漏做第 4 步(阴性对照用)。
   */
  async function runNestedEdits(skipScale = false) {
    let doc = chainDoc();
    const history = createHistory(doc);
    const steps = [
      { action: { kind: 'group', path: [], names: ['linear', 'scale'], name: 'block' } },
      { action: { kind: 'addNode', path: [], type: 'LI', name: 'li', shape: [4] } },
      { action: { kind: 'connect', path: [], src: 'block', dst: 'li' } },
      { action: { kind: 'disconnect', path: [], src: 'block', dst: 'output' } },
      { action: { kind: 'connect', path: [], src: 'li', dst: 'output' } },
      { action: { kind: 'group', path: [], names: ['block', 'li'], name: 'outer' } },
      ...(skipScale ? [] : [{ action: { kind: 'scaleField', path: ['outer', 'block', 'linear'], field: 'weight', factor: 2 } }]),
      { action: { kind: 'rename', path: ['outer'], oldName: 'li', newName: 'li_gate' } },
    ];
    for (const step of steps) {
      const { doc: next, warnings } = applyEditAction(history.current, step.action);
      assert.deepEqual(warnings, [], '嵌套序列不应触发连通性预警');
      history.commit(next, step.label || step.action.kind);
    }
    return { history, initialDoc: doc, finalDoc: history.current };
  }

  it('组中组:第二层改参数、第一层改名,校验通过并写出', async () => {
    const { finalDoc } = await runNestedEdits(false);
    const v = validateDocument(finalDoc);
    assert.equal(v.ok, true, `嵌套编辑应通过校验: ${JSON.stringify(v.issues)}`);

    // 根层:input -> outer -> output
    assert.deepEqual(Object.keys(finalDoc.graph.children).sort(), ['input', 'outer', 'output']);
    const outer = finalDoc.graph.children.outer;
    assert.equal(outer.type, 'NIRGraph');
    assert.deepEqual(Object.keys(outer.children).sort(), ['block', 'input', 'li_gate', 'output']);
    // 第二层:weight 已 ×2
    const w = outer.children.block.children.linear.fields.weight;
    assert.deepEqual(Array.from(w.data), Array.from({ length: 32 }, (_, i) => (i + 1) * 2));
    // 端口一致:outer 的输入端口 [8]、输出端口 [4]
    assert.deepEqual(Array.from(outer.children.input.fields.shape.data), [8n]);
    assert.deepEqual(Array.from(outer.children.output.fields.shape.data), [4n]);
    await writeOut(finalDoc, 'nested_edited.nir');
  });

  it('阴性对照:漏做第二层参数修改,写出用于"必须报差异"的文件', async () => {
    const { finalDoc } = await runNestedEdits(true);
    const v = validateDocument(finalDoc);
    assert.equal(v.ok, true);
    await writeOut(finalDoc, 'nested_edited_negative.nir');
  });
});

describe('子图端口保护', () => {
  it('删除子图内部 Input/Output 端口被拒绝,原因可读;根层删除不受影响', async () => {
    const doc = await loadComplex();
    const grouped = applyEditAction(doc, { kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'block' }).doc;
    assert.throws(
      () => applyEditAction(grouped, { kind: 'removeNode', path: ['block'], name: 'input', confirmed: true }),
      /端口|接口/,
      '删子图内部 Input 端口应被人话拒绝',
    );
    assert.throws(
      () => applyEditAction(grouped, { kind: 'removeNode', path: ['block'], name: 'output', confirmed: true }),
      /端口|接口/,
      '删子图内部 Output 端口应被人话拒绝',
    );
    // 根层 Input 删除仍允许(带连通性预警的确认流程)
    const removed = applyEditAction(doc, { kind: 'removeNode', path: [], name: 'input', confirmed: true });
    assert.equal(removed.applied, true);
  });

  it('子图内部剪枝传播改到端口 shape 被拒绝;不碰端口的剪枝可用', () => {
    // 链式组:input->linear->scale->output(端口),任何方向的剪枝都会传到端口
    const grouped = applyEditAction(chainDoc(), { kind: 'group', path: [], names: ['linear', 'scale'], name: 'block' }).doc;
    assert.throws(
      () => applyEditAction(grouped, { kind: 'pruneChannels', path: ['block', 'linear'], axis: 'out', keep: [0, 1] }),
      /端口/,
      '剪到子图端口的剪枝应被拒绝',
    );
    // 带侧枝的子图:input->a->output(端口),另有 b->c 死胡同;剪 b 不碰端口
    const branched = {
      version: '1.0.8',
      graph: makeGraph({
        input: makeNode('Input', { shape: num('i64', [1], [8]) }),
        blk: makeGraph({
          input: makeNode('Input', { shape: num('i64', [1], [8]) }),
          a: makeNode('Scale', { scale: num('f32', [8], Array(8).fill(1)) }),
          output: makeNode('Output', { shape: num('i64', [1], [8]) }),
          b: makeNode('Scale', { scale: num('f32', [4], [1, 2, 3, 4]) }),
          c: makeNode('Scale', { scale: num('f32', [4], [1, 2, 3, 4]) }),
        }, [['input', 'a'], ['a', 'output'], ['b', 'c']]),
        output: makeNode('Output', { shape: num('i64', [1], [8]) }),
      }, [['input', 'blk'], ['blk', 'output']]),
    };
    const pruned = applyEditAction(branched, { kind: 'pruneChannels', path: ['blk', 'b'], axis: 'out', keep: [0, 1] });
    assert.equal(pruned.applied, true, '不碰端口的子图内部剪枝应可用');
    assert.deepEqual(Array.from(pruned.doc.graph.children.blk.children.b.fields.scale.data), [1, 2]);
  });
});

describe('多端口子图的导出闸门', () => {
  it('两个内部 Output 的子图校验失败;写出的文件官方库默认读回必失败(文件供对账脚本核验)', async () => {
    // a(4)->m1(4)->out1;b(8)->m2(8)->out2;m1、m2 成组后组内各有自己的 output 端口
    const doc = {
      version: '1.0.8',
      graph: makeGraph({
        a: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        b: makeNode('Scale', { scale: num('f32', [8], Array(8).fill(1)) }),
        m1: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        m2: makeNode('Scale', { scale: num('f32', [8], Array(8).fill(1)) }),
        out1: makeNode('Output', { shape: num('i64', [1], [4]) }),
        out2: makeNode('Output', { shape: num('i64', [1], [8]) }),
      }, [['a', 'm1'], ['b', 'm2'], ['m1', 'out1'], ['m2', 'out2']]),
    };
    const grouped = applyEditAction(doc, { kind: 'group', path: [], names: ['m1', 'm2'], name: 'grp', confirmed: true }).doc;
    const v = validateDocument(grouped);
    assert.equal(v.ok, false, '多端口子图必须被校验拦截');
    assert.ok(v.issues.some((i) => i.kind === 'subgraph-ports'), '必须报 subgraph-ports 问题');
    // 推断也必须失败(与官方单端口假设一致)
    assert.throws(() => inferTypes(grouped));
    // 故意写出(绕过闸门,仅作对账素材):官方库默认读回必须失败,
    // 由 tools/run_subgraph_checks.py 核验——这就是闸门存在的原因
    await writeOut(grouped, 'multiport_gate.nir');
  });
});

describe('视图层(进入子图)', () => {
  it('buildViewDataAt 按层建视图,类型按全路径键;clampViewPath 夹失效路径', async () => {
    const doc = await loadComplex();
    const grouped = applyEditAction(doc, { kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'block' }).doc;
    const { types } = inferTypes(grouped);
    // 根层:看不到 block 内部的 threshold1
    const rootView = buildViewDataAt(grouped, [], types);
    assert.deepEqual(Object.keys(rootView.nodes).sort().includes('threshold1'), false);
    assert.ok(rootView.nodes.block);
    // block 层:threshold1 的输入类型来自全路径键 'block.threshold1'
    const innerView = buildViewDataAt(grouped, ['block'], types);
    assert.deepEqual(Object.keys(innerView.nodes).sort(), ['delay1', 'input', 'output', 'threshold1']);
    assert.equal(innerView.nodes.threshold1.inputText, '256');
    assert.equal(innerView.nodes.threshold1.outputText, '256');
    // 组内边顺序:成员间边在前,内部端口边在后(成组的确定性行为)
    assert.deepEqual(innerView.edges, [['threshold1', 'delay1'], ['input', 'threshold1'], ['delay1', 'output']]);
    // 夹路径:存在的路径原样,不存在的逐段截断
    assert.deepEqual(clampViewPath(grouped, ['block']), ['block']);
    assert.deepEqual(clampViewPath(grouped, ['block', 'nope']), ['block']);
    assert.deepEqual(clampViewPath(grouped, ['nope']), []);
  });

  it('changedNamesAt 取局部脏名字;changedNodeNames 在根层把内部变过的组标脏', async () => {
    const doc = await loadComplex();
    const grouped = applyEditAction(doc, { kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'block' }).doc;
    const edited = applyEditAction(grouped, { kind: 'setUniform', path: ['block', 'threshold1'], field: 'threshold', value: 0.75 }).doc;
    // 根层:threshold1 的改动要把 block 整体标脏
    const rootChanged = changedNodeNames(grouped, edited);
    assert.ok(rootChanged.has('block'), '内部改动的子图节点在根层应被标脏');
    assert.ok(!rootChanged.has('threshold1'), '根层不应出现子图内部的局部名');
    // block 层:局部名直接标在 threshold1 上
    const localChanged = changedNamesAt(grouped, edited, ['block']);
    assert.deepEqual([...localChanged], ['threshold1']);
    // 本会话新建的组:原文档没有这一层,整层都算改动
    const fresh = changedNamesAt(doc, grouped, ['block']);
    assert.ok(fresh.has('threshold1') && fresh.has('delay1'), '新建组里全部成员算改动');
    // 被撤销掉的层:返回空集
    assert.equal(changedNamesAt(edited, grouped, ['gone']).size, 0);
  });
});
