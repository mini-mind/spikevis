#!/usr/bin/env python3
"""端到端对数的官方参考:用 nir 官方库对 test/complex_nir_test_model.nir 做
与 test/e2e_edit.test.mjs 完全相同的一组编辑,写出 test/output/reference_edited.nir。

编辑序列(与 JS 侧逐条对应):
1. 删 delay1(连同与它相连的边);
2. 新建 lif2(LIF,256 通道)并连 threshold1 -> lif2 -> lif1;
3. threshold1 的 threshold 整体设 0.75;
4. 重命名 if1 -> if_gate(边同步)。

注意:nir.write 会把 /version 写成本包版本号(1.0.8),而 JS 侧无损保留原文件的
'1.0.6'。对数要求内容相等,所以这里在写出后用 h5py 把 /version 改回 '1.0.6',
并在报告里写明这一处与官方写路径的差别(仅测试参考文件,不涉及官方库行为)。

用法:.venv-nir/bin/python tools/reference_edit.py
"""

import os
import sys

import h5py
import numpy as np

import nir

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'test', 'complex_nir_test_model.nir')
OUT = os.path.join(ROOT, 'test', 'output', 'reference_edited.nir')


def main():
    g = nir.read(SRC)  # 原模型类型一致,默认 type_check=True 可读
    nodes = dict(g.nodes)
    edges = [tuple(e) for e in g.edges]

    # 1. 删 delay1(同步删相连边)
    del nodes['delay1']
    edges = [e for e in edges if 'delay1' not in e]

    # 2. 新建 lif2:与 JS buildNodeRecord('LIF') 的缺省值一致
    #    (tau/r/v_threshold = 1,v_leak/v_reset = 0,全部 float32,256 通道)
    nodes['lif2'] = nir.LIF(
        tau=np.ones(256, dtype=np.float32),
        r=np.ones(256, dtype=np.float32),
        v_leak=np.zeros(256, dtype=np.float32),
        v_threshold=np.ones(256, dtype=np.float32),
        v_reset=np.zeros(256, dtype=np.float32),
    )
    edges.append(('threshold1', 'lif2'))
    edges.append(('lif2', 'lif1'))

    # 3. 改参数:threshold1.threshold 整体设 0.75(JS 侧是 setUniform)
    nodes['threshold1'].threshold[:] = np.float32(0.75)

    # 4. 重命名 if1 -> if_gate(边同步)
    nodes['if_gate'] = nodes.pop('if1')
    edges = [
        ('if_gate' if a == 'if1' else a, 'if_gate' if b == 'if1' else b)
        for a, b in edges
    ]

    # 重建图(默认 type_check=True,顺带再验一遍类型);根图元数据要带上,
    # 否则官方写出的文件会丢掉 /node/metadata,与 JS 侧(无损保留)对不上
    g2 = nir.NIRGraph(nodes=nodes, edges=edges, metadata=g.metadata)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    nir.write(OUT, g2)

    # /version 改回原文件版本(见文件头说明)
    with h5py.File(OUT, 'r+') as f:
        del f['version']
        f.create_dataset('version', data='1.0.6')

    print('reference written:', OUT)
    print('nodes:', sorted(nodes))
    print('edges:', edges)
    return 0


if __name__ == '__main__':
    sys.exit(main())
