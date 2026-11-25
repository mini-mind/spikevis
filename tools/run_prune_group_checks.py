#!/usr/bin/env python3
"""剪枝+成组对数总跑批(npm test 的第三步)。

前置:先跑 `node --test test/prune_group_e2e.test.mjs`,它用 JS 核心模块对
test/complex_nir_test_model.nir 与 test/all_types_model.nir 各做一次剪枝+成组并写出:
  test/output/pruned_grouped_complex.nir           (完整编辑)
  test/output/pruned_grouped_complex_negative.nir  (故意少裁一个下游节点)
  test/output/pruned_grouped_all_types.nir         (完整编辑)

本脚本(用装了官方 nir 库的解释器跑,如 .venv-nir/bin/python):
1. 官方库读回三个编辑器产物(默认 type_check=True)——必须全部成功;
2. 调 tools/reference_prune_group.py 用官方库做同样编辑写出参考文件;
3. 比对编辑器产物 vs 参考文件 —— complex 与 all_types 都必须内容相等;
4. 阴性对照:比对 negative vs 参考文件 —— 必须报出差异。

任一步不满足退出码非 0。
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')
COMPARE = os.path.join(HERE, 'compare_nir.py')
REFERENCE = os.path.join(HERE, 'reference_prune_group.py')

EDITOR_FILES = [
    'pruned_grouped_complex.nir',
    'pruned_grouped_all_types.nir',
]
# 阴性对照文件是故意裁坏的,不参与"官方读回必须成功",只参与"比对必须报差异"
NEGATIVE_FILE = 'pruned_grouped_complex_negative.nir'
PAIRS = [
    ('pruned_grouped_complex.nir', 'reference_pruned_grouped_complex.nir'),
    ('pruned_grouped_all_types.nir', 'reference_pruned_grouped_all_types.nir'),
]


def run(cmd):
    print('+', ' '.join(cmd))
    r = subprocess_run(cmd)
    return r


def subprocess_run(cmd):
    import subprocess
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout, end='')
    if r.stderr:
        print(r.stderr, end='')
    return r.returncode


def main():
    import subprocess
    failures = []

    # 1. 官方库读回编辑器产物(type_check=True 默认)
    for name in EDITOR_FILES:
        p = os.path.join(OUT, name)
        if not os.path.exists(p):
            failures.append(f'{name} missing (run `node --test test/prune_group_e2e.test.mjs` first)')
            continue
        rc = subprocess.run([sys.executable, '-c', f'import nir; nir.read({p!r}); print("official read ok: {name}")'],
                            capture_output=True, text=True)
        print(rc.stdout, end='')
        if rc.returncode != 0:
            print(rc.stderr, end='')
            failures.append(f'official nir.read FAILED on editor output {name}')

    if failures:
        print('\nPRUNE GROUP CHECKS FAILED:')
        for f in failures:
            print(' -', f)
        return 1

    # 2. 官方库参考编辑
    if run([sys.executable, REFERENCE]) != 0:
        print('reference prune+group failed')
        return 1

    # 3. 内容对数:编辑器 vs 参考,必须相等
    for editor, reference in PAIRS:
        rc = run([sys.executable, COMPARE,
                  os.path.join(OUT, editor), os.path.join(OUT, reference)])
        if rc != 0:
            failures.append(f'{editor} vs {reference} content mismatch')

    # 4. 阴性对照:少裁一个下游节点的文件必须被报出差异
    rc = run([sys.executable, COMPARE,
              os.path.join(OUT, NEGATIVE_FILE),
              os.path.join(OUT, 'reference_pruned_grouped_complex.nir')])
    if rc == 0:
        failures.append('negative control NOT detected: missed downstream prune went unnoticed')
    else:
        print('negative control ok: missed downstream prune was detected')

    if failures:
        print('\nPRUNE GROUP CHECKS FAILED:')
        for f in failures:
            print(' -', f)
        return 1
    print('\nALL PRUNE GROUP CHECKS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
