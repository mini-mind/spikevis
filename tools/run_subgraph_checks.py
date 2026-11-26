#!/usr/bin/env python3
"""进子图编辑对数总跑批(进子图轮新增,作为 run_e2e_check.py 的姊妹篇)。

前置:先跑 `node --test test/subgraph_edit.test.mjs`,它用 JS 核心模块做
"成组 -> 进子图内部编辑"并写出:
  test/output/subgraph_edited.nir           (complex 模型,完整编辑)
  test/output/subgraph_edited_negative.nir  (故意漏做内部参数修改的阴性对照)
  test/output/nested_edited.nir             (两层嵌套,完整编辑)
  test/output/nested_edited_negative.nir    (漏做第二层参数修改的阴性对照)
  test/output/multiport_gate.nir            (多端口子图,校验闸门拦下的那种文件)

本脚本(用装了官方 nir 库的解释器跑,如 .venv-nir/bin/python):
1. 调 tools/reference_subgraph_edit.py 用官方库做同样编辑,写出参考文件;
2. 两个正向文件 vs 参考 —— 内容必须相等;
3. 两个阴性对照 vs 参考 —— 必须报出差异;
4. multiport_gate.nir 用官方库默认读回 —— 必须失败(证明导出闸门拦的是真问题)。

任一步不满足退出码非 0。
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')
REFERENCE_SCRIPT = os.path.join(HERE, 'reference_subgraph_edit.py')
COMPARE = os.path.join(HERE, 'compare_nir.py')

PAIRS_EQUAL = [
    ('subgraph_edited.nir', 'reference_subgraph_edited.nir', 'complex 进子图编辑'),
    ('nested_edited.nir', 'reference_nested.nir', '两层嵌套编辑'),
]
PAIRS_DIFFER = [
    ('subgraph_edited_negative.nir', 'reference_subgraph_edited.nir', 'complex 阴性对照'),
    ('nested_edited_negative.nir', 'reference_nested.nir', '嵌套阴性对照'),
]


def run(cmd):
    print('+', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout, end='')
    if r.stderr:
        print(r.stderr, end='')
    return r.returncode


def main():
    failures = []

    for src, _ref, _label in PAIRS_EQUAL:
        if not os.path.exists(os.path.join(OUT, src)):
            print(f'{src} missing; run `node --test test/subgraph_edit.test.mjs` first')
            return 1

    # 1. 官方库参考编辑
    if run([sys.executable, REFERENCE_SCRIPT]) != 0:
        print('reference edit failed')
        return 1

    # 2. 内容对数:JS 编辑 vs 官方库编辑,必须相等
    for src, ref, label in PAIRS_EQUAL:
        rc = run([sys.executable, COMPARE, os.path.join(OUT, src), os.path.join(OUT, ref)])
        if rc != 0:
            failures.append(f'{label}: {src} vs {ref} content mismatch')

    # 3. 阴性对照:漏改内部参数的文件必须被报出差异
    for src, ref, label in PAIRS_DIFFER:
        rc = run([sys.executable, COMPARE, os.path.join(OUT, src), os.path.join(OUT, ref)])
        if rc == 0:
            failures.append(f'{label}: NOT detected (missing inner param edit went unnoticed)')
        else:
            print(f'{label} ok: missing inner parameter edit was detected')

    # 4. 多端口子图:官方库默认读回必须失败(导出闸门拦的就是这种文件)
    import nir
    multiport = os.path.join(OUT, 'multiport_gate.nir')
    try:
        nir.read(multiport)
        failures.append('multiport_gate.nir was READ BACK successfully by official lib;'
                        ' expected failure (export gate would be pointless)')
    except Exception as e:
        print(f'multiport gate ok: official nir.read failed as expected: {type(e).__name__}: {str(e)[:120]}')

    if failures:
        print('\nSUBGRAPH CHECKS FAILED:')
        for f in failures:
            print(' -', f)
        return 1
    print('\nALL SUBGRAPH CHECKS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
