/**
 * 校验测试:形状推断 + 节点级一致性 + 逐边诊断;
 * 以及"被改动的节点"脏标记。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedNodeNames, connectEdge, inferTypes, setFieldUniform, setIntArrayField,
  validateDocument, removeNode, setNodeField,
} from '../src/core/nir/index.js';
import { assertDocsEqual, makeGraph, makeNode, num, strVal } from './helpers.mjs';

function chainDoc(inDim = 4) {
  const arr = (v) => Array.from({ length: inDim }, () => v);
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [inDim]) }),
      lif: makeNode('LIF', {
        tau: num('f32', [inDim], arr(1)),
        r: num('f32', [inDim], arr(1)),
        v_leak: num('f32', [inDim], arr(0)),
        v_threshold: num('f32', [inDim], arr(1)),
        v_reset: num('f32', [inDim], arr(0)),
      }),
      output: makeNode('Output', { shape: num('i64', [1], [inDim]) }),
    }, [['input', 'lif'], ['lif', 'output']]),
  };
}

describe('节点级一致性(官方 __post_init__ 断言的移植)', () => {
  it('抓出 LIF 阈值从 256 维改成 128 维(其余参数还是 256 维)', () => {
    const doc = chainDoc(256);
    const broken = setIntArrayField(doc, ['lif'], 'v_threshold', Array(128).fill(1));
    const v = validateDocument(broken);
    assert.equal(v.ok, false);
    const hit = v.issues.find((i) => i.kind === 'node-shape' && i.path === 'lif');
    assert.ok(hit, '应有 node-shape 类 issue');
    assert.match(hit.message, /v_threshold=\[128\]/);
    // 完好文档必须通过
    assert.equal(validateDocument(doc).ok, true);
  });

  it('抓出 Linear 权重不足二维', () => {
    const doc = chainDoc(4);
    const broken = setNodeField(doc, ['lif'], 'tau', num('f32', [4], [1, 1, 1, 1]));
    const withBadLinear = {
      version: doc.version,
      graph: makeGraph({
        ...doc.graph.children,
        lin: makeNode('Linear', { weight: num('f32', [4], [1, 2, 3, 4]) }),
      }, [['input', 'lin'], ['lin', 'output']]),
    };
    const v = validateDocument(withBadLinear);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((i) => i.message.match(/至少要二维/)));
  });

  it('抓出 Conv padding 非法字符串', () => {
    const doc = chainDoc(4);
    const withBadConv = {
      version: doc.version,
      graph: makeGraph({
        ...doc.graph.children,
        conv: makeNode('Conv1d', {
          weight: num('f32', [4, 4, 3], new Float32Array(48)),
          stride: num('i64', [], [1]),
          padding: strVal('oops'),
          dilation: num('i64', [], [1]),
          groups: num('i64', [], [1]),
          bias: num('f32', [4], [0, 0, 0, 0]),
        }),
      }, [['lif', 'conv']]),
    };
    const v = validateDocument(withBadConv);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((i) => i.message.match(/padding/)));
  });
});

describe('图级推断与逐边诊断', () => {
  it('完好文档通过校验且给出推断类型', () => {
    const doc = chainDoc(4);
    const v = validateDocument(doc);
    assert.equal(v.ok, true);
    assert.deepEqual(v.issues, []);
    assert.deepEqual(v.types.lif.input, [4]);
    assert.deepEqual(v.types.lif.output, [4]);
  });

  it('抓出边两端形状不一致并定位到边', () => {
    const doc = chainDoc(4);
    const broken = setIntArrayField(doc, ['input'], 'shape', [8]);
    const v = validateDocument(broken);
    assert.equal(v.ok, false);
    const hit = v.issues.find((i) => i.kind === 'type-mismatch');
    assert.ok(hit, '应有 type-mismatch 类 issue');
    assert.deepEqual(hit.edge, ['input', 'lif']);
    assert.match(hit.message, /input' 的输出 \[8\]/);
  });

  it('带环且类型一致的图通过校验(与官方 infer_types 实测一致)', () => {
    const doc = chainDoc(4);
    const d3 = connectEdge(doc, [], 'input', 'output');
    // input -> output 直连是合法边;造环:lif -> input 不允许,用 delay 场景太绕,
    // 这里直接复制官方探针结构:input -> a -> b -> a 环
    const g = makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [1]) }),
      a: makeNode('LIF', {
        tau: num('f32', [1], [1]), r: num('f32', [1], [1]),
        v_leak: num('f32', [1], [0]), v_threshold: num('f32', [1], [1]),
      }),
      b: makeNode('LIF', {
        tau: num('f32', [1], [1]), r: num('f32', [1], [1]),
        v_leak: num('f32', [1], [0]), v_threshold: num('f32', [1], [1]),
      }),
      output: makeNode('Output', { shape: num('i64', [1], [1]) }),
    }, [['input', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'output']]);
    const cyclic = { version: doc.version, graph: g };
    const v = validateDocument(cyclic);
    assert.equal(v.ok, true, `带环图应通过校验: ${JSON.stringify(v.issues)}`);
    assert.deepEqual(v.types.a.output, [1]);
    // 顺手核对 inferTypes 与官方一致的入口
    const { types } = inferTypes(cyclic);
    assert.deepEqual(types.b.input, [1]);
  });

  it('纯环(无 Input)在校验时被拦下(与官方实测一致)', () => {
    const doc = chainDoc(4);
    const pureCycle = {
      version: doc.version,
      graph: makeGraph({
        a: makeNode('LIF', {
          tau: num('f32', [1], [1]), r: num('f32', [1], [1]),
          v_leak: num('f32', [1], [0]), v_threshold: num('f32', [1], [1]),
        }),
        b: makeNode('LIF', {
          tau: num('f32', [1], [1]), r: num('f32', [1], [1]),
          v_leak: num('f32', [1], [0]), v_threshold: num('f32', [1], [1]),
        }),
      }, [['a', 'b'], ['b', 'a']]),
    };
    const v = validateDocument(pureCycle);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((i) => i.kind === 'inference-failed' && /no input nodes/.test(i.message)));
  });
});

describe('脏标记 changedNodeNames', () => {
  it('字段改动、新节点、边端点牵连都能标出', () => {
    const doc = chainDoc(4);
    const d2 = setFieldUniform(doc, ['lif'], 'tau', 9);
    assert.deepEqual([...changedNodeNames(doc, d2)], ['lif']);
    const d3 = removeNode(d2, 'output');
    const changed3 = [...changedNodeNames(doc, d3)].sort();
    assert.ok(changed3.includes('lif'), '被删边的另一端要标记');
    assert.ok(!changed3.includes('input'), '与被删边无关的节点不标');
    assert.ok(!changed3.includes('output'), '被删节点本身已不在画布上,不标');
    // 未改动
    assert.equal(changedNodeNames(doc, doc).size, 0);
  });
});
