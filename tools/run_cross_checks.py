#!/usr/bin/env python3
"""跨实现对数总跑批（npm test 的第二步）。

前置：先跑 `node --test test/`，它会把 JS 核心读-写-再读的文件写到
test/output/ 下。本脚本用官方 nir 库逐一核对：

1. 内容对数：原文件 vs 浏览器核心写出的文件（3 个模型各一次）；
2. 三个阴性对照：改错一个权重 / 丢一个数据集 / 对调一条边，必须报出差异。

任一步失败退出码非 0。
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')
COMPARE = os.path.join(HERE, 'compare_nir.py')

PAIRS = [
    ('test/complex_nir_test_model.nir', 'test/output/complex_roundtrip.nir'),
    ('test/all_types_model.nir', 'test/output/all_types_roundtrip.nir'),
    ('test/legacy_no_vreset.nir', 'test/output/legacy_roundtrip.nir'),
]

MUTATIONS = ['weight', 'drop-dataset', 'swap-edge']


def run(cmd):
    print('+', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout, end='')
    if r.stderr:
        print(r.stderr, end='')
    return r.returncode


def main():
    failures = []

    for orig, rewritten in PAIRS:
        orig_path = os.path.join(ROOT, orig)
        rewritten_path = os.path.join(ROOT, rewritten)
        if not os.path.exists(rewritten_path):
            failures.append(f'{rewritten} missing (run node tests first)')
            continue
        rc = run([sys.executable, COMPARE, orig_path, rewritten_path])
        if rc != 0:
            failures.append(f'content mismatch: {orig} vs {rewritten}')

    # 阴性对照：对第一个对数文件做三种故意改错，全部必须报出差异
    base_orig = os.path.join(ROOT, PAIRS[0][0])
    for i, mode in enumerate(MUTATIONS):
        mutated = os.path.join(OUT, f'mutated_{i}_{mode}.nir')
        rc = run([sys.executable, COMPARE, '--mutate', mode, base_orig, mutated])
        if rc != 0:
            failures.append(f'negative control {mode} failed (mutation not detected or script error)')

    if failures:
        print('\nCROSS CHECKS FAILED:')
        for f in failures:
            print(' -', f)
        return 1
    print('\nALL CROSS CHECKS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
