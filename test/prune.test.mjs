/**
 * 通道剪枝测试:
 * - 正向:线性层(行/列)、神经元层(参数联动+分叉)、卷积层(输入通道/输出通道);
 * - 反向:下标越界、汇合处下标不一致、遇 Flatten 停下并报告、裁完其余字段 dtype 不变;
 * - 计划/预览结构与文档不可变性。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPruneChannels, channelInfo, planPruneChannels, validateDocument,
} from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { assertDocsEqual, makeGraph, makeNode, num, strVal } from './helpers.mjs';

function snapshot(doc) {
  return structuredClone(doc);
}

/** input(8) -> linear(w[4,8]) -> output(4) */
function linearDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [8]) }),
      linear: makeNode('Linear', { weight: num('f32', [4, 8], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'linear'], ['linear', 'output']]),
  };
}

/** input(4) -> lif(4) -> (li(4) -> output(4) 和 lif2(4) -> output2(4)) 分叉 */
function neuronDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [4]) }),
      lif: makeNode('LIF', {
        tau: num('f32', [4], [1, 2, 3, 4]),
        r: num('f32', [4], [1, 1, 1, 1]),
        v_leak: num('f32', [4], [0, 0, 0, 0]),
        v_threshold: num('f32', [4], [1, 1, 1, 1]),
        v_reset: num('f32', [4], [0, 0, 0, 0]),
      }),
      li: makeNode('LI', {
        tau: num('f32', [4], [5, 6, 7, 8]),
        r: num('f32', [4], [2, 2, 2, 2]),
        v_leak: num('f32', [4], [0, 0, 0, 0]),
      }),
      lif2: makeNode('LIF', {
        tau: num('f32', [4], [9, 10, 11, 12]),
        r: num('f32', [4], [3, 3, 3, 3]),
        v_leak: num('f32', [4], [0, 0, 0, 0]),
        v_threshold: num('f32', [4], [1, 1, 1, 1]),
        v_reset: num('f32', [4], [0, 0, 0, 0]),
      }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
      output2: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'lif'], ['lif', 'li'], ['lif', 'lif2'], ['li', 'output'], ['lif2', 'output2']]),
  };
}

/** input([2,8,8]) -> conv2d(w[3,2,3,3],bias[3],groups 可调) -> avgpool -> output([3,2,2]) */
function conv2dDoc(groups = 1) {
  const weight = [];
  for (let i = 0; i < 3 * 2 * 3 * 3; i += 1) weight.push(i + 1);
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [3], [2, 8, 8]) }),
      conv: makeNode('Conv2d', {
        weight: num('f32', [3, 2, 3, 3], weight),
        stride: num('i64', [2], [1, 1]),
        padding: strVal('valid'),
        dilation: num('i64', [2], [1, 1]),
        groups: num('i64', [], [groups]),
        bias: num('f32', [3], [0.5, 0.5, 0.5]),
      }),
      pool: makeNode('AvgPool2d', {
        kernel_size: num('i64', [2], [2, 2]),
        stride: num('i64', [2], [2, 2]),
        padding: num('i64', [2], [0, 0]),
      }),
      output: makeNode('Output', { shape: num('i64', [3], [3, 2, 2]) }),
    }, [['input', 'conv'], ['conv', 'pool'], ['pool', 'output']]),
  };
}

/** input([2,10]) -> conv1d(w[4,2,3],bias[4]) -> output([4,8]) */
function conv1dDoc() {
  const weight = [];
  for (let i = 0; i < 4 * 2 * 3; i += 1) weight.push(i + 1);
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [2], [2, 10]) }),
      conv: makeNode('Conv1d', {
        input_shape: num('i64', [], [10]),
        weight: num('f32', [4, 2, 3], weight),
        stride: num('i64', [], [1]),
        padding: strVal('valid'),
        dilation: num('i64', [], [1]),
        groups: num('i64', [], [1]),
        bias: num('f32', [4], [1, 1, 1, 1]),
      }),
      output: makeNode('Output', { shape: num('i64', [2], [4, 8]) }),
    }, [['input', 'conv'], ['conv', 'output']]),
  };
}

/** input([2,4,4]) -> flatten -> threshold(32) -> output(32):Flatten 是传播阻停点 */
function flattenDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [3], [2, 4, 4]) }),
      flatten: makeNode('Flatten', {
        start_dim: num('i64', [], [0]),
        end_dim: num('i64', [], [-1]),
      }),
      threshold: makeNode('Threshold', { threshold: num('f32', [32], Array(32).fill(1)) }),
      output: makeNode('Output', { shape: num('i64', [1], [32]) }),
    }, [['input', 'flatten'], ['flatten', 'threshold'], ['threshold', 'output']]),
  };
}

describe('通道剪枝:线性层', () => {
  it('正向:裁输出通道=裁权重行,下游 Output 的 shape 联动', () => {
    const doc = linearDoc();
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['linear'], axis: 'out', keep: [1, 3] }]);
    assert.equal(plan.ok, true);
    assert.deepEqual(next.graph.children.linear.fields.weight.shape, [2, 8]);
    // 行 1、3 的数据:权重按行主序 [4,8],新第 0 行 = 原第 1 行 (9..16),新第 1 行 = 原第 3 行 (25..32)
    assert.deepEqual(Array.from(next.graph.children.linear.fields.weight.data), [9, 10, 11, 12, 13, 14, 15, 16, 25, 26, 27, 28, 29, 30, 31, 32]);
    assert.deepEqual(Array.from(next.graph.children.output.fields.shape.data), [2n]);
    assert.deepEqual(Array.from(next.graph.children.input.fields.shape.data), [8n], '上游不受裁输出通道影响');
    const v = validateDocument(next);
    assert.equal(v.ok, true, `裁后应通过校验: ${JSON.stringify(v.issues)}`);
  });

  it('正向:裁输入通道=裁权重列,上游 Input 的 shape 联动', () => {
    const doc = linearDoc();
    const { doc: next } = applyPruneChannels(doc, [{ path: ['linear'], axis: 'in', keep: [0, 2, 4, 6] }]);
    assert.deepEqual(next.graph.children.linear.fields.weight.shape, [4, 4]);
    // 列 0、2、4、6:第 r 行取原 [r*8+0, r*8+2, r*8+4, r*8+6]
    assert.deepEqual(Array.from(next.graph.children.linear.fields.weight.data), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
    assert.deepEqual(Array.from(next.graph.children.input.fields.shape.data), [4n]);
    assert.deepEqual(Array.from(next.graph.children.output.fields.shape.data), [4n], '下游不受裁输入通道影响');
    const v = validateDocument(next);
    assert.equal(v.ok, true, `裁后应通过校验: ${JSON.stringify(v.issues)}`);
  });

  it('channelInfo 给出方向说明与通道数', () => {
    const doc = linearDoc();
    const info = channelInfo(doc, ['linear']);
    assert.equal(info.kind, 'weight');
    assert.equal(info.inWidth, 8);
    assert.equal(info.outWidth, 4);
    const io = channelInfo(doc, ['input']);
    assert.equal(io.kind, 'tied');
    assert.equal(io.outWidth, 8);
  });
});

describe('通道剪枝:神经元层(参数联动 + 分叉)', () => {
  it('正向:剪 lif 保留 [0,2],上游/下游/分叉全部联动', () => {
    const doc = neuronDoc();
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [0, 2] }]);
    assert.equal(plan.ok, true);
    const lif = next.graph.children.lif.fields;
    assert.deepEqual(lif.tau.shape, [2]);
    assert.deepEqual(Array.from(lif.tau.data), [1, 3], 'tau 按下标裁');
    assert.deepEqual(lif.r.shape, [2]);
    assert.deepEqual(Array.from(lif.v_threshold.data), [1, 1]);
    // 分叉:所有下游都裁
    assert.deepEqual(next.graph.children.li.fields.tau.shape, [2]);
    assert.deepEqual(Array.from(next.graph.children.li.fields.tau.data), [5, 7]);
    assert.deepEqual(next.graph.children.lif2.fields.r.shape, [2]);
    // 两个 Output 都联动
    assert.deepEqual(Array.from(next.graph.children.output.fields.shape.data), [2n]);
    assert.deepEqual(Array.from(next.graph.children.output2.fields.shape.data), [2n]);
    // 上游 Input 联动
    assert.deepEqual(Array.from(next.graph.children.input.fields.shape.data), [2n]);
    const v = validateDocument(next);
    assert.equal(v.ok, true, `裁后应通过校验: ${JSON.stringify(v.issues)}`);
    // 计划里列出全部被裁节点
    const names = new Set(plan.pruned.map((p) => p.name));
    for (const n of ['lif', 'li', 'lif2', 'input', 'output', 'output2']) {
      assert.ok(names.has(n), `计划应包含 ${n}`);
    }
  });

  it('反向:神经元参数首维与通道数不一致时拒绝', () => {
    const doc = neuronDoc();
    doc.graph.children.lif.fields.tau = num('f32', [3], [1, 2, 3]); // 故意弄坏
    assert.throws(
      () => applyPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [0] }]),
      /不一致/,
    );
  });
});

describe('通道剪枝:卷积层', () => {
  it('正向 Conv2d 裁输出通道:weight 第 0 维 + bias,下游池化停下并列入人工清单', () => {
    const doc = conv2dDoc();
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['conv'], axis: 'out', keep: [0, 2] }]);
    assert.equal(plan.ok, true);
    assert.deepEqual(next.graph.children.conv.fields.weight.shape, [2, 2, 3, 3]);
    assert.deepEqual(next.graph.children.conv.fields.bias.shape, [2]);
    // 池化是约定的阻停点:不裁它,列入人工清单,不再往下传
    const manualNames = plan.manual.map((m) => m.name);
    assert.deepEqual(manualNames, ['pool'], '传播应在池化停下');
    assert.ok(plan.manual[0].reason.includes('人工'));
    // output 不被改动(等人工确认)
    assert.deepEqual(Array.from(next.graph.children.output.fields.shape.data), [3n, 2n, 2n]);
    assert.ok(!('v_reset' in next.graph.children.conv.fields));
    // stride/padding 等其余字段原样
    assert.deepEqual(Array.from(next.graph.children.conv.fields.stride.data), [1n, 1n]);
  });

  it('正向 Conv1d 裁输入通道:weight 第 1 维,上游 Input 联动,校验通过', () => {
    const doc = conv1dDoc();
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['conv'], axis: 'in', keep: [1] }]);
    assert.equal(plan.ok, true);
    assert.deepEqual(next.graph.children.conv.fields.weight.shape, [4, 1, 3]);
    // 权重按 [out, in, k] 行主序:裁输入通道下标 1 = 每个 out 取它第 1 个输入通道的 3 个核元素
    assert.deepEqual(Array.from(next.graph.children.conv.fields.weight.data), [4, 5, 6, 10, 11, 12, 16, 17, 18, 22, 23, 24]);
    assert.deepEqual(next.graph.children.conv.fields.bias.shape, [4], 'bias 只跟输出通道,不动');
    assert.deepEqual(Array.from(next.graph.children.input.fields.shape.data), [1n, 10n]);
    assert.equal(plan.manual.length, 0, '上游只有 Input,无阻停');
    const v = validateDocument(next);
    assert.equal(v.ok, true, `裁后应通过校验: ${JSON.stringify(v.issues)}`);
  });

  it('反向:分组卷积(groups>1)裁输入通道被拒绝', () => {
    const doc = conv2dDoc(2);
    const plan = planPruneChannels(doc, [{ path: ['conv'], axis: 'in', keep: [0] }]);
    assert.equal(plan.ok, false);
    assert.ok(plan.errors[0].includes('groups'));
    assert.throws(
      () => applyPruneChannels(doc, [{ path: ['conv'], axis: 'in', keep: [0] }]),
      /groups/,
    );
    // 裁输出通道不受 groups 限制
    const ok = planPruneChannels(doc, [{ path: ['conv'], axis: 'out', keep: [0] }]);
    assert.equal(ok.ok, true);
  });
});

describe('通道剪枝:反向用例', () => {
  it('下标越界:计划报错,apply 抛错且文档不变', () => {
    const doc = neuronDoc();
    const snap = snapshot(doc);
    const plan = planPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [0, 10] }]);
    assert.equal(plan.ok, false);
    assert.ok(plan.errors[0].includes('越界'));
    assert.throws(
      () => applyPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [0, 10] }]),
      /越界/,
    );
    assertDocsEqual(doc, snap, "被拒绝的操作不得改动文档");
  });

  it('空下标清单拒绝;非整数下标拒绝', () => {
    const doc = neuronDoc();
    assert.equal(planPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [] }]).ok, false);
    assert.equal(planPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [1.5] }]).ok, false);
  });

  it('汇合处下标不一致:整体拒绝并说明原因', () => {
    // 两条上游 a、b 汇进 m;分别指定不同的保留下标
    const doc = {
      version: '1.0.8',
      graph: makeGraph({
        a: makeNode('LIF', {
          tau: num('f32', [4], [1, 1, 1, 1]), r: num('f32', [4], [1, 1, 1, 1]),
          v_leak: num('f32', [4], [0, 0, 0, 0]), v_threshold: num('f32', [4], [1, 1, 1, 1]),
          v_reset: num('f32', [4], [0, 0, 0, 0]),
        }),
        b: makeNode('LIF', {
          tau: num('f32', [4], [1, 1, 1, 1]), r: num('f32', [4], [1, 1, 1, 1]),
          v_leak: num('f32', [4], [0, 0, 0, 0]), v_threshold: num('f32', [4], [1, 1, 1, 1]),
          v_reset: num('f32', [4], [0, 0, 0, 0]),
        }),
        m: makeNode('LIF', {
          tau: num('f32', [4], [1, 1, 1, 1]), r: num('f32', [4], [1, 1, 1, 1]),
          v_leak: num('f32', [4], [0, 0, 0, 0]), v_threshold: num('f32', [4], [1, 1, 1, 1]),
          v_reset: num('f32', [4], [0, 0, 0, 0]),
        }),
        output: makeNode('Output', { shape: num('i64', [1], [4]) }),
      }, [['a', 'm'], ['b', 'm'], ['m', 'output']]),
    };
    const plan = planPruneChannels(doc, [
      { path: ['a'], axis: 'out', keep: [0, 1] },
      { path: ['b'], axis: 'out', keep: [0, 2] },
    ]);
    assert.equal(plan.ok, false);
    assert.ok(plan.errors.some((e) => e.includes('汇合处下标不一致')), `应有汇合不一致错误: ${JSON.stringify(plan.errors)}`);
    assert.throws(() => applyPruneChannels(doc, [
      { path: ['a'], axis: 'out', keep: [0, 1] },
      { path: ['b'], axis: 'out', keep: [0, 2] },
    ]), /汇合处下标不一致/);
  });

  it('汇合处下标一致:同一下标从两条路径到达,正常裁剪', () => {
    const doc = {
      version: '1.0.8',
      graph: makeGraph({
        input: makeNode('Input', { shape: num('i64', [1], [4]) }),
        a: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        b: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        m: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        output: makeNode('Output', { shape: num('i64', [1], [4]) }),
      }, [['input', 'a'], ['input', 'b'], ['a', 'm'], ['b', 'm'], ['m', 'output']]),
    };
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['m'], axis: 'out', keep: [1] }]);
    assert.equal(plan.ok, true);
    // a、b 是 m 的两条上游,都按同一下标裁
    for (const n of ['a', 'b', 'm']) {
      assert.deepEqual(next.graph.children[n].fields.scale.shape, [1], `${n} 应被裁到 1 通道`);
    }
    assert.deepEqual(Array.from(next.graph.children.input.fields.shape.data), [1n]);
  });

  it('遇 Flatten 停下并报告:flatten 不被改动,继续节点列入人工清单', () => {
    const doc = flattenDoc();
    const snap = snapshot(doc);
    const { doc: next, plan } = applyPruneChannels(doc, [{ path: ['input'], axis: 'out', keep: [0] }]);
    assert.equal(plan.ok, true);
    const manualNames = plan.manual.map((m) => m.name);
    assert.deepEqual(manualNames, ['flatten'], '传播应在 Flatten 停下并报告');
    assert.ok(plan.manual[0].reason.includes('通道和空间维'));
    // flatten 未被改动,threshold/output 保持原样
    assert.deepEqual(Object.keys(next.graph.children.flatten.fields).sort(), ['end_dim', 'start_dim']);
    assert.deepEqual(next.graph.children.flatten.fields, snap.graph.children.flatten.fields);
    assert.deepEqual(Array.from(next.graph.children.threshold.fields.threshold.data), Array(32).fill(1));
    assert.deepEqual(Array.from(next.graph.children.output.fields.shape.data), [32n]);
    // 裁完的文档当前是不一致的(Input 1 通道 vs Flatten 后 16 元素),校验应拦住导出
    const v = validateDocument(next);
    assert.equal(v.ok, false, '未人工处理 Flatten 前,校验应失败(不许静默裁错)');
  });

  it('裁完不改变其余字段的 dtype', () => {
    // LIF 用 f64 参数、Conv1d 带字符串 padding 与 i64 标量:剪枝后逐字段核对
    const doc = conv1dDoc();
    doc.graph.children.conv.fields.weight = num('f64', [4, 2, 3], Array.from({ length: 24 }, (_, i) => i + 1));
    const next = applyPruneChannels(doc, [{ path: ['conv'], axis: 'in', keep: [0] }]).doc;
    const conv = next.graph.children.conv.fields;
    assert.equal(conv.weight.dtype, 'f64', 'weight 保持 f64');
    assert.equal(conv.bias.dtype, 'f32');
    assert.equal(conv.input_shape.dtype, 'i64');
    assert.equal(conv.stride.dtype, 'i64');
    assert.equal(conv.padding.dtype, 'vlen-str');
    assert.equal(conv.padding.data, 'valid');
    const inputShape = next.graph.children.input.fields.shape;
    assert.equal(inputShape.dtype, 'i64');
    assert.deepEqual(inputShape.shape, [2], 'Input shape 向量长度不变,只改通道元素');
  });

  it('apply 不动原文档(不可变约定)', () => {
    const doc = neuronDoc();
    const snap = snapshot(doc);
    applyPruneChannels(doc, [{ path: ['lif'], axis: 'out', keep: [0, 1] }]);
    assertDocsEqual(doc, snap, "原文档应保持不变");
  });

  it('blocker 节点本身作为剪枝起点:直接拒绝', () => {
    const doc = flattenDoc();
    const plan = planPruneChannels(doc, [{ path: ['flatten'], axis: 'out', keep: [0] }]);
    assert.equal(plan.ok, false);
    assert.ok(plan.errors[0].includes('通道维'));
  });
});

describe('通道剪枝:动作分发', () => {
  it('pruneChannels 动作走 applyEditAction,历史标签带上节点名与保留数', () => {
    const doc = neuronDoc();
    const r = applyEditAction(doc, { kind: 'pruneChannels', path: ['lif'], axis: 'out', keep: [0, 2] });
    assert.equal(r.applied, true);
    assert.equal(r.label, '通道剪枝 lif(保留 2 个通道)');
    assert.deepEqual(r.doc.graph.children.lif.fields.tau.shape, [2]);
  });

  it('非法下标被拒时抛错(界面 toast 展示,文档不动)', () => {
    const doc = neuronDoc();
    const snap = snapshot(doc);
    assert.throws(() => applyEditAction(doc, { kind: 'pruneChannels', path: ['lif'], axis: 'out', keep: [9] }), /越界/);
    assertDocsEqual(doc, snap, "原文档应保持不变");
  });
});
