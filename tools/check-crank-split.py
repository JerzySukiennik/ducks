"""Re-run the game's crank split against the exported GLB and report what turns.

src/render/models.js does NOT split the crank triangle by triangle: it welds
vertices by position, unions the corners of every triangle, and asks the
predicate about the CENTROID OF EACH CONNECTED PART -- so a spoke that straddles
the plane goes whole, one way or the other. This script reproduces that exactly
(same 1e-4 weld, same vertex-mean centroid) and then applies main.js's predicate:

    x > machine.splitMinX  AND  (y-wheelLocalY)^2 + (z-wheelLocalZ)^2 < splitRadius^2

An earlier version of this model failed here: a frame post on the right-hand
corner satisfied both conditions, 747 cabinet triangles joined the wheel, and the
wheel's centre moved from 0.78 to 0.6575. That is what this re-checks.

Usage: python3 tools/check-crank-split.py assets/models/crank.glb
"""

import sys
import numpy as np

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import importlib.util

spec = importlib.util.spec_from_file_location(
    'coplanar', __file__.rsplit('/', 1)[0] + '/check-coplanar.py')
cop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cop)

# config.machine, kept in sync by hand -- this file is a checker, not a source
# of truth. src/config.js is the source of truth.
SPLIT_MIN_X = 0.40
SPLIT_RADIUS = 0.42
HUB = (0.4685, 0.78, -0.225)


def components(T):
    """models.js components(): weld by rounded position, union triangle corners."""
    n = len(T)
    parent = list(range(n * 3))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    seen = {}
    flat = T.reshape(-1, 3)
    keys = np.round(flat * 1e4).astype(np.int64)
    for i in range(len(flat)):
        k = (int(keys[i][0]), int(keys[i][1]), int(keys[i][2]))
        prev = seen.get(k)
        if prev is None:
            seen[k] = i
        else:
            union(i, prev)
    for t in range(n):
        union(t * 3, t * 3 + 1)
        union(t * 3 + 1, t * 3 + 2)
    groups = {}
    for t in range(n):
        groups.setdefault(find(t * 3), []).append(t)
    out = []
    for tris in groups.values():
        pts = T[tris].reshape(-1, 3)
        out.append((tris, pts.mean(axis=0)))
    return out


def main(path):
    T, _ = cop.load_triangles(path)
    parts = components(T)
    wheel, cabinet = [], []
    for tris, c in parts:
        dy = c[1] - HUB[1]
        dz = c[2] - HUB[2]
        inw = c[0] > SPLIT_MIN_X and dy * dy + dz * dz < SPLIT_RADIUS * SPLIT_RADIUS
        (wheel if inw else cabinet).append((tris, c))
    wt = sum(len(t) for t, _ in wheel)
    ct = sum(len(t) for t, _ in cabinet)
    wtris = np.concatenate([T[t] for t, _ in wheel]) if wheel else np.zeros((0, 3, 3))
    wc = wtris.reshape(-1, 3).mean(axis=0)
    lo = wtris.reshape(-1, 3).min(axis=0)
    hi = wtris.reshape(-1, 3).max(axis=0)
    print('%s' % path)
    print('  parts total      : %d  (%d wheel, %d cabinet)'
          % (len(parts), len(wheel), len(cabinet)))
    print('  triangles        : wheel %d / cabinet %d / total %d' % (wt, ct, wt + ct))
    print('  wheel centre     : (%.4f, %.4f, %.4f)' % (wc[0], wc[1], wc[2]))
    print('  wheel bbox       : x %.4f..%.4f  y %.4f..%.4f  z %.4f..%.4f'
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    pts = wtris.reshape(-1, 3)
    print('  max hub distance : %.4f (vertex; splitRadius %.2f applies to part centroids)'
          % (float(np.max(np.hypot(pts[:, 1] - HUB[1], pts[:, 2] - HUB[2]))),
             SPLIT_RADIUS))
    print('  wheel parts:')
    for tris, c in sorted(wheel, key=lambda p: -len(p[0])):
        print('    %4d tris  centroid (%+.4f, %+.4f, %+.4f)'
              % (len(tris), c[0], c[1], c[2]))
    # cabinet parts that come closest to being swallowed by the wheel
    near = []
    for tris, c in cabinet:
        dy, dz = c[1] - HUB[1], c[2] - HUB[2]
        near.append((c[0] - SPLIT_MIN_X, float(np.hypot(dy, dz)), len(tris), c))
    near.sort(key=lambda r: -r[0])
    print('  cabinet parts closest to the split plane (x - splitMinX):')
    for dxs, r, nt, c in near[:5]:
        print('    %+0.4f m  hubdist %.3f  %4d tris  centroid (%+.4f, %+.4f, %+.4f)'
              % (dxs, r, nt, c[0], c[1], c[2]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'assets/models/crank.glb'))
