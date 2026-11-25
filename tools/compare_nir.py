#!/usr/bin/env python3
"""跨实现对数：用官方 nir 库比较两个 .nir 文件的"内容相等"。

两道检查：
1. 结构层（h5py）：组的树、数据集键集、dtype、shape 逐项相同
   （压缩方式与分块布局不比，内容相等不要求存储细节一致）。
2. 语义层（nir.read，type_check=False）：递归比较节点类型、全部字段、
   数组数值与 dtype、边、元数据。bytes 一律按 UTF-8 解码后比较。

用法：
  python tools/compare_nir.py A.nir B.nir
      比较两文件；相同退出 0，不同退出 1 并列出差异。
  python tools/compare_nir.py --mutate {weight|drop-dataset|swap-edge} SRC.nir OUT.nir
      把 SRC 故意改坏写到 OUT（改错一个权重 / 丢一个数据集 / 对调一条边），
      然后比较 SRC 与 OUT；报出差异退出 0（阴性对照通过），没报出差异退出 1。
"""

import sys

import h5py
import numpy as np

import nir


def _decode(x):
    if isinstance(x, bytes):
        return x.decode('utf-8')
    return x


def _norm_value(v):
    if isinstance(v, np.ndarray):
        if v.dtype.kind in ('S', 'O', 'U'):
            return [_decode(x) for x in v.ravel().tolist()]
        return v
    return _decode(v)


def struct_walk(path, obj, out):
    """收集 (相对路径, 类型, shape, dtype串) 清单"""
    if isinstance(obj, h5py.Dataset):
        out.append((path, 'dataset', obj.shape, obj.dtype.str, obj.dtype.metadata))
    elif isinstance(obj, h5py.Group):
        out.append((path, 'group', None, None, None))
        for k in obj:
            struct_walk(f'{path}/{k}', obj[k], out)


def compare_structure(fa, fb, diffs):
    da, db = [], []
    struct_walk('', fa, da)
    struct_walk('', fb, db)
    if da != db:
        names_a = {x[0]: x for x in da}
        names_b = {x[0]: x for x in db}
        for p in sorted(set(names_a) | set(names_b)):
            if p not in names_a:
                diffs.append(f'structure: extra in B: {p}')
            elif p not in names_b:
                diffs.append(f'structure: missing in B: {p}')
            elif names_a[p] != names_b[p]:
                diffs.append(f'structure: {p}: {names_a[p]} != {names_b[p]}')


def compare_value(a, b, path, diffs):
    """递归比较 nir.read 读出的对象"""
    ta, tb = type(a).__name__, type(b).__name__
    if ta != tb:
        diffs.append(f'{path}: type {ta} != {tb}')
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                diffs.append(f'{path}.{k}: missing in A')
            elif k not in b:
                diffs.append(f'{path}.{k}: missing in B')
            else:
                compare_value(a[k], b[k], f'{path}.{k}', diffs)
        return
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            diffs.append(f'{path}: length {len(a)} != {len(b)}')
            return
        for i, (xa, xb) in enumerate(zip(a, b)):
            if isinstance(xa, (tuple, list)) and isinstance(xb, (tuple, list)):
                compare_value(list(xa), list(xb), f'{path}[{i}]', diffs)
            else:
                compare_value(xa, xb, f'{path}[{i}]', diffs)
        return
    if isinstance(a, np.ndarray) and isinstance(b, np.ndarray):
        if a.dtype.str != b.dtype.str:
            diffs.append(f'{path}: dtype {a.dtype.str} != {b.dtype.str}')
        elif a.shape != b.shape:
            diffs.append(f'{path}: shape {a.shape} != {b.shape}')
        elif not np.array_equal(a, b):
            bad = np.argwhere(a != b)
            first = tuple(bad[0]) if len(bad) else None
            diffs.append(
                f'{path}: values differ (dtype {a.dtype.str}, shape {a.shape},'
                f' first at {first}: {a[first]} != {b[first]})'
            )
        return
    if a != b:
        diffs.append(f'{path}: {a!r} != {b!r}')


def compare_semantic(file_a, file_b, diffs):
    ga = nir.read(file_a, type_check=False)
    gb = nir.read(file_b, type_check=False)
    compare_value(_norm_value(ga.to_dict()), _norm_value(gb.to_dict()), 'graph', diffs)
    # edges 单独比（to_dict 里也有，重复比一次无妨，报错路径更清楚）
    if [tuple(e) for e in ga.edges] != [tuple(e) for e in gb.edges]:
        diffs.append(
            f'edges differ: {[tuple(e) for e in ga.edges][:4]}... !='
            f' {[tuple(e) for e in gb.edges][:4]}...'
        )


def compare_files(file_a, file_b, label=''):
    diffs = []
    with h5py.File(file_a, 'r') as fa, h5py.File(file_b, 'r') as fb:
        compare_structure(fa, fb, diffs)
    try:
        compare_semantic(file_a, file_b, diffs)
    except Exception as e:  # 官方库读失败或比较异常都算差异
        diffs.append(f'semantic comparison raised: {type(e).__name__}: {e}')
    if diffs:
        print(f'== {label}: DIFFERENT ({len(diffs)} differences)')
        for d in diffs[:20]:
            print(f'   - {d}')
        if len(diffs) > 20:
            print(f'   ... and {len(diffs) - 20} more')
        return False
    print(f'== {label}: content equal')
    return True


def mutate_file(src, out, mode):
    """故意改坏 SRC 写到 OUT（先整体复制，再做一处改动）"""
    with h5py.File(src, 'r') as fsrc, h5py.File(out, 'w') as fdst:
        fsrc.copy('version', fdst, name='version')
        fsrc.copy('node', fdst, name='node')

        def visit(group):
            found = []
            for name in group:
                item = group[name]
                if isinstance(item, h5py.Dataset):
                    found.append(item)
                elif isinstance(item, h5py.Group):
                    found.extend(visit(item))
            return found

        if mode == 'weight':
            datasets = visit(fdst['node'])
            weights = [d for d in datasets if d.name.endswith('/weight')]
            target = weights[0] if weights else datasets[0]
            arr = np.array(target[()])
            if not np.issubdtype(arr.dtype, np.number):
                raise SystemExit(f'weight mutation: {target.name} is not numeric')
            print(f'mutating: {target.name} element[0]')
            parent = fdst[target.parent.name]
            leaf = target.name.split('/')[-1]
            target_path = target.name
            del parent[leaf]
            if arr.ndim == 0:
                arr[()] = arr[()] + 1
            else:
                arr.ravel()[0] = arr.ravel()[0] + 1.0
            parent.create_dataset(leaf, data=arr)
            print(f'mutated: {target_path} element[0] -> {arr.ravel()[0]}')
        elif mode == 'drop-dataset':
            datasets = [d for d in visit(fdst['node']) if not d.name.endswith('/type')]
            target = datasets[0]
            leaf = target.name.split('/')[-1]
            parent_path = target.parent.name
            print(f'mutating: drop dataset {target.name}')
            del fdst[parent_path][leaf]
            print(f'mutated: dropped dataset {parent_path}/{leaf}')
        elif mode == 'swap-edge':
            edges = fdst['node/edges'][()]
            a0, b0 = _decode(edges[0][0]), _decode(edges[0][1])
            edges[0] = [b0, a0]
            del fdst['node/edges']
            fdst.create_dataset('node/edges', data=edges,
                                dtype=h5py.string_dtype())
            print(f'mutated: swapped edge 0 ({a0}, {b0}) -> ({b0}, {a0})')
        else:
            raise SystemExit(f'unknown mutation mode: {mode}')


def main(argv):
    if len(argv) >= 4 and argv[1] == '--mutate':
        mode, src, out = argv[2], argv[3], argv[4]
        mutate_file(src, out, mode)
        ok = compare_files(src, out, label=f'negative control ({mode})')
        if ok:
            print('NEGATIVE CONTROL FAILED: mutation was NOT detected')
            return 1
        print('negative control ok: mutation detected')
        return 0

    if len(argv) != 3:
        print(__doc__)
        return 2
    ok = compare_files(argv[1], argv[2], label=f'{argv[1]} vs {argv[2]}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
