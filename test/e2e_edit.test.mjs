/**
 * 端到端编辑测试:对 test/complex_nir_test_model.nir 做一组真实编辑
 * (删一个节点、新建一个节点并连线、改一个参数、重命名),
 * 把结果写到 test/output/editor_edited.nir;
 * 同时写一份"漏做参数修改"的阴性对照文件 editor_edited_negative.nir。
 *
 * 之后由 tools/run_e2e_check.py 用官方库生成参考文件并比对(内容相等 +
 * 阴性对照必须报出差异)。编辑序列与 tools/reference_edit.py 逐条对应。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHistory, readNir, validateDocument, writeNir } from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { getBackend } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SRC = path.join(ROOT, 'test', 'complex_nir_test_model.nir');
const OUT_DIR = path.join(ROOT, 'test', 'output');

/**
 * 编辑序列(与 tools/reference_edit.py 逐条对应):
 * 1. 删 delay1(自动删相连边);
 * 2. 新建 lif2(LIF,256 通道)并连 threshold1 -> lif2 -> lif1;
 * 3. threshold1 的 threshold 整体设 0.75;
 * 4. 重命名 if1 -> if_gate(边同步)。
 * skipParam 为 true 时漏做第 3 步(阴性对照用)。
 */
async function runEdits(skipParam = false) {
  const backend = await getBackend();
  const doc = await readNir(fs.readFileSync(SRC), backend);
  const history = createHistory(doc);

  const steps = [
    { action: { kind: 'removeNode', name: 'delay1', confirmed: true }, label: '删除节点 delay1' },
    { action: { kind: 'addNode', type: 'LIF', name: 'lif2', shape: [256] }, label: '新建节点 lif2' },
    { action: { kind: 'connect', src: 'threshold1', dst: 'lif2' }, label: '连线 threshold1 → lif2' },
    { action: { kind: 'connect', src: 'lif2', dst: 'lif1' }, label: '连线 lif2 → lif1' },
    ...(skipParam ? [] : [{ action: { kind: 'setUniform', path: ['threshold1'], field: 'threshold', value: 0.75 }, label: '修改 threshold1 的 threshold' }]),
    { action: { kind: 'rename', oldName: 'if1', newName: 'if_gate' }, label: '重命名 if1 → if_gate' },
  ];
  for (const step of steps) {
    const { doc: next, label, warnings } = applyEditAction(history.current, step.action);
    assert.deepEqual(warnings, [], '本序列的编辑不应触发连通性预警');
    history.commit(next, label);
  }
  return { history, initialDoc: doc };
}

describe('端到端编辑(complex 模型)', () => {
  it('编辑后通过校验,写出与官方参考同内容的文件', async () => {
    const { history, initialDoc } = await runEdits(false);
    const final = history.current;

    // 校验闸门:编辑结果必须是干净文档
    const v = validateDocument(final);
    assert.equal(v.ok, true, `编辑结果应通过校验: ${JSON.stringify(v.issues)}`);
    // 关键读数:12 节点 11 边,改名后 delay1 没了、lif2 存在
    assert.equal(Object.keys(final.graph.children).length, 12);
    assert.equal(final.graph.edgePairs.length, 11);
    assert.ok(final.graph.children.lif2 && !final.graph.children.delay1 && !final.graph.children.if1);
    // threshold1 已整体改 0.75
    assert.deepEqual(Array.from(final.graph.children.threshold1.fields.threshold.data), Array(256).fill(0.75));

    // 撤销到底应回到初始文档(引用相等,证明历史栈无损)
    let back = history.current;
    let guard = 0;
    while (history.canUndo() && guard < 20) {
      back = history.undo();
      guard += 1;
    }
    assert.equal(back, initialDoc, 'undo 到底应回到初始文档(同一引用)');
    let fwd = back;
    guard = 0;
    while (history.canRedo() && guard < 20) {
      fwd = history.redo();
      guard += 1;
    }
    assert.equal(fwd, final, 'redo 到底应回到编辑后的文档(同一引用)');

    // 写出 .nir
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const backend = await getBackend();
    const bytes = await writeNir(final, backend);
    fs.writeFileSync(path.join(OUT_DIR, 'editor_edited.nir'), bytes);
  });

  it('阴性对照:漏做参数修改,写出用于"必须报差异"的文件', async () => {
    const { history } = await runEdits(true);
    const final = history.current;
    const v = validateDocument(final);
    assert.equal(v.ok, true, '阴性对照文件本身仍应是干净文档');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const backend = await getBackend();
    const bytes = await writeNir(final, backend);
    fs.writeFileSync(path.join(OUT_DIR, 'editor_edited_negative.nir'), bytes);
  });
});
