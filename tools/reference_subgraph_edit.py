#!/usr/bin/env python3
"""进子图编辑的官方参考(对照 test/subgraph_edit.test.mjs):
用官方 nir 库做与 JS 侧完全相同的"成组 -> 进子图内部编辑"操作,写出:

- test/output/reference_subgraph_edited.nir
    complex 模型:threshold1+delay1 成组 block(内部 input/output shape [256]),
    然后在子图内部:threshold1.threshold 全部设 0.75、重命名 delay1 -> delay_gate
    (随后删除)、新建 Delay 节点 delay_new(256),内部链重接为
    input -> threshold1 -> delay_new -> output;
- test/output/reference_nested.nir
    合成模型(从零搭,与 JS chainDoc 相同的数组值):linear+scale 成组 block,
    根层加 LI 节点改接 block->li->output,再 block+li 成组 outer(两层嵌套),
    第二层 linear.weight 整体 x2,第一层 li 改名 li_gate。

与官方写路径的两处刻意差别(仅测试参考文件,不涉及官方库行为):
1. nir.write 会把 /version 写成本包版本号,complex 原文件是 1.0.6——写出后用
   h5py 改回(嵌套合成模型两边都是 1.0.8,不用改);
2. 子图内部结构按 JS 侧成组/编辑的确定性行为搭(端口名 input/output、
   内部边顺序),与 reference_prune_group.py 的约定一致。

用法:.venv-nir/bin/python tools/reference_subgraph_edit.py
"""

import os
import sys

import h5py
import numpy as np

import nir

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')
SRC = os.path.join(ROOT, 'test', 'complex_nir_test_model.nir')


def subgraph_edit_complex():
    """complex 模型:成组 block 后做子图内部编辑(与 JS 序列逐条对应)"""
    g = nir.read(SRC)  # 原模型类型一致,默认 type_check=True 可读
    nodes = dict(g.nodes)
    edges = [tuple(e) for e in g.edges]

    # 1. 成组 threshold1+delay1 -> block;同时做子图内部的 setUniform
    #    (threshold1.threshold 全部 0.75)
    t1 = nodes.pop('threshold1')
    t1.threshold[:] = np.float32(0.75)
    nodes.pop('delay1')  # 后面会删除(改名为 delay_gate 后删除,不在最终结构里)

    # 2. 子图最终结构:input -> threshold1 -> delay_new -> output(端口)
    sub = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([256])),
            'threshold1': t1,
            'delay_new': nir.Delay(delay=np.zeros(256, dtype=np.float32)),
            'output': nir.Output(output_type=np.array([256])),
        },
        edges=[('input', 'threshold1'), ('threshold1', 'delay_new'), ('delay_new', 'output')],
        type_check=False,
    )
    nodes['block'] = sub

    # 3. 父图:组内边移除,跨组边改接 block(保持原相对顺序)
    members = {'threshold1', 'delay1'}
    new_edges = []
    for a, b in edges:
        if a in members and b in members:
            continue
        new_edges.append(('block' if a in members else a, 'block' if b in members else b))

    g2 = nir.NIRGraph(nodes=nodes, edges=new_edges, metadata=g.metadata)
    path = os.path.join(OUT, 'reference_subgraph_edited.nir')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    nir.write(path, g2)
    with h5py.File(path, 'r+') as f:
        del f['version']
        f.create_dataset('version', data='1.0.6')
    check = nir.read(path)  # 自检:官方默认读回必须成功
    print('reference written:', path)
    print('  outer nodes:', sorted(check.nodes))
    print('  block inner nodes:', sorted(check.nodes['block'].nodes))
    return 0


def build_nested():
    """从零搭两层嵌套模型(与 JS chainDoc 的数组值逐位相同)"""
    # block 内部:linear 权重 1..32 已在第二层被 x2(2,4,...,64);scale 保持 [1,2,3,4]
    linear_w = (np.arange(1, 33, dtype=np.float32) * np.float32(2)).reshape(4, 8)
    blk = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([8])),
            'linear': nir.Linear(weight=linear_w),
            'scale': nir.Scale(scale=np.array([1, 2, 3, 4], dtype=np.float32)),
            'output': nir.Output(output_type=np.array([4])),
        },
        edges=[('linear', 'scale'), ('input', 'linear'), ('scale', 'output')],
        type_check=False,
    )
    outer = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([8])),
            'block': blk,
            'li_gate': nir.LI(
                tau=np.ones(4, dtype=np.float32),
                r=np.ones(4, dtype=np.float32),
                v_leak=np.zeros(4, dtype=np.float32),
            ),
            'output': nir.Output(output_type=np.array([4])),
        },
        edges=[('block', 'li_gate'), ('input', 'block'), ('li_gate', 'output')],
        type_check=False,
    )
    root = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([8])),
            'outer': outer,
            'output': nir.Output(output_type=np.array([4])),
        },
        edges=[('input', 'outer'), ('outer', 'output')],
        metadata={},
    )
    return root


def subgraph_nested():
    path = os.path.join(OUT, 'reference_nested.nir')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    nir.write(path, build_nested())
    check = nir.read(path)  # 自检:官方默认读回必须成功(单入单出嵌套)
    print('reference written:', path)
    print('  outer nodes:', sorted(check.nodes))
    print('  outer inner nodes:', sorted(check.nodes['outer'].nodes))
    return 0


def main():
    os.makedirs(OUT, exist_ok=True)
    rc = subgraph_edit_complex()
    rc |= subgraph_nested()
    return rc


if __name__ == '__main__':
    sys.exit(main())
