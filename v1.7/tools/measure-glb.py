"""Measure exported GLBs by parsing the file back, never by trusting the inputs.

Reads the 12-byte header, the JSON chunk (0x4E4F534A), the BIN chunk
(0x004E4942), then walks every mesh primitive's POSITION accessor and unions
its min/max after applying the node transforms. Prints the bounding box, the
triangle count, and whether both horizontal dimensions are exact multiples of
the 0.25 m build grid.

glTF is Y-up and the exporter was run with export_yup=True, so the axes here are
the GAME's axes: x = width, y = height, z = depth. The grid contract applies to
x and z.

Usage: python3 tools/measure-glb.py <file.glb> [more.glb ...]
"""

import json
import struct
import sys
import os

GRID = 0.25

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
        5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise ValueError('%s: not a GLB (magic 0x%08X)' % (path, magic))
    js, bin_chunk = None, None
    off = 12
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        body = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_chunk = body
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    if js is None:
        raise ValueError('%s: no JSON chunk' % path)
    return js, bin_chunk


def accessor_vec3(js, buf, idx):
    acc = js['accessors'][idx]
    fmt, size = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    bv = js['bufferViews'][acc.get('bufferView', 0)]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or size * n
    out = []
    for i in range(acc['count']):
        o = base + i * stride
        out.append(struct.unpack_from('<' + fmt * n, buf, o))
    return out


def accessor_scalar_count(js, idx):
    return js['accessors'][idx]['count']


def node_matrix(node):
    """4x4 row-major as nested lists."""
    if 'matrix' in node:
        m = node['matrix']  # column-major in glTF
        return [[m[0], m[4], m[8], m[12]],
                [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]],
                [m[3], m[7], m[11], m[15]]]
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    rm = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[rm[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def xform(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3))


def measure(path):
    js, buf = read_glb(path)
    lo = [float('inf')] * 3
    hi = [float('-inf')] * 3
    tris = 0
    ident = [[1 if i == j else 0 for j in range(4)] for i in range(4)]

    def walk(idx, parent):
        nonlocal tris
        node = js['nodes'][idx]
        m = mat_mul(parent, node_matrix(node))
        if 'mesh' in node:
            for prim in js['meshes'][node['mesh']]['primitives']:
                if prim.get('mode', 4) != 4:
                    continue
                pts = accessor_vec3(js, buf, prim['attributes']['POSITION'])
                for p in pts:
                    w = xform(m, p)
                    for i in range(3):
                        lo[i] = min(lo[i], w[i])
                        hi[i] = max(hi[i], w[i])
                if 'indices' in prim:
                    tris += accessor_scalar_count(js, prim['indices']) // 3
                else:
                    tris += len(pts) // 3
        for c in node.get('children', []):
            walk(c, m)

    scene = js.get('scenes', [{}])[js.get('scene', 0)]
    for r in scene.get('nodes', range(len(js.get('nodes', [])))):
        walk(r, ident)

    dim = [hi[i] - lo[i] for i in range(3)]
    return dim, lo, hi, tris


def on_grid(v):
    q = v / GRID
    return abs(q - round(q)) < 1e-4


def main(paths):
    bad = 0
    for p in paths:
        dim, lo, hi, tris = measure(p)
        name = os.path.basename(p)[:-4]
        gx, gz = on_grid(dim[0]), on_grid(dim[2])
        flag = 'GRID-OK' if (gx and gz) else 'GRID-FAIL'
        if not (gx and gz):
            bad += 1
        print('%-20s %7.4f x %7.4f x %7.4f (w x h x d)  tris=%5d  minY=%+.4f  %s'
              % (name, dim[0], dim[1], dim[2], tris, lo[1], flag))
    if len(paths) > 1:
        print('--- %d files, %d off-grid' % (len(paths), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
