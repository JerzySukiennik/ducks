"""Find z-fighting candidates in an exported GLB: pairs of near-parallel faces
that sit closer together than a threshold AND actually overlap in projection.

Why this exists: the crank's wheel spins in front of the player's face for
seconds at a time, so any two surfaces sharing a plane flicker visibly. Eyeballing
a still frame cannot catch it -- z-fighting is a per-pixel depth tie that appears
and disappears as the camera or the wheel moves. Geometry can be checked exactly,
so it is checked exactly.

Method (all in the GLB's own metres, glTF Y-up = the GAME's axes):
  1. every triangle of every primitive is transformed by its node chain;
  2. each gets a unit normal n and a plane offset d = n . p. The normal is
     canonicalised (flipped so its first significant component is positive) so a
     face and the back of the face it hides land in the same bucket;
  3. pairs are kept when the normals are parallel within --angle degrees and the
     plane offsets differ by less than --gap metres;
  4. surviving pairs are projected into the shared plane's 2D basis and clipped
     against each other (Sutherland-Hodgman). Only a real overlap AREA above
     --minarea counts, so two triangles of the same quad -- coplanar, sharing an
     edge, touching but not overlapping -- are not reported.

Pairs are grouped and reported per (normal, gap) cluster, because one buried
plate against one cabinet wall is dozens of triangle pairs and one bug.

Usage:
  python3 tools/check-coplanar.py assets/models/crank.glb
  python3 tools/check-coplanar.py --gap 0.002 --verbose assets/models/*.glb
"""

import argparse
import json
import math
import os
import struct
import sys

import numpy as np

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
        5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, _version, length = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise ValueError('%s: not a GLB' % path)
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
    return js, bin_chunk


def accessor(js, buf, idx):
    acc = js['accessors'][idx]
    fmt, size = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    bv = js['bufferViews'][acc.get('bufferView', 0)]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or size * n
    out = np.empty((acc['count'], n), dtype=np.float64)
    for i in range(acc['count']):
        out[i] = struct.unpack_from('<' + fmt * n, buf, base + i * stride)
    return out


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    t = node.get('translation', [0, 0, 0])
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    rm = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)
    m = np.eye(4)
    m[:3, :3] = rm * np.array(s, dtype=np.float64)[None, :]
    m[:3, 3] = t
    return m


def load_triangles(path):
    """Returns (T, mats) with T shape (n, 3, 3) in glTF/game axes, and a per-tri
    material index (or -1)."""
    js, buf = read_glb(path)
    tris = []
    mats = []

    def walk(idx, parent):
        node = js['nodes'][idx]
        m = parent @ node_matrix(node)
        if 'mesh' in node:
            for prim in js['meshes'][node['mesh']]['primitives']:
                if prim.get('mode', 4) != 4:
                    continue
                pos = accessor(js, buf, prim['attributes']['POSITION'])
                pos = (m[:3, :3] @ pos.T).T + m[:3, 3]
                if 'indices' in prim:
                    idxs = accessor(js, buf, prim['indices']).astype(np.int64).ravel()
                else:
                    idxs = np.arange(len(pos))
                t = pos[idxs].reshape(-1, 3, 3)
                tris.append(t)
                mats.extend([prim.get('material', -1)] * len(t))
        for c in node.get('children', []):
            walk(c, m)

    scene = js.get('scenes', [{}])[js.get('scene', 0)]
    for r in scene.get('nodes', list(range(len(js.get('nodes', []))))):
        walk(r, np.eye(4))
    if not tris:
        return np.zeros((0, 3, 3)), []
    return np.concatenate(tris, axis=0), mats


def material_names(path):
    js, _ = read_glb(path)
    return [m.get('name', '?') for m in js.get('materials', [])]


def clip_area(a, b):
    """Area of the intersection of two 2D triangles (Sutherland-Hodgman)."""
    poly = [tuple(p) for p in a]
    # orient b counter-clockwise so its half-planes point inwards
    ax, ay = b[1][0] - b[0][0], b[1][1] - b[0][1]
    bx, by = b[2][0] - b[0][0], b[2][1] - b[0][1]
    bb = b if (ax * by - ay * bx) > 0 else b[::-1]
    for i in range(3):
        p0 = bb[i]
        p1 = bb[(i + 1) % 3]
        ex, ey = p1[0] - p0[0], p1[1] - p0[1]

        def inside(p):
            return (ex * (p[1] - p0[1]) - ey * (p[0] - p0[0])) >= 0.0

        out = []
        n = len(poly)
        for j in range(n):
            cur = poly[j]
            prv = poly[j - 1]
            ci, pi = inside(cur), inside(prv)
            if ci:
                if not pi:
                    out.append(intersect(prv, cur, p0, (ex, ey)))
                out.append(cur)
            elif pi:
                out.append(intersect(prv, cur, p0, (ex, ey)))
        poly = out
        if len(poly) < 3:
            return 0.0
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def intersect(p, q, o, e):
    dx, dy = q[0] - p[0], q[1] - p[1]
    ex, ey = e
    den = ex * dy - ey * dx
    if abs(den) < 1e-18:
        return q
    t = (ex * (p[1] - o[1]) - ey * (p[0] - o[0])) / -den
    return (p[0] + dx * t, p[1] + dy * t)


def check(path, gap=0.001, angle=2.0, minarea=4e-6, verbose=False, limit=40):
    T, tmat = load_triangles(path)
    n = len(T)
    e1 = T[:, 1] - T[:, 0]
    e2 = T[:, 2] - T[:, 0]
    nor = np.cross(e1, e2)
    ln = np.linalg.norm(nor, axis=1)
    keep = ln > 1e-12
    area = ln * 0.5
    nor = np.where(keep[:, None], nor / np.where(ln[:, None] == 0, 1, ln[:, None]), 0)
    # canonical direction: first significant component positive
    lead = np.zeros(n, dtype=np.int64)
    for i in range(n):
        v = nor[i]
        for ax in range(3):
            if abs(v[ax]) > 1e-9:
                lead[i] = ax
                break
    flip = nor[np.arange(n), lead] < 0
    cn = np.where(flip[:, None], -nor, nor)
    d = np.einsum('ij,ij->i', cn, T[:, 0])
    cos_lim = math.cos(math.radians(angle))

    # bucket by quantised normal to keep the pair search cheap, and by plane
    # offset slab so only nearby planes are compared
    Q = 0.05
    buckets = {}
    for i in range(n):
        if not keep[i]:
            continue
        key = (round(cn[i][0] / Q), round(cn[i][1] / Q), round(cn[i][2] / Q))
        buckets.setdefault(key, []).append(i)

    seen = set()
    hits = []
    keys = list(buckets)
    for key in keys:
        # neighbouring buckets too, so a normal near a bucket edge is not missed
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cand.extend(buckets.get((key[0] + dx, key[1] + dy, key[2] + dz), []))
        cand = sorted(set(cand), key=lambda i: d[i])
        for a in range(len(cand)):
            ia = cand[a]
            for b in range(a + 1, len(cand)):
                ib = cand[b]
                if d[ib] - d[ia] > gap:
                    break
                pair = (ia, ib) if ia < ib else (ib, ia)
                if pair in seen:
                    continue
                seen.add(pair)
                if abs(float(np.dot(cn[ia], cn[ib]))) < cos_lim:
                    continue
                # 2D basis in the shared plane
                nv = cn[ia]
                tmp = np.array([1.0, 0, 0]) if abs(nv[0]) < 0.9 else np.array([0, 1.0, 0])
                u = np.cross(nv, tmp)
                u /= np.linalg.norm(u)
                v = np.cross(nv, u)
                pa = np.stack([T[ia] @ u, T[ia] @ v], axis=1)
                pb = np.stack([T[ib] @ u, T[ib] @ v], axis=1)
                ar = clip_area(pa, pb)
                if ar < minarea:
                    continue
                same = float(np.dot(nor[ia], nor[ib])) > 0
                hits.append((float(abs(d[ib] - d[ia])), ia, ib, ar, same))

    # Cluster per PLANE, not per normal: two parallel faces of the same slab are
    # different bugs and must not be summed together. Key = canonical normal +
    # plane offset + gap + facing + material pair.
    clusters = {}
    for gapv, ia, ib, ar, same in hits:
        key = (round(cn[ia][0], 2), round(cn[ia][1], 2), round(cn[ia][2], 2),
               round(float(d[ia]), 3), round(gapv, 4), same,
               tuple(sorted((tmat[ia], tmat[ib]))))
        c = clusters.setdefault(key, {'pairs': 0, 'area': 0.0, 'ex': None,
                                      'lo': None, 'hi': None})
        c['pairs'] += 1
        c['area'] += ar
        if c['ex'] is None:
            c['ex'] = (ia, ib)
        pts = np.concatenate([T[ia], T[ib]], axis=0)
        c['lo'] = pts.min(axis=0) if c['lo'] is None else np.minimum(c['lo'], pts.min(axis=0))
        c['hi'] = pts.max(axis=0) if c['hi'] is None else np.maximum(c['hi'], pts.max(axis=0))

    mats = material_names(path)
    name = os.path.basename(path)
    nsame = sum(1 for h in hits if h[4])
    print('%s: %d triangles, %d coplanar-overlap pairs closer than %.4f m '
          '(%d same-facing, %d opposite-facing) in %d clusters'
          % (name, n, len(hits), gap, nsame, len(hits) - nsame, len(clusters)))
    # same-facing first: with backface culling those are the ones that fight
    order = sorted(clusters.items(), key=lambda kv: (not kv[0][5], -kv[1]['area']))
    for key, c in order[:limit]:
        nx, ny, nz, dv, gapv, same, mp = key
        mn = '/'.join(mats[m] if 0 <= m < len(mats) else '?' for m in mp)
        lo, hi = c['lo'], c['hi']
        print('  %-4s n=(%+.2f,%+.2f,%+.2f) d=%+.3f gap=%.4f  pairs=%3d  '
              'area=%.5f m^2  box=[%.3f..%.3f, %.3f..%.3f, %.3f..%.3f]  mats=%s'
              % ('SAME' if same else 'opp', nx, ny, nz, dv, gapv, c['pairs'],
                 c['area'], lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], mn))
        if verbose:
            ia, ib = c['ex']
            print('     A=%s' % np.round(T[ia], 4).tolist())
            print('     B=%s' % np.round(T[ib], 4).tolist())
    return nsame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--gap', type=float, default=0.001,
                    help='max plane separation counted as z-fighting risk (m)')
    ap.add_argument('--angle', type=float, default=2.0,
                    help='max angle between normals to call them parallel (deg)')
    ap.add_argument('--minarea', type=float, default=4e-6,
                    help='min projected overlap area to report (m^2)')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--limit', type=int, default=40)
    a = ap.parse_args()
    total = 0
    for f in a.files:
        total += check(f, a.gap, a.angle, a.minarea, a.verbose, a.limit)
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
