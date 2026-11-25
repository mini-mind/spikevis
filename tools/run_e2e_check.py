#!/usr/bin/env python3
"""端到端编辑对数总跑批(编辑轮新增,作为 run_cross_checks.py 的姊妹篇)。

前置:先跑 `node --test test/e2e_edit.test.mjs`,它用 JS 核心模块对
test/complex_nir_test_model.nir 做一组编辑并写出:
  test/output/editor_edited.nir           (完整编辑)
  test/output/editor_edited_negative.nir  (故意漏做参数修改的阴性对照)

本脚本(用装了官方 nir 库的解释器跑,如 .venv-nir/bin/python):
1. 调 tools/reference_edit.py 用官方库做同样编辑,写出 reference_edited.nir;
2. 比对 editor_edited.nir vs reference_edited.nir —— 必须内容相等;
3. 比对 editor_edited_negative.nir vs reference_edited.nir —— 必须报出差异。

任一步不满足退出码非 0。
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')
EDITOR = os.path.join(OUT, 'editor_edited.nir')
NEGATIVE = os.path.join(OUT, 'editor_edited_negative.nir')
REFERENCE = os.path.join(OUT, 'reference_edited.nir')
COMPARE = os.path.join(HERE, 'compare_nir.py')
REFERENCE_EDIT = os.path.join(HERE, 'reference_edit.py')


def run(cmd):
    print('+', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout, end='')
    if r.stderr:
        print(r.stderr, end='')
    return r.returncode


def main():
    failures = []

    if not os.path.exists(EDITOR) or not os.path.exists(NEGATIVE):
        print('editor outputs missing; run `node --test test/e2e_edit.test.mjs` first')
        return 1

    # 1. 官方库参考编辑
    if run([sys.executable, REFERENCE_EDIT]) != 0:
        print('reference edit failed')
        return 1

    # 2. 内容对数:JS 编辑 vs 官方库编辑,必须相等
    rc = run([sys.executable, COMPARE, EDITOR, REFERENCE])
    if rc != 0:
        failures.append('editor_edited.nir vs reference_edited.nir content mismatch')

    # 3. 阴性对照:漏改参数的文件必须被报出差异
    rc = run([sys.executable, COMPARE, NEGATIVE, REFERENCE])
    if rc == 0:
        failures.append('negative control NOT detected: missing param edit went unnoticed')
    else:
        print('negative control ok: missing parameter edit was detected')

    if failures:
        print('\nE2E CHECKS FAILED:')
        for f in failures:
            print(' -', f)
        return 1
    print('\nALL E2E CHECKS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
