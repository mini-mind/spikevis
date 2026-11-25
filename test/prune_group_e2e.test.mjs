/**
 * 端到端剪枝+成组测试:对两个真实模型各做一次剪枝和一次成组,
 * 结果写到 test/output/,由 tools/run_prune_group_checks.py 用官方库核对:
 *
 * - test/output/pruned_grouped_complex.nir
 *     complex 模型:剪 scale1 保留下标 0..127(联动 linear1 权重行、affine1 权重列),
 *     再把 threshold1+delay1 编成子图节点 group;
 * - test/output/pruned_grouped_all_types.nir
 *     all_types 模型:剪 conv1d 输入通道保留 [0,1](联动 input_b 的 shape),
 *     再把 threshold+scale 编成子图节点 group;
 * - test/output/pruned_grouped_complex_negative.nir
 *     阴性对照:同上但故意少裁一个下游节点(affine1 的权重列没裁),写出前
 *     校验必须失败(证明导出闸门会拦住),文件本身供"比对必须报差异"用。
 *
 * 编辑序列与 tools/reference_prune_group.py 逐条对应。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNir, setNodeField, validateDocument, writeNir } from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { getBackend } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'test', 'output');

const KEEP_SCALE = Array.from({ length: 128 }, (_, i) => i); // 256 -> 128
const KEEP_CONV1D = [0, 1]; // 3 -> 2

async function load(file) {
  const backend = await getBackend();
  return readNir(fs.readFileSync(path.join(ROOT, 'test', file)), backend);
}

async function writeOut(doc, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const backend = await getBackend();
  const bytes = await writeNir(doc, backend);
  fs.writeFileSync(path.join(OUT_DIR, name), bytes);
  return bytes;
}

describe('端到端剪枝+成组(complex 模型)', () => {
  it('剪 scale1 再组 threshold1+delay1,校验通过并写出', async () => {
    const doc = await load('complex_nir_test_model.nir');
    const history = [{ doc, label: 'initial' }];

    // 1. 通道剪枝
    const pruned = applyEditAction(history.at(-1).doc, {
      kind: 'pruneChannels', path: ['scale1'], axis: 'out', keep: KEEP_SCALE,
    });
    assert.equal(pruned.applied, true);
    assert.equal(pruned.label, `通道剪枝 scale1(保留 ${KEEP_SCALE.length} 个通道)`);
    history.push(pruned);
    const v1 = validateDocument(pruned.doc);
    assert.equal(v1.ok, true, `剪枝后应通过校验: ${JSON.stringify(v1.issues)}`);
    // 联动读数:linear1 512 行 -> 128;affine1 512 列 -> 128
    assert.deepEqual(pruned.doc.graph.children.linear1.fields.weight.shape, [128, 784]);
    assert.deepEqual(pruned.doc.graph.children.affine1.fields.weight.shape, [256, 128]);
    assert.deepEqual(pruned.doc.graph.children.scale1.fields.scale.shape, [128]);

    // 2. 成组:threshold1 + delay1
    const grouped = applyEditAction(history.at(-1).doc, {
      kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'group',
    });
    assert.equal(grouped.applied, true);
    history.push(grouped);
    const v2 = validateDocument(grouped.doc);
    assert.equal(v2.ok, true, `成组后应通过校验: ${JSON.stringify(v2.issues)}`);
    // 关键读数:12 节点(12-2+1=11 个原节点名 + group) 10 边
    assert.equal(Object.keys(grouped.doc.graph.children).length, 11);
    assert.equal(grouped.doc.graph.edgePairs.length, 10);
    const grp = grouped.doc.graph.children.group;
    assert.equal(grp.type, 'NIRGraph');
    assert.deepEqual(Object.keys(grp.children).sort(), ['delay1', 'input', 'output', 'threshold1']);
    assert.deepEqual(Array.from(grp.children.input.fields.shape.data), [256n]);

    await writeOut(grouped.doc, 'pruned_grouped_complex.nir');
  });

  it('阴性对照:故意少裁 affine1 的权重列,校验必须失败', async () => {
    const doc = await load('complex_nir_test_model.nir');
    const pruned = applyEditAction(doc, {
      kind: 'pruneChannels', path: ['scale1'], axis: 'out', keep: KEEP_SCALE,
    });
    assert.equal(pruned.applied, true);
    // "少裁一个下游节点":把 affine1 的权重换回未裁的原状(等价于这处联动没做)
    const missed = setNodeField(pruned.doc, ['affine1'], 'weight', doc.graph.children.affine1.fields.weight);
    assert.deepEqual(missed.graph.children.affine1.fields.weight.shape, [256, 512], '少裁后的权重应回到 [256,512]');
    // 校验必须失败:scale1 输出 128 对不上 affine1 输入 512(导出闸门会拦住)
    const v = validateDocument(missed);
    assert.equal(v.ok, false, '少裁一个下游节点后校验应失败');
    assert.ok(v.issues.some((i) => i.kind === 'inference-failed' || i.kind === 'type-mismatch'));

    // 继续做同样的成组(保持与正向文件其余部分一致,便于比对定位差异)
    const grouped = applyEditAction(missed, {
      kind: 'group', path: [], names: ['threshold1', 'delay1'], name: 'group',
    });
    assert.equal(grouped.applied, true);
    await writeOut(grouped.doc, 'pruned_grouped_complex_negative.nir');
  });
});

describe('端到端剪枝+成组(all_types 模型,含嵌套子图)', () => {
  it('剪 conv1d 输入通道再组 threshold+scale,校验通过并写出', async () => {
    const doc = await load('all_types_model.nir');
    // 1. 通道剪枝:conv1d 输入通道 3 -> 2,上游 input_b 的 shape 联动
    const pruned = applyEditAction(doc, {
      kind: 'pruneChannels', path: ['conv1d'], axis: 'in', keep: KEEP_CONV1D,
    });
    assert.equal(pruned.applied, true);
    const v1 = validateDocument(pruned.doc);
    assert.equal(v1.ok, true, `剪枝后应通过校验: ${JSON.stringify(v1.issues)}`);
    assert.deepEqual(pruned.doc.graph.children.conv1d.fields.weight.shape, [4, 2, 3]);
    assert.deepEqual(Array.from(pruned.doc.graph.children.input_b.fields.shape.data), [2n, 10n]);
    // conv1d 的 input_shape(空间维)不动
    assert.deepEqual(Array.from(pruned.doc.graph.children.conv1d.fields.input_shape.data), [10n]);

    // 2. 成组:threshold + scale(单入单出,1x 层级;模型里已有嵌套子图 block)
    const grouped = applyEditAction(pruned.doc, {
      kind: 'group', path: [], names: ['threshold', 'scale'], name: 'group',
    });
    assert.equal(grouped.applied, true);
    const v2 = validateDocument(grouped.doc);
    assert.equal(v2.ok, true, `成组后应通过校验: ${JSON.stringify(v2.issues)}`);
    const grp = grouped.doc.graph.children.group;
    assert.equal(grp.type, 'NIRGraph');
    assert.deepEqual(Object.keys(grp.children).sort(), ['input', 'output', 'scale', 'threshold']);
    assert.deepEqual(Array.from(grp.children.input.fields.shape.data), [32n]);
    // 原有嵌套子图 block 不受影响
    assert.equal(grouped.doc.graph.children.block.type, 'NIRGraph');

    await writeOut(grouped.doc, 'pruned_grouped_all_types.nir');
  });
});
