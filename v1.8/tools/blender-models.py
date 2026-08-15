"""Ducks - generator wszystkich modeli gry. Uruchamiany w Blenderze przez BlenderMCP.
Styl: PSX low-poly, plaskie cieniowanie, wspolna paleta, skala metryczna.
Kazdy model stoi na z=0 i jest wysrodkowany w XY."""

import bpy, math, os
from mathutils import Vector

OUT = "/Users/jurek/Downloads/Claude/Projects/Ducks/tools/model-picker/models/blender"
os.makedirs(OUT, exist_ok=True)

# --- FOOTPRINTS ARE AUTHORED, NOT DISCOVERED --------------------------------
# The game snaps placement to a 0.25 m grid (config.build.grid), so an object's
# CENTRE always lands on that lattice. Two neighbours are therefore flush only
# if (widthA + widthB) / 2 is itself a multiple of 0.25 -- i.e. only if the
# footprints are grid multiples. They were not: a conveyor measured 2.22 m and a
# corner 1.45 m, so the closest legal pair either overlapped by 0.085 (refused)
# or left a 0.165 m gap that a duck fell into and stalled in forever. A wall was
# 2.06 m, so a "solid" fence had 0.19 m holes -- wider than a duck (0.20 x 0.18
# x 0.14). config.build.overlapEpsilon had been raised to 0.07 to paper over it.
#
# This table is the cure. Every placeable model is scaled, as the last step of
# finish(), so its exported bounding box is EXACTLY these metres in the two
# horizontal axes (Blender X and Y; the game's X and Z). Heights are never
# touched -- they play no part in tiling, and conveyor_slope's measured belt
# rise would move if they were.
#
# Two tiers, deliberately:
#   * Pieces meant to CHAIN -- the conveyor family and the wall/fence family --
#     get EVEN multiples (0.50 m lattice) on both horizontal axes wherever the
#     shape allows, so their half-extents land on the 0.25 grid and ANY two of
#     them butt together with a seam of exactly zero.
#   * Thin axes (wall/rail depth, broom, vacuum) get 0.25, an odd multiple.
#     Pairing an odd with an even multiple leaves at most 0.125 m -- narrower
#     than the duck's smallest dimension (0.14), so nothing can squeeze through
#     even in that mixed case.
#
# Wall is 2.00 and not 2.25 for exactly that reason: both tile on the grid, but
# 2.00 is even, so wall-to-wall AND wall-to-corner (1.00) are both seamless.
GRID = 0.25
FOOTPRINT = {
    # conveyor family -- everything 1.00 wide so a run reads as one belt
    "conveyor":        (1.00, 2.00),   # was 0.91 x 2.22
    "conveyor_corner": (1.50, 1.50),   # was 1.45 x 1.45
    "conveyor_slope":  (1.00, 2.00),   # was 1.08 x 2.04
    # fence family
    "wall":            (2.00, 0.25),   # was 2.06 x 0.22
    "wall_high":       (2.00, 0.25),   # was 2.06 x 0.22
    "rail":            (2.00, 0.25),   # was 2.02 x 0.23
    "corner":          (1.00, 1.00),   # was 1.145 x 1.145; 1.00 closes a 2.00 wall
    "pillar":          (0.50, 0.50),   # was 0.56 x 0.56
    # other placed geometry
    "ramp":            (1.50, 2.00),   # was 1.66 x 2.04
    "chute":           (0.75, 2.00),   # was 0.81 x 2.06
    "bridge":          (1.00, 3.00),   # was 1.11 x 3.20
    # machines
    "press":           (1.00, 0.75),   # was 1.05 x 0.80
    "machine":         (1.50, 1.25),   # was 1.40 x 1.33
    "vacuum_station":  (1.00, 1.00),   # was 0.88 x 1.03
    "fan":             (1.25, 0.75),   # was 1.26 x 0.84
    # items
    #
    # THE STORAGE FAMILY IS SIZED BY WHAT IT HOLDS, not by what looks tidy.
    # A duck is a 0.178 x 0.386 x 0.146 box (config.ducks, two colliders since
    # the head and neck got collision), and src/sim/containers.js packs the
    # contents on a lattice that may never put two of them closer than that.
    # So the interior has to have room for `storage.capacity` duck-sized cells,
    # or the row is promising something the geometry cannot do -- which is
    # exactly what a bucket claiming eight and showing two was.
    #
    # Heights are literals in the builders below; only these two horizontal
    # numbers are snapped here. Slot counts the interiors buy, measured by
    # work/slot-search.js against the real buildSlots:
    #   bucket  0.75 x 0.90 x 0.75  -> 12 places (capacity 8)
    #   box     1.00 x 0.75 x 1.00  -> 20 places (capacity 16)
    #   box_big 1.25 x 1.10 x 1.25  -> 32 places (capacity 30, 25 of them real)
    #   cart    1.25 x 1.00 x 2.25  -> 28 places (capacity 24)
    #   container unchanged         -> 576 places (capacity 200, 25 of them real)
    "bucket":          (0.75, 0.75),   # was 0.50 x 0.50; 8 ducks did not fit
    "box":             (1.00, 1.00),   # was 0.75 x 0.75
    "box_big":         (1.25, 1.25),   # was 1.00 x 1.00
    "container":       (2.25, 4.50),   # already holds its physical 25
    "cart":            (1.25, 2.25),   # was 1.00 x 2.00
    "broom":           (0.50, 0.25),   # was 0.46 x 0.11
    "vacuum":          (0.25, 1.00),   # was 0.32 x 1.00

    # --- phase 1 catalog, group 1: machines that emit N ducks per cycle -------
    # Nothing here chains, so these take the plain 0.25 lattice; the two big
    # ones (factory, geyser) are still even multiples because their half-extents
    # are what a player butts a conveyor against.
    "hive":            (1.00, 1.00),
    "incubator_double":(1.50, 1.00),
    "press_belt":      (1.00, 2.00),
    "feeder_vibe":     (1.00, 1.50),
    "slot_machine":    (0.75, 0.75),
    "factory":         (2.50, 2.00),
    "geyser":          (1.50, 1.50),
    "pipe_endless":    (1.00, 1.00),

    # --- phase 1 catalog, group 2: producers that are pure data ---------------
    # Every one fits producer_auto as it stands; only the seconds and the rarity
    # weights differ, so the GEOMETRY is what has to tell them apart. Three of
    # them roll rare ducks only, and those wear the gold/teal end of the palette
    # so a player can read the tier off the silhouette from across the yard.
    "machine_slow":    (1.00, 1.00),
    "condenser":       (1.00, 1.00),
    "duckomat":        (1.00, 0.75),
    "hatchery":        (1.25, 1.00),
    "printer3d":       (1.00, 1.00),
    "press_gold":      (1.00, 0.75),
    "reactor":         (1.50, 1.50),

    # --- phase 1 catalog, group 3: buildings ----------------------------------
    # The fence family CHAINS, so wall_glass / fence_mesh / wall_soft / neon_ducks
    # copy wall exactly: 2.00 x 0.25. 2.00 is an EVEN multiple, so a half-extent
    # of 1.00 is itself on the grid and any two of them -- or one of them and the
    # 1.00 m corner -- butt with a seam of exactly zero. Getting cute with 2.25
    # here is what put 0.19 m holes in a "solid" fence the first time.
    # The floor pieces (platform, roof, ice_slide, vibe_floor) are even multiples
    # for the same reason: they tile edge to edge.
    "wall_glass":      (2.00, 0.25),
    "wall_soft":       (2.00, 0.25),
    "fence_mesh":      (2.00, 0.25),
    "neon_ducks":      (2.00, 0.25),
    "slide":           (1.00, 3.00),
    "fan_strong":      (1.50, 1.00),
    "fan_vertical":    (1.00, 1.00),
    "vibe_floor":      (1.00, 2.00),
    "platform":        (2.00, 2.00),
    "stairs":          (1.00, 2.00),
    "roof":            (2.00, 2.00),
    "ice_slide":       (2.00, 2.00),
    "pit_kerb":        (1.00, 0.50),
    "lamp_post":       (0.50, 0.50),
    "sign_dir":        (0.75, 0.25),
    "bumper":          (1.00, 1.00),
    "trampoline":      (1.50, 1.50),

    # --- phase 1 catalog, group 4: tools and containers -----------------------
    # THE STORAGE ONES ARE SIZED BY WHAT THEY HOLD, same rule as bucket/box
    # above: a duck's collider is 0.178 x 0.386 x 0.146, so an interior has to
    # have room for capacity duck-sized cells or the row promises something the
    # geometry cannot do. sack / crate_wood / dumper are therefore >= 0.75 in
    # both horizontal axes -- a 0.50 sack would hold two ducks, not the ten its
    # silhouette implies. bucket_leaky copies the (already corrected) 0.75 bucket
    # exactly, because it IS a bucket, just one that leaks.
    "sack":            (0.75, 0.75),
    "crate_wood":      (1.00, 1.00),
    "bucket_leaky":    (0.75, 0.75),
    "dumper":          (1.25, 1.75),
    "pallet_jack":     (0.75, 2.00),
    # handhelds: the thin axis gets 0.25 like broom/vacuum already do
    "broom_wide":      (1.00, 0.25),
    "vacuum_industrial":(0.75, 0.75),
    "leaf_blower":     (0.25, 1.00),
    "pusher":          (1.25, 0.50),
    "lasso":           (0.50, 0.50),
    "fire_hose":       (0.75, 0.75),
    "fan_handheld":    (0.50, 0.25),
    "plank":           (0.25, 2.00),
    "horn":            (0.25, 0.50),
    "rake":            (0.75, 0.25),
    "magnet":          (0.50, 0.25),
    "dustpan":         (0.50, 0.75),

    # --- gambling box: TWO models, one object -------------------------------
    # finish() joins everything it is given into a single mesh, so a model with
    # an independently animated part cannot be one model. The body and the lid
    # are therefore exported separately, on the SAME 0.75 footprint, each with
    # its own origin centred in XY and its own underside on z=0 -- which is what
    # lets the renderer put the lid at the body's height with an identity
    # rotation and have it look shut. The hinge the renderer rotates about is the
    # lid's rear bottom edge: y=0, z=+0.375 in the exported (Y-up) frame.
    "gamble_box":      (0.75, 0.75),
    "gamble_box_lid":  (0.75, 0.75),
    # NOT listed on purpose: "crank". Its footprint (1.31 x 1.33) is off-grid,
    # but the Manual Duck Workbench is also world scenery, and config.machine.*
    # holds a dozen hand-measured model-local coordinates against THIS mesh --
    # wheel hub, split plane, output pipe mouth, cabinet collider. Rescaling the
    # crank moves every one of them silently. It costs nothing to leave: a crank
    # half-extent of 0.656 against any grid piece lands 0.094 m off the lattice,
    # and 0.094 < 0.14, so no duck fits through the seam. Fixing it properly
    # means re-measuring config.machine.* in the same pass.
}


PAL = {
    "steel":   (0.42, 0.45, 0.50), "steel_d": (0.28, 0.30, 0.34),
    "dark":    (0.13, 0.13, 0.16), "black":   (0.07, 0.07, 0.09),
    "teal":    (0.11, 0.44, 0.45), "teal_lt": (0.17, 0.60, 0.60),
    "hazard":  (0.95, 0.75, 0.08), "orange":  (0.90, 0.42, 0.10),
    "wood":    (0.55, 0.36, 0.18), "wood_lt": (0.68, 0.48, 0.26),
    "white":   (0.86, 0.86, 0.88), "glass":   (0.08, 0.16, 0.20),
    "red":     (0.75, 0.16, 0.14), "skin":    (0.86, 0.66, 0.50),
    "denim":   (0.20, 0.28, 0.46), "rubber":  (0.10, 0.10, 0.12),
    "duck":    (0.98, 0.80, 0.10), "beak":    (0.95, 0.50, 0.06),
    "concrete":(0.55, 0.55, 0.57), "rust":    (0.45, 0.22, 0.10),
    "blue":    (0.16, 0.34, 0.62),
}

def mat(name):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]; c = PAL[name]
    b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1.0)
    b.inputs["Roughness"].default_value = 0.78
    if "Specular IOR Level" in b.inputs: b.inputs["Specular IOR Level"].default_value = 0.2
    m.diffuse_color = (c[0], c[1], c[2], 1.0); m.roughness = 0.78
    return m

def _rng(seed):
    s = [seed & 0xffffffff]
    def r():
        s[0] ^= (s[0] << 13) & 0xffffffff; s[0] ^= s[0] >> 17
        s[0] ^= (s[0] << 5) & 0xffffffff
        return s[0] / 0xffffffff
    return r

def make_image(name, W, H, fn):
    """Tworzy obraz proceduralny. fn(u,v,rand) -> (r,g,b,a)."""
    img = bpy.data.images.get(name)
    if img: bpy.data.images.remove(img)
    img = bpy.data.images.new(name, W, H, alpha=True)
    rnd = _rng(0x9E3779B9 ^ (len(name) * 2654435761))
    px = [0.0] * (W * H * 4)
    for y in range(H):
        for x in range(W):
            r, g, b, a = fn(x / (W - 1.0), y / (H - 1.0), rnd)
            i = (y * W + x) * 4
            px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a
    img.pixels.foreach_set(px)
    img.pack()
    return img

def tex_mat(name, img, alpha=False, repeat=1.0):
    m = bpy.data.materials.get(name)
    if m: bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    tex.interpolation = "Closest"          # PSX: bez wygladzania
    tex.location = (-420, 200)
    mp = nt.nodes.new("ShaderNodeMapping"); mp.location = (-620, 200)
    co = nt.nodes.new("ShaderNodeTexCoord"); co.location = (-820, 200)
    mp.inputs["Scale"].default_value = (repeat, repeat, 1.0)
    nt.links.new(co.outputs["UV"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.blend_method = "BLEND"
    m.diffuse_color = (0.27, 0.27, 0.29, 1.0)
    return m

def clear():
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
    for d in list(bpy.data.meshes):
        if d.users == 0:
            try: bpy.data.meshes.remove(d)
            except Exception: pass

def box(name, size, loc, color, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    o.data.materials.append(mat(color)); return o

def cyl(name, r, h, loc, color, verts=12, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name
    bpy.ops.object.transform_apply(rotation=True)
    o.data.materials.append(mat(color)); return o

def cone(name, r1, r2, h, loc, color, verts=10, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name
    bpy.ops.object.transform_apply(rotation=True)
    o.data.materials.append(mat(color)); return o

def ball(name, r, loc, color, seg=10, ring_count=6, scale=(1,1,1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring_count, radius=r, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat(color)); return o

def ring_xz(prefix, R, seg, seclen, secd, sech, z, color, out):
    """Pierscien w plaszczyznie XZ. Obrot wokol Y o +a odwzorowuje os X na styczna."""
    for i in range(seg):
        a = math.radians(i * 360.0 / seg)
        out.append(box("%s%d" % (prefix, i), (seclen, secd, sech),
                       (math.sin(a)*R, 0, z + math.cos(a)*R), color, rot=(0, a, 0)))

def ring_yz(prefix, R, seg, thick, seclen, secr, x, zc, color, out, sep=0.0):
    """Pierscien w plaszczyznie YZ - plaszczyznie kola korby, ktore obraca sie
    wokol lokalnej osi X. Obrot wokol X o -a odwzorowuje os Y na styczna.

    sep > 0: co drugi segment jest o 2*sep chudszy i o sep dalej od srodka.
    Segmenty zachodza na siebie, a obrot wokol X nie zmienia orientacji ich
    BOCZNYCH scian - wiec bez tego wszystkie leza w dwoch wspolnych
    plaszczyznach i kazda para sasiadow to remis w buforze glebi. Ring jedzie na
    kole warsztatu, czyli obraca sie graczowi przed nosem: remis widac od razu.
    Sprawdzane przez tools/check-coplanar.py."""
    for i in range(seg):
        a = math.radians(i * 360.0 / seg)
        odd = sep > 0 and i % 2
        rr = R + (sep if odd else 0.0)
        out.append(box("%s%d" % (prefix, i), (thick - (2*sep if odd else 0.0), seclen, secr),
                       (x, math.sin(a)*rr, zc + math.cos(a)*rr), color, rot=(-a, 0, 0)))


def ring_xy(prefix, R, seg, seclen, secw, sech, z, color, out):
    """Pierscien lezacy plasko w XY."""
    for i in range(seg):
        a = math.radians(i * 360.0 / seg)
        out.append(box("%s%d" % (prefix, i), (seclen, secw, sech),
                       (math.sin(a)*R, math.cos(a)*R, z), color, rot=(0, 0, -a)))

# --- CAVITIES ARE MEASURED HERE, NOT RE-DERIVED IN THE GAME ------------------
# A storage model's bounding box is not the space it holds ducks in: a barrow's
# box is mostly handles, legs and a wheel, and a bucket's is a shade wider than
# the pail because of its grips. src/sim/containers.js lays its slot lattice
# inside `storage.interior` from src/data/tools.js, so that block has to be the
# real inner cavity -- and the one place the cavity is known exactly is right
# next to the literals that built the walls.
#
# A builder calls cavity() with the raw box, in its own pre-finish coordinates.
# finish() then puts it through the SAME centring and the SAME (per-axis,
# frequently non-uniform) grid-snap scale it puts the mesh through, so the
# number build_all reports is the cavity of the exported GLB rather than of the
# author's intentions. Copy it into tools.js verbatim.
CAVITY_RAW = {}
CAVITY_OUT = {}


def cavity(name, xr, yr, zr):
    """Raw inner box, (min,max) per axis, in the builder's own coordinates."""
    CAVITY_RAW[name] = (xr, yr, zr)


def finish(objs, name, bevel=0.0, merge=0.0, origin="floor"):
    """origin="floor" (domyslnie): bryla laduje wysrodkowana w XY i postawiona
    na z=0 - kontrakt dla wszystkiego, co stoi na ziemi.

    origin="raw": wspolrzedne autora ZOSTAJA. Potrzebne dla czesci, ktore nie
    stoja na podlodze tylko montuja sie do innego modelu (crank_bot na piascie
    kola): dla nich (0,0,0) ma byc PUNKTEM MONTAZU, a nie srodkiem obrysu, bo
    inaczej kod dolaczajacy musialby znac obrys, zeby policzyc offset."""
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object; o.name = name
    if merge > 0:                      # scala stykajace sie wierzcholki - konczy z-fighting
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=merge)
        bpy.ops.object.mode_set(mode="OBJECT")
    if bevel > 0:                      # lamie ostre krawedzie - mniej "kanciasto"
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel; m.segments = 1
        m.limit_method = "ANGLE"; m.angle_limit = math.radians(50)
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_flat()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
    minz = min(v.z for v in ws)
    x0, x1 = min(v.x for v in ws), max(v.x for v in ws)
    y0, y1 = min(v.y for v in ws), max(v.y for v in ws)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    # Grid snap. Scaling about the (already centred) bounding box in X and Y is
    # what makes the exported footprint EXACT rather than approximately right --
    # every literal above is authored close to its target so these factors stay
    # within a few percent, but the last micron comes from here, not from luck.
    # Z is deliberately untouched: heights do not tile.
    fx = fy = 1.0
    tgt = FOOTPRINT.get(name)
    if tgt:
        fx = tgt[0] / (x1 - x0)
        fy = tgt[1] / (y1 - y0)
    if origin != "floor":              # czesc montowana: nie ruszamy ukladu autora
        cx = cy = minz = 0.0
        fx = fy = 1.0
    for v in o.data.vertices:
        v.co.x = (v.co.x - cx) * fx
        v.co.y = (v.co.y - cy) * fy
        v.co.z -= minz
    o.data.update()
    # The cavity rides the same transform as the mesh, then is written out in
    # the GAME's axis order and frame: [x, height, depth] half-extents and an
    # offset from the BODY CENTRE, which is what collider.half is measured from.
    raw = CAVITY_RAW.get(name)
    if raw:
        (rx0, rx1), (ry0, ry1), (rz0, rz1) = raw
        gx0, gx1 = (rx0 - cx) * fx, (rx1 - cx) * fx
        gz0, gz1 = (ry0 - cy) * fy, (ry1 - cy) * fy
        gy0, gy1 = rz0 - minz, rz1 - minz
        height = max(v.z for v in ws) - minz
        CAVITY_OUT[name] = {
            "half": [round((gx1-gx0)/2, 4), round((gy1-gy0)/2, 4), round((gz1-gz0)/2, 4)],
            "offset": [round((gx0+gx1)/2, 4),
                       round((gy0+gy1)/2 - height/2, 4),
                       round((gz0+gz1)/2, 4)],
        }
    return o, sum(len(p.vertices)-2 for p in o.data.polygons)

def export(o, name):
    for x in bpy.context.selected_objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    p = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=p, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    return p, os.path.getsize(p)


# ============================================================== KACZKA
def b_duck():
    """Kaczka o PIONOWEJ, wyprostowanej sylwetce - korpus stoi, nie lezy jak lodka.
    UWAGA: 300 sztuk naraz na mapie, kazdy trojkat liczy sie x300."""
    P = []
    Z = 0.10                                       # wysokosc nog
    P.append(ball("body", 0.098, (0, 0.012, Z+0.132), "duck", seg=10, ring_count=7,
                  scale=(0.95, 0.92, 1.45)))       # wydluzony w PIONIE
    P.append(ball("breast", 0.072, (0, -0.048, Z+0.115), "duck", seg=8, ring_count=5,
                  scale=(0.92, 0.85, 1.20)))
    P.append(cyl("neck", 0.040, 0.085, (0, -0.026, Z+0.263), "duck", verts=8,
                 rot=(math.radians(-12), 0, 0)))
    P.append(ball("head", 0.058, (0, -0.040, Z+0.322), "duck", seg=9, ring_count=6,
                  scale=(1.0, 1.02, 1.05)))
    P.append(cone("beak", 0.037, 0.013, 0.072, (0, -0.098, Z+0.308), "beak", verts=7,
                  rot=(math.radians(90), 0, 0)))
    P.append(box("tail", (0.062, 0.070, 0.038), (0, 0.098, Z+0.072), "duck",
                 rot=(math.radians(34), 0, 0)))
    for sx in (-1, 1):
        P.append(box("eye", (0.018, 0.013, 0.018), (sx*0.028, -0.078, Z+0.338), "black"))
        P.append(ball("wing", 0.046, (sx*0.078, 0.020, Z+0.132), "duck", seg=7, ring_count=4,
                      scale=(0.30, 0.95, 1.45)))
        P.append(cyl("leg", 0.016, Z + 0.06, (sx*0.038, -0.004, (Z+0.06)/2), "beak", verts=7))
        P.append(box("foot", (0.064, 0.104, 0.020), (sx*0.038, -0.030, 0.010), "beak"))
    return finish(P, "duck", merge=0.0005)


# ============================================================= MASZYNY
def b_crank():
    """Manual Duck Workbench. Gracz patrzy na to 5 sekund CIAGIEM na kazda kaczke,
    wiec jest to najdluzej ogladany model w grze i musi to wytrzymac.

    DWIE RZECZY BYLY ZLE i obie sa tu naprawione.

    1. KOLO. Bylo PELNYM DYSKIEM (jeden cylinder r=0.34) z czterema szprychami
       schowanymi w srodku i cale w kolorze hazard. Pelny dysk obracajacy sie
       wokol wlasnej osi ma sylwetke NIEZMIENNA - obraca sie z predkoscia 30
       rad/s i wyglada, jakby stal. Cala informacja o ruchu szla wtedy wylacznie
       z rozmycia, ktorego przy tym rozmiarze bufora nie ma. Teraz kolo jest
       OTWARTE: obrecz z segmentow, szesc szprych widocznych na wylot i korba
       sterczaca poza plaszczyzne, ktora zakresla luk. Sylwetka zmienia sie co
       60 stopni, wiec obrot widac nawet na stopklatce.

    2. KOLORY. Korpus byl w teal, maska w teal_lt - duza, jasna, nasycona bryla
       o jednolitej barwie, czyli dokladnie to, co czyta sie jako zabawka. Teraz
       korpus jest z ciemnej stali, a zolty zostal TYLKO tam, gdzie cos znaczy:
       na kole (to jest rzecz, ktora sie chwyta) i na wylocie rury. Maszyna ma
       byc ciezka i czytelna, a nie kolorowa.

    CZEGO NIE WOLNO RUSZYC - to nie sa preferencje, to kontrakty z kodem:
      * bryla ma dokladnie 1.3124 x 1.4100 x 1.3300; machines.js trzyma
        footprint [2.096, 2.256, 2.128], czyli te liczby razy machine.scale 1.6,
      * piasta kola siedzi w (0.4685, 0.78, -0.225) modelu, promien 0.34,
      * KAZDY trojkat kola musi miec centroid x > machine.splitMinX (0.40) i
        lezec blizej niz splitRadius (0.42) od piasty w plaszczyznie YZ - tak
        main.js oddziela kolo od korpusu; trojkat, ktory wypadnie z tego okna,
        przestanie sie krecic albo zabierze ze soba kawalek szafy,
      * wylot rury (-0.043, 0.42, 0.66) i collider szafy zostaja gdzie byly.
    """
    P = []
    # --- ZASADA 3 MM (SEP) ---------------------------------------------------
    # ZADNE dwie rownolegle sciany, ktore zachodza na siebie w rzucie, nie moga
    # lezec w JEDNEJ plaszczyznie. Dwie takie sciany to remis w buforze glebi i
    # migotanie - a kolo warsztatu obraca sie graczowi przed nosem sekundami,
    # wiec kazdy remis widac od razu. Minimalny rozstaw to SEP = 0.003 m modelu,
    # czyli 0.0048 m w swiecie (config.machine.scale 1.6).
    #
    # Dlaczego akurat 3 mm: bufor glebi jest tu najmniejszym problemem (near 0.1,
    # far 400, kolo 1-2 m od oka - nawet 16-bitowy bufor rozroznia tam ~0.3 mm),
    # wiec 3 mm ma zapas rzedu wielkosci i dziala takze na 5 m, gdzie stoi drugi
    # gracz. Z drugiej strony 3 mm to szosta czesc bevela (0.020) i przy skali
    # PSX nie widac go jako uskoku - to najmniejsza liczba, ktora jest OCZYWISCIE
    # bezpieczna i wciaz niewidoczna. Sprawdzane maszynowo:
    #   python3 tools/check-coplanar.py assets/models/crank.glb
    SEP = 0.003
    # Korpus: ciemna stal zamiast teal. Rama jest teraz WIDOCZNA - slupki naroine
    # i poziome ceowniki - bo to one robia z pudelka maszyne.
    #
    # Cokol i podcieniowka byly 1.00 szerokie, czyli DOKLADNIE tyle co korpus:
    # ich boki lezaly w tej samej plaszczyznie co blacha szafy (+-0.50) i tam
    # migotalo. Teraz kazdy pas jest stopniowany na zewnatrz - 0.50 korpus,
    # 0.51 cokol, 0.52 podcieniowka, 0.54 fartuch - wiec zadna para scian nie
    # dzieli plaszczyzny, a maszyna wyglada na zlozona z warstw zamiast z jednej
    # bryly. Zaden z tych pasow nie dotyka okna podzialu kola: ich centroidy
    # leza na x=0, wiec caly pas idzie do szafy.
    #
    # W PIONIE ta sama zasada, tylko realizowana wsuwaniem: fartuch jako
    # najszersza bryla trzyma spod modelu na z=0 (finish() liczy od niego minz,
    # wiec to on decyduje o wysokosci piasty), a korpus zaczyna sie SEP wyzej i
    # konczy tam gdzie konczyl - jego denko chowa sie w fartuchu zamiast lezec
    # z nim w plaszczyznie z=0. Tak samo cokol wchodzi SEP w fartuch, a maska
    # SEP w korpus. Zaden z tych ruchow nie dotyka obrysu: gora maski zostaje na
    # 1.41 (wysokosc 1.4100), spod fartucha na 0.
    P.append(box("body", (1.00, 0.80, 1.15 - SEP), (0, 0, 0.575 + SEP/2), "steel_d"))
    P.append(box("skirt", (1.08, 0.88, 0.14), (0, 0, 0.07), "black"))
    P.append(box("plinth", (1.02, 0.88, 0.07 + 2*SEP), (0, 0, 0.175 - SEP), "dark"))
    P.append(box("hood", (1.02, 0.84, 0.26 + 2*SEP), (0, 0, 1.28 - SEP), "steel_d"))
    P.append(box("hoodlip", (1.04, 0.88, 0.05), (0, 0, 1.16), "dark"))
    # PRAWY BOK SZAFY JEST STREFA ZAKAZANA DLA DETALU. Podzial kola bierze kazdy
    # trojkat o centroidzie game x > 0.40 lezacy blizej niz 0.42 od piasty w YZ -
    # a slupek ramy postawiony na prawym naroiniku spelnia OBA warunki i zaczyna
    # sie krecic razem z kolem. Zlapal to dopiero splitcheck: pierwsza wersja tej
    # ramy wciagala do kola 747 trojkatow szafy i przesuwala jego srodek z 0.78
    # na 0.6575. Dlatego rama wychodzi na zewnatrz TYLKO w -X i w osi Y.
    #
    # Wychodzi z tego asymetria, ktora i tak byla potrzebna: lewy bok jest
    # uzebrowany, prawy gladki pod kolo. Maszyna przestaje byc kostka.
    for sy in (-1, 1):
        P.append(box("frame", (0.10, 0.10, 1.02), (-0.4947, sy*0.375, 0.62), "dark"))
        # Zastrzal byl DOKLADNIE tak samo gruby jak slupek (0.10) i konczyl sie
        # dokladnie na blasze szafy (-0.50): trzy pary scian wspolplaszczyznowych
        # naraz, plus cztery pary sciec bevela pod 45 stopni, ktore z nich
        # wynikaly. Teraz jest o 2*SEP wezszy od slupka i o SEP krotszy, wiec
        # chowa sie w nim zamiast z nim walczyc.
        P.append(box("gusset", (0.16 - SEP, 0.10 - 2*SEP, 0.10 - 2*SEP),
                     (-0.42 + SEP/2, sy*0.375, 1.08 - SEP), "dark"))
    for z in (0.42, 0.98):                  # ceowniki - wystaja w Y, nie w X
        P.append(box("belt", (0.98, 0.88, 0.05), (0, 0, z), "dark"))
    P.append(box("boltplate", (0.10, 0.34, 0.34), (-0.490, -0.10, 0.66), "steel"))
    P.append(box("panel", (0.62, 0.06, 0.42), (0, -0.42, 0.92), "glass"))
    # RURA WYRZUTOWA - pusta w srodku, POZIOMA wzdluz -Y.
    # Segmenty ustawione tak jak w ring_xz: obrot (0, a, 0) daje styczna na X,
    # a os rury lezy na Y. Wczesniej obracalem kazdy segment o ten sam kat
    # zamiast wokol osi rury - stad rozsypany plaszcz.
    #
    # DZIESIEC segmentow, nie czternascie. Plaszcz rury jest z segmentow
    # zachodzacych na siebie o 45% (mnoznik 1.45), a mnoznik jest WZGLEDNY -
    # przy dziesieciu segment jest odpowiednio szerszy, wiec rura dalej jest
    # szczelna, tylko grubiej ciosana, co przy PSX jest zaleta. Kosztowala 28
    # bryl (rura + obrecz) prawie w calosci schowanych w kolnierzu i w szafie;
    # warsztat stawia sie w ilosciach, wiec te osiem bryl to czysty zysk.
    NP, RP, LP = 10, 0.175, 0.52
    ZP = 0.40                                   # wysokosc osi rury
    YC = -0.62                                  # srodek rury
    # Segmenty obracaja sie WOKOL OSI RURY, wiec ich denka - w przeciwienstwie do
    # segmentow obreczy kola - zostaja prostopadle do tej samej osi Y i wszystkie
    # ladowaly w jednej plaszczyznie. Sasiedzi zachodza na siebie o 45%, wiec
    # kazda para sasiadow to remis glebi na obu koncach rury, a jeden z tych
    # koncow to wylot, w ktory gracz patrzy. Co drugi segment jest wiec o 2*SEP
    # krotszy: denka rozjezdzaja sie o SEP na kazdym koncu, a ze skracanie idzie
    # symetrycznie wzgledem YC, obrys modelu (glebokosc 1.3300) sie nie rusza.
    for i in range(NP):
        a = math.radians(i * 360.0 / NP)
        P.append(box("pipe%d" % i, (2*math.pi*RP/NP*1.45, LP - (2*SEP if i % 2 else 0), 0.05),
                     (math.sin(a)*RP, YC, ZP + math.cos(a)*RP), "steel_d", rot=(0, a, 0)))
    RL = RP + 0.045
    for i in range(NP):                          # obrecz na samym wylocie
        a = math.radians(i * 360.0 / NP)
        # ta sama sztuczka co wyzej; obrecz jest tym, co widac z przodu wylotu,
        # wiec to tu remis glebi bolal najbardziej. i=0 zachowuje pelna dlugosc,
        # wiec najdalszy punkt modelu w -Y (i cala glebokosc) zostaje bez zmian.
        P.append(box("lip%d" % i, (2*math.pi*RL/NP*1.45, 0.10 - (2*SEP if i % 2 else 0), 0.09),
                     (math.sin(a)*RL, YC - LP/2 + 0.04, ZP + math.cos(a)*RL), "hazard", rot=(0, a, 0)))
    P.append(box("collar", (0.46, 0.16, 0.46), (0, -0.40, ZP), "dark"))
    for i, x in enumerate((-0.18, 0.0, 0.18)):
        P.append(box("led%d" % i, (0.07, 0.05, 0.07), (x, -0.42, 0.60), "hazard"))
    # --- KOLO: otwarte, nie dysk -------------------------------------------
    # Wszystko ponizej siedzi w oknie podzialu: blender x 0.5115..0.7677 (czyli
    # game x 0.40..0.6562) i nie dalej niz 0.42 od piasty w YZ. Piasta: blender
    # (x dowolne, y=0, z=0.78) -> game (0.4685, 0.78, -0.225).
    WX, WZ, WR = 0.585, 0.78, 0.34
    # Ciemna tarcza ZA kolem. Szprychy sa stalowe, szafa tez byla stalowa, wiec
    # kolo gubilo sie na wlasnym tle.
    #
    # TO BYLO ZRODLO ZGLOSZONEGO MIGOTANIA. Plyta miala 0.02 grubosci i srodek na
    # x=0.49, wiec jej PRZEDNIA sciana wypadala na 0.50 - dokladnie w plaszczyznie
    # prawej blachy korpusu (polowa z 1.00). Tarcza nie stala wiec za kolem, tylko
    # LEZALA w blasze: 0.377 m^2 czarnego na stalowym, remis w buforze glebi na
    # calej powierzchni, a przed tym wszystkim obracajace sie kolo, ktore co
    # klatke zmienia oswietlenie i kat - stad "miga, gdy kolo sie kreci".
    #
    # Teraz plyta jest grubsza (0.05) i wysunieta tak, ze jej lico stoi 5 mm PRZED
    # blacha (0.505 wobec 0.50), a tyl chowa sie w szafie. Zadnej wspolnej
    # plaszczyzny: 0.455 i 0.505 wobec 0.50 blachy, 0.51 denka kapsla piasty i
    # 0.5425 wewnetrznego lica obreczy.
    #
    # PODZIAL: main.js pyta o centroid CALEJ SPOJNEJ CZESCI (models.js/partition
    # dzieli komponentami, nie trojkatami), a centroid tarczy to jej srodek,
    # blender 0.480 -> game 0.3685, z zapasem 31 mm pod splitMinX 0.40. Tarcza
    # nie dotyka zadnej bryly kola (najblizsza to piasta 0.52), wiec nie sklei
    # sie z nia w jeden komponent przy merge=0.0008.
    P.append(cyl("backplate", 0.365, 0.05, (0.480, 0, WZ), "black", verts=12,
                 rot=(0, math.radians(90), 0)))
    # Obrecz na PRZEMIAN zolta i ciemna. To jest najtanszy sposob, jaki znalazlem,
    # na pokazanie obrotu: dwanascie segmentow na zmiane daje szesc par, wiec przy
    # kreceniu obrecz miga, zamiast byc jednolita zolta rura. Osobny ciemny
    # pierscien boczny robil to samo za 14 dodatkowych bryl - ten kosztuje zero.
    #
    # DRUGIE ZRODLO MIGOTANIA, i to wprost na kole. Segmenty obreczy zachodza na
    # siebie o 45%, a obrot (-a,0,0) jest wokol osi X - czyli ich BOCZNE sciany
    # (normalna +-X) zostaja rownolegle bez wzgledu na kat i wszystkie dwanascie
    # ladowalo w dwoch plaszczyznach: 0.5425 i 0.6275. Kazda para sasiadow miala
    # tam wspolna powierzchnie, i to para o RÓZNYCH kolorach - zolty przeciw
    # ciemnemu - wiec remis glebi nie dawal szumu, tylko naprzemienne plamy
    # skaczace przy kazdym stopniu obrotu. Sciec bevela to nie ratowalo.
    #
    # Lek: co drugi segment (ten ciemny) jest o 2*SEP chudszy, wiec jego lica
    # stoja 3 mm w glebi lic segmentu zoltego. Zadna para nie dzieli juz
    # plaszczyzny, a roznica czyta sie jako biezik na obreczy - przy kreceniu
    # pomaga tak samo jak sam kolor. Kosztuje zero trojkatow.
    NRIM = 12
    RR = WR - 0.035
    for i in range(NRIM):
        a = math.radians(i * 360.0 / NRIM)
        P.append(box("rim%d" % i, (0.085 - (2*SEP if i % 2 else 0),
                                   2*math.pi*RR/NRIM*1.45, 0.058),
                     (WX, math.sin(a)*RR, WZ + math.cos(a)*RR),
                     "hazard" if i % 2 == 0 else "dark", rot=(-a, 0, 0)))
    # SZESC szprych, nie cztery: przy szesciu sylwetka powtarza sie co 60 stopni,
    # wiec w kazdej klatce kolo jest w innej pozycji niz w poprzedniej.
    for i in range(6):
        a = math.radians(i * 60.0)
        Rm = 0.075 + (WR - 0.105) / 2
        P.append(box("spoke%d" % i, (0.05, WR - 0.105, 0.042),
                     (WX, math.sin(a)*Rm, WZ + math.cos(a)*Rm), "steel",
                     rot=(math.radians(90) - a, 0, 0)))
    P.append(cyl("hub", 0.105, 0.15, (0.595, 0, WZ), "steel_d", verts=10,
                 rot=(0, math.radians(90), 0)))
    P.append(cyl("hubcap", 0.055, 0.19, (0.605, 0, WZ), "orange", verts=8,
                 rot=(0, math.radians(90), 0)))
    # KORBA. Sterczy poza plaszczyzne kola, wiec zakresla luk w powietrzu - to
    # jest ten element, ktory najmocniej sprzedaje obrot. Promien 0.245 od
    # piasty: z wlasna grubosc zostaje z zapasem pod splitRadius 0.42.
    # Szerokosc bryly jest kontraktem (1.3124), a NAJDALSZYM punktem modelu w +X
    # jest wlasnie koncowka korby - wiec jej x liczy sie wstecz od obrysu, nie
    # dobiera na oko: 0.6477 + polowa dlugosci 0.10 + bevel 0.02 = 0.7677, czyli
    # dokladnie tam, gdzie konczyl sie stary knob.
    KR = 0.245
    KA = math.radians(45)
    P.append(box("crankarm", (0.055, 0.30, 0.055), (0.615, 0.10, WZ + 0.10), "steel",
                 rot=(KA, 0, 0)))
    P.append(cyl("grip", 0.052, 0.20, (0.6677, math.sin(KA)*KR, WZ + math.cos(KA)*KR),
                 "orange", verts=8, rot=(0, math.radians(90), 0)))
    # Stopki siedza w calosci wewnatrz fartucha (jego obrys 1.08 x 0.88 x 0.14 je
    # obejmuje), wiec widac je tylko wtedy, gdy ich spod lezal w plaszczyznie
    # spodu fartucha - i wlasnie tak lezal. Podniesione o SEP: dalej niewidoczne,
    # ale juz bez remisu glebi pod maszyna.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("foot", (0.10, 0.10, 0.09), (sx*0.42, sy*0.32, 0.045 + 2*SEP), "dark"))
    return finish(P, "crank", bevel=0.020, merge=0.0008)

def b_machine():
    P = []
    P.append(box("body", (1.30, 1.00, 1.30), (0, 0, 0.65), "steel"))
    P.append(box("base", (1.40, 1.10, 0.16), (0, 0, 0.08), "dark"))
    P.append(box("top", (1.10, 0.86, 0.20), (0, 0, 1.40), "hazard"))
    P.append(box("win", (0.80, 0.06, 0.52), (0, -0.52, 0.86), "glass"))
    P.append(box("frame", (0.90, 0.04, 0.62), (0, -0.545, 0.86), "dark"))
    P.append(box("out", (0.70, 0.36, 0.24), (0, -0.56, 0.30), "dark"))
    P.append(box("outlip", (0.76, 0.12, 0.06), (0, -0.72, 0.23), "hazard"))
    for i in range(4):
        P.append(box("vent%d" % i, (1.02, 0.04, 0.06), (0, 0.52, 0.42+i*0.14), "dark"))
    P.append(cyl("pipe", 0.17, 0.60, (0.40, 0.30, 1.72), "steel", verts=10))
    P.append(cyl("pipecap", 0.22, 0.10, (0.40, 0.30, 2.05), "dark", verts=10))
    P.append(cyl("lamp", 0.09, 0.14, (-0.42, 0, 1.57), "red", verts=8))
    return finish(P, "machine")

def b_press():
    P = []
    P.append(box("bed", (1.00, 0.80, 0.22), (0, 0, 0.11), "steel_d"))
    for sx in (-1, 1):
        P.append(box("post", (0.14, 0.14, 1.45), (sx*0.40, 0, 0.85), "steel"))
    P.append(box("crown", (1.05, 0.60, 0.24), (0, 0, 1.68), "hazard"))
    P.append(cyl("ram", 0.16, 0.55, (0, 0, 1.26), "steel_d", verts=10))
    P.append(box("head", (0.62, 0.52, 0.20), (0, 0, 0.98), "orange"))
    P.append(box("anvil", (0.72, 0.60, 0.10), (0, 0, 0.27), "dark"))
    P.append(cyl("gauge", 0.11, 0.06, (0, -0.32, 1.68), "white", verts=10, rot=(math.radians(90), 0, 0)))
    return finish(P, "press")

def b_hopper():
    """Lej: szeroki wlot U GORY, waski wylot na dole. Otwarty, zbudowany z pochylonych scianek."""
    P = []
    N = 12
    R_TOP, R_BOT = 0.70, 0.19
    Z_TOP, Z_BOT = 1.06, 0.40
    slant = math.hypot(R_TOP - R_BOT, Z_TOP - Z_BOT)
    tilt = math.atan2(R_TOP - R_BOT, Z_TOP - Z_BOT)
    wid = 2.0 * math.pi * ((R_TOP + R_BOT) / 2) / N * 1.35
    for i in range(N):
        a = math.radians(i * 360.0 / N)
        rm = (R_TOP + R_BOT) / 2
        P.append(box("wall%d" % i, (wid, 0.035, slant),
                     (math.sin(a)*rm, math.cos(a)*rm, (Z_TOP + Z_BOT)/2), "steel",
                     rot=(tilt, 0, -a)))
    ring_xy("lip", R_TOP, N, 0.42, 0.10, 0.07, Z_TOP, "hazard", P)
    P.append(cyl("neck", R_BOT + 0.03, 0.42, (0, 0, 0.21), "steel_d", verts=N))
    P.append(cyl("collar", R_BOT + 0.07, 0.08, (0, 0, 0.40), "hazard", verts=N))
    for i in range(3):
        a = math.radians(i*120 + 30)
        P.append(box("leg%d" % i, (0.07, 0.07, 0.66), (math.sin(a)*0.50, math.cos(a)*0.50, 0.33), "dark",
                     rot=(math.radians(-9)*math.cos(a), math.radians(9)*math.sin(a), 0)))
    return finish(P, "hopper", merge=0.001)

def b_vacuum_station():
    P = []
    P.append(cyl("tank", 0.34, 1.10, (0, 0, 0.62), "blue", verts=12))
    P.append(cyl("cap", 0.37, 0.12, (0, 0, 1.22), "steel", verts=12))
    P.append(cyl("base", 0.44, 0.14, (0, 0, 0.07), "dark", verts=12))
    P.append(cone("intake", 0.30, 0.10, 0.34, (0, -0.42, 0.55), "steel_d", verts=10,
                  rot=(math.radians(90), 0, 0)))
    P.append(cyl("hose", 0.08, 0.55, (0.30, 0.18, 0.90), "rubber", verts=8, rot=(math.radians(35), 0, 0)))
    P.append(box("panel", (0.24, 0.05, 0.18), (0, -0.34, 0.95), "hazard"))
    return finish(P, "vacuum_station")


# ======================================================== AUTOMATYZACJA
def b_conveyor():
    P = []
    # L and W are authored so the OUTER box lands on the grid before the snap:
    # length = L + 2 x roller radius 0.11 = 2.00, width = W + 0.11 (side rails
    # sit 0.02 clear of the belt and are 0.07 thick) = 1.00.
    L, W = 1.78, 0.89
    P.append(box("belt", (W, L, 0.07), (0, 0, 0.52), "dark"))
    for i in range(7):
        P.append(box("slat%d" % i, (W-0.05, 0.10, 0.04), (0, -L/2+0.18+i*0.24, 0.565), "steel_d"))
    for sx in (-1, 1):
        P.append(box("side", (0.07, L, 0.20), (sx*(W/2+0.02), 0, 0.55), "hazard"))
        for sy in (-1, 1):
            P.append(box("leg", (0.09, 0.09, 0.48), (sx*(W/2-0.06), sy*(L/2-0.18), 0.24), "steel"))
    P.append(cyl("roll1", 0.11, W, (0, -L/2, 0.52), "steel", verts=10, rot=(0, math.radians(90), 0)))
    P.append(cyl("roll2", 0.11, W, (0,  L/2, 0.52), "steel", verts=10, rot=(0, math.radians(90), 0)))
    return finish(P, "conveyor")

def b_conveyor_corner():
    """Luk 90 stopni: tasma z segmentow po okregu, barierki po obu promieniach."""
    P = []
    # Przy obrocie (0,0,-a) os X wypada STYCZNIE, os Y promieniowo.
    # Dlugosc segmentu musi wiec byc pierwszym wymiarem, nie drugim.
    W, RC, N, ZB = 0.80, 0.85, 10, 0.52
    OX = OY = -RC * 0.62
    for i in range(N):
        a = math.radians(i*90.0/N + 90.0/(2*N))
        seg = 2*math.pi*RC/4/N * 1.30
        P.append(box("belt%d" % i, (seg, W, 0.07),
                     (math.sin(a)*RC+OX, math.cos(a)*RC+OY, ZB), "dark", rot=(0, 0, -a)))
        P.append(box("slat%d" % i, (0.07, W-0.07, 0.04),
                     (math.sin(a)*RC+OX, math.cos(a)*RC+OY, ZB+0.045), "steel_d", rot=(0, 0, -a)))
    for rr, nm in ((RC - W/2 - 0.05, "in"), (RC + W/2 + 0.05, "out")):
        for i in range(N):
            a = math.radians(i*90.0/N + 90.0/(2*N))
            seg = 2*math.pi*rr/4/N * 1.30
            P.append(box("side%s%d" % (nm, i), (seg, 0.07, 0.20),
                         (math.sin(a)*rr+OX, math.cos(a)*rr+OY, ZB+0.04), "hazard", rot=(0, 0, -a)))
    for ad in (0, 90):
        a = math.radians(ad)
        cxp, cyp = math.sin(a)*RC+OX, math.cos(a)*RC+OY
        # os rolki PROMIENIOWA: Z -> rotY(90) -> X -> rotZ(90-a) -> (sin a, cos a)
        P.append(cyl("roll", 0.11, W, (cxp, cyp, ZB), "steel", verts=10,
                     rot=(0, math.radians(90), math.radians(90)-a)))
        P.append(box("leg", (0.09, 0.09, ZB), (cxp, cyp, ZB/2), "steel"))
    return finish(P, "conveyor_corner", merge=0.001)

def b_conveyor_slope():
    P = []
    # W + 0.27 (outboard legs) = 1.00 across, matching the flat conveyor.
    L, W = 2.10, 0.73
    ang = math.radians(20)
    P.append(box("belt", (W, L, 0.07), (0, 0, 0.80), "dark", rot=(ang, 0, 0)))
    for sx in (-1, 1):
        P.append(box("side", (0.07, L, 0.20), (sx*(W/2+0.02), 0, 0.82), "hazard", rot=(ang, 0, 0)))
        # podpory PRZYKRECONE OD ZEWNATRZ, nie pod tasma
        P.append(box("legL", (0.09, 0.09, 0.86), (sx*(W/2+0.09), -L/2+0.16, 0.43), "steel"))
        P.append(box("legH", (0.09, 0.09, 1.55), (sx*(W/2+0.09),  L/2-0.16, 0.78), "steel"))
        P.append(box("bracL", (0.22, 0.08, 0.08), (sx*(W/2+0.03), -L/2+0.16, 0.80), "steel_d"))
        P.append(box("bracH", (0.22, 0.08, 0.08), (sx*(W/2+0.03),  L/2-0.16, 1.50), "steel_d"))
    for i in range(7):
        t = -L/2 + 0.22 + i*0.28
        P.append(box("slat%d" % i, (W-0.05, 0.10, 0.04),
                     (0, t*math.cos(ang), 0.85+t*math.sin(ang)), "steel_d", rot=(ang, 0, 0)))
    return finish(P, "conveyor_slope")

def b_fan():
    P = []
    # slup stoi ZA tarcza (y>0), inaczej dolna lopatka przez niego przechodzi
    P.append(cyl("base", 0.42, 0.10, (0, 0.24, 0.05), "dark", verts=12))
    P.append(cyl("pole", 0.09, 0.98, (0, 0.24, 0.56), "steel", verts=8))
    # wspornik konczy sie NA TYLNEJ scianie piasty (y=0.11), nie przechodzi przez lopatki
    P.append(box("brack", (0.11, 0.15, 0.11), (0, 0.205, 1.00), "steel_d"))
    ring_xz("ring", 0.58, 16, 0.25, 0.10, 0.10, 1.00, "steel", P)
    P.append(cyl("hub", 0.15, 0.22, (0, 0, 1.00), "hazard", verts=10, rot=(math.radians(90), 0, 0)))
    for i in range(4):
        a = math.radians(i*90 + 25)
        P.append(box("blade%d" % i, (0.17, 0.05, 0.42),
                     (math.sin(a)*0.27, 0, 1.00+math.cos(a)*0.27), "hazard",
                     rot=(math.radians(22), a, 0)))
    # BEZ pretow klatki przed wirnikiem - zaslanialy zolte lopatki,
    # a to one maja byc pierwsza rzecza, ktora widac. Zostaje sama obrecz.
    return finish(P, "fan")


# ============================================================ BUDOWLE
def b_wall():
    P = []
    P.append(box("panel", (2.00, 0.14, 1.00), (0, 0, 0.50), "concrete"))
    P.append(box("cap", (2.06, 0.20, 0.09), (0, 0, 1.02), "hazard"))
    P.append(box("foot", (2.06, 0.22, 0.10), (0, 0, 0.05), "steel_d"))
    for sx in (-1, 1):
        P.append(box("rib", (0.10, 0.20, 0.94), (sx*0.86, 0, 0.50), "steel_d"))
    return finish(P, "wall")

def b_wall_high():
    """Sciana wysoka 2.6 m.

    Byla najwiekszym plaskim polem w calej grze: 2.00 x 2.60 jednolitego betonu
    przecietego jedna pozioma listwa. Plaszczyzna tej wielkosci bez podzialu nie
    ma sie o co zaczepic - swiatlo klada sie na niej rowno, wiec z dystansu
    znika i czyta sie jak dziura w plocie, a nie jak mur.

    Podzial na TRZY kondygnacje z ciemnymi fugami i czterema zebrami zamiast
    dwoch daje jej rytm i - co wazniejsze - krawedzie, na ktorych lamie sie
    swiatlo. Zolty pas na wysokosci oczu wiaze ja kolorystycznie z reszta plotu.
    Koszt: 72 -> 156 trojkatow, ciagle grosze."""
    P = []
    P.append(box("panel", (2.00, 0.14, 2.60), (0, 0, 1.30), "concrete"))
    P.append(box("cap", (2.06, 0.20, 0.09), (0, 0, 2.62), "hazard"))
    P.append(box("foot", (2.06, 0.22, 0.12), (0, 0, 0.06), "steel_d"))
    # cztery zebra: skrajne na obrysie, wewnetrzne dziela plyte na trzy pola
    for x in (-0.86, -0.29, 0.29, 0.86):
        P.append(box("rib", (0.10, 0.20, 2.52), (x, 0, 1.30), "steel_d"))
    # poziome fugi - plyta czyta sie jako trzy prefabrykaty postawione na sobie
    for z in (0.88, 1.76):
        P.append(box("joint", (2.02, 0.18, 0.06), (0, 0, z), "dark"))
    P.append(box("band", (2.02, 0.19, 0.11), (0, 0, 1.32), "hazard"))
    P.append(box("plate", (0.34, 0.17, 0.22), (0.50, 0, 2.20), "steel"))
    return finish(P, "wall_high")

def b_rail():
    P = []
    P.append(box("kerb", (2.00, 0.20, 0.30), (0, 0, 0.15), "concrete"))
    P.append(box("stripe", (2.02, 0.22, 0.07), (0, 0, 0.31), "hazard"))
    for x in (-0.66, 0, 0.66):
        P.append(box("mark", (0.22, 0.23, 0.075), (x, 0, 0.312), "dark"))
    return finish(P, "rail")

def b_corner():
    P = []
    # Obie sciany PRZECHODZA przez punkt (0,0) - zachodza na siebie w kwadracie TxT,
    # wiec styk jest gwarantowany geometrycznie, nie "na oko".
    # ZADNE bryly sie nie przenikaja - sciany koncza sie na krawedzi slupa (styk czolowy).
    # Poprzednio slup i czapki zachodzily na siebie i mialy wspolna plaszczyzne = z-fighting.
    # LEN + half the post cap (0.145) = 1.00, so the corner is a one-metre tile
    # whose arm tips ARE its bounding faces: butted against a 2.00 m wall the
    # centres sit 1.50 m apart and the two meshes touch with no seam at all.
    T, LEN, H, PS = 0.14, 0.855, 1.00, 0.24
    e = PS/2                                    # krawedz slupa
    la = LEN - e                                # dlugosc ramienia od slupa
    P.append(box("a", (la, T, H), (-e - la/2, 0.0, H/2), "concrete"))
    P.append(box("b", (T, la, H), (0.0, -e - la/2, H/2), "concrete"))
    P.append(box("post", (PS, PS, H), (0, 0, H/2), "steel_d"))
    P.append(box("capa", (la, T+0.05, 0.08), (-e - la/2, 0, H + 0.04), "hazard"))
    P.append(box("capb", (T+0.05, la, 0.08), (0, -e - la/2, H + 0.04), "hazard"))
    P.append(box("capp", (PS+0.05, PS+0.05, 0.10), (0, 0, H + 0.05), "hazard"))
    P.append(box("foota", (la, T+0.07, 0.09), (-e - la/2, 0, 0.045), "steel_d"))
    P.append(box("footb", (T+0.07, la, 0.09), (0, -e - la/2, 0.045), "steel_d"))
    return finish(P, "corner")

def b_ramp():
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    # The hazard trim is the widest part, so IT is sized to the 1.50 target and
    # the wedge tucks inside it; the run stays 2.00 with the trim's outer face
    # exactly on the low end.
    o = bpy.context.object; o.name = "wedge"; o.scale = (1.44, 1.94, 0.90)
    bpy.ops.object.transform_apply(scale=True)
    for v in o.data.vertices:
        if v.co.y > 0: v.co.z = -0.45
    o.data.update(); o.data.materials.append(mat("concrete"))
    P = [o]
    P.append(box("edge", (1.50, 0.09, 0.06), (0, -0.955, 0.44), "hazard"))
    # Goly klin to byla najbardziej bezbarwna bryla w calym zestawie: jedna
    # plaszczyzna betonu, zero podzialu, zero kierunku. Nie widac bylo nawet, w
    # KTORA strone sie wjezdza. Poprzeczne listwy antyposlizgowe naprzemiennie
    # zolte i ciemne daja i rytm, i kierunek, i - co wazniejsze - krawedz, na
    # ktorej lamie sie swiatlo.
    #
    # Wysokosc bryly NIE moze urosnac (0.92 jest wpisane w dane), wiec listwy
    # zaczynaja sie 0.30 m ponizej grzbietu i wystaja tylko 0.018 - mniej niz
    # najmniejszy wymiar kaczki (0.14), wiec nic sie na nich nie zatrzyma.
    SLOPE = 0.90 / 1.94                       # spadek klina
    for i in range(6):
        yy = -0.67 + i * 0.28                 # od 0.30 pod grzbietem w dol
        zz = 0.45 - (yy + 0.97) * SLOPE
        P.append(box("tread%d" % i, (1.30, 0.10, 0.018), (0, yy, zz + 0.009),
                     "hazard" if i % 2 == 0 else "dark", rot=(-math.atan(SLOPE), 0, 0)))
    # Policzki wzdluz pochylej krawedzi - obrys, po ktorym oko czyta nachylenie.
    #
    # WYSOKOSC KLINA JEST KONTRAKTEM, nie swobodnym wymiarem: buildings.js ma
    # footprint [1.50, 0.92, 2.00], slope.rise 0.92 i recznie policzony collider
    # (half[2] = hypot(2.00, 0.92)/2, pitch = -atan2(0.92, 2.00)). Kazdy trojkat,
    # ktory wyjdzie poza -0.45..+0.47 w lokalnym Z, przesuwa 0.92 i rozjezdza te
    # liczby po cichu. Pierwsza wersja tych policzkow schodzila 0.0162 PONIZEJ
    # spodu klina i robila z 0.92 -> 0.9365; stad przesuniecie srodka w gore i
    # skrocenie do 2.00, zeby oba konce zmiescily sie w kopercie.
    for sx in (-1, 1):
        P.append(box("stringer%d" % sx, (0.04, 2.00, 0.05), (sx*0.72, 0.05, -0.006),
                     "steel_d", rot=(-math.atan(SLOPE), 0, 0)))
    return finish(P, "ramp")

def b_chute():
    P = []
    # rynna OTWARTA DO GORY: luk od -90 przez dol (180) do +90 stopni
    L, N, R, ZC = 2.00, 10, 0.34, 0.46
    for i in range(N + 1):
        a = math.radians(90 + i * 180.0 / N)
        P.append(box("shell%d" % i, (0.14, L, 0.09),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "steel", rot=(0, a, 0)))
    for sy in (-1, 1):
        for i in range(N + 1):
            a = math.radians(90 + i * 180.0 / N)
            P.append(box("rim%d%d" % (sy, i), (0.13, 0.06, 0.13),
                         (math.sin(a)*R, sy*(L/2), ZC + math.cos(a)*R), "hazard", rot=(0, a, 0)))
    # cztery pary nog rozlozonych na calej dlugosci + poprzeczki
    legh = ZC - R + 0.02
    for sy in (-1.5, -0.5, 0.5, 1.5):
        yy = sy * (L / 4.0)
        for sx in (-1, 1):
            P.append(box("leg", (0.08, 0.10, legh), (sx*0.26, yy, legh/2), "dark"))
        P.append(box("tie", (0.60, 0.07, 0.07), (0, yy, legh*0.42), "dark"))
    return finish(P, "chute", merge=0.001)

def b_bridge():
    P = []
    L, W = 3.00, 0.99
    P.append(box("deck", (W, L, 0.10), (0, 0, 0.95), "steel"))
    for i in range(7):
        P.append(box("plank%d" % i, (W-0.06, 0.30, 0.04), (0, -L/2+0.32+i*0.44, 1.02), "dark"))
    for sx in (-1, 1):
        P.append(box("rail", (0.06, L, 0.07), (sx*(W/2-0.03), 0, 1.42), "hazard"))
        P.append(box("rail2", (0.05, L, 0.05), (sx*(W/2-0.03), 0, 1.20), "hazard"))
        for i in range(5):
            P.append(box("post%d" % i, (0.07, 0.07, 0.50), (sx*(W/2-0.03), -L/2+0.30+i*0.65, 1.20), "steel"))
        for sy in (-1, 1):
            P.append(box("leg", (0.11, 0.11, 0.95), (sx*(W/2-0.10), sy*(L/2-0.22), 0.475), "steel"))
    return finish(P, "bridge")

def b_pillar():
    P = []
    P.append(cyl("shaft", 0.20, 2.20, (0, 0, 1.20), "concrete", verts=10))
    P.append(box("base", (0.56, 0.56, 0.20), (0, 0, 0.10), "steel_d"))
    P.append(box("cap", (0.50, 0.50, 0.16), (0, 0, 2.38), "steel_d"))
    P.append(cyl("band", 0.23, 0.10, (0, 0, 0.55), "hazard", verts=10))
    return finish(P, "pillar")


# ========================================================== PRZEDMIOTY
def _crate(w, d, h, t, post, name, nx=4, nz=3):
    """Skrzynia z ATAZUROWYMI bokami - siatka prostokatnych dziur miedzy listwami."""
    # Zadne dwie bryly nie moga miec sciany w TEJ SAMEJ plaszczyznie - to jest z-fighting.
    # Listwy poziome sa cienesze od pionowych i schowane w nich, dno jest wezsze od scian,
    # a slupki narozne wystaja na zewnatrz o 12 mm.
    P = []
    barw = 0.055
    th = t * 0.55                                   # listwa pozioma: cieniej niz pionowa
    P.append(box("bot", (w - 2*t, d - 2*t, t), (0, 0, t/2), "wood"))
    for sx in (-1, 1):
        X = sx*(w/2 - t/2)
        for j in range(nx + 1):
            yy = -d/2 + t + j*(d - 2*t)/nx
            P.append(box("vx", (t, barw, h), (X, yy, h/2), "wood_lt"))
        for k in range(nz + 1):
            zz = t + k*(h - t)/nz
            P.append(box("hx", (th, d - 2*t + barw, barw), (X, 0, zz), "wood_lt"))
    for sy in (-1, 1):
        Y = sy*(d/2 - t/2)
        for j in range(nx + 1):
            xx = -w/2 + t + j*(w - 2*t)/nx
            P.append(box("vy", (barw, t, h), (xx, Y, h/2), "wood_lt"))
        for k in range(nz + 1):
            zz = t + k*(h - t)/nz
            P.append(box("hy", (w - 2*t + barw, th, barw), (0, Y, zz), "wood_lt"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("p", (post, post, h + 0.05),
                         (sx*(w/2 - post/2 + 0.012), sy*(d/2 - post/2 + 0.012), (h + 0.05)/2), "wood"))
    # Wnetrze: w swietle listew, od gornej powierzchni dna do gornej krawedzi
    # sciany. Slupki narozne biegna 0.05 wyzej i to one wyznaczaja bbox, wiec
    # bbox jest o te 0.05 wyzszy niz cokolwiek, co skrzynia naprawde miesci.
    cavity(name, (-(w/2 - t), w/2 - t), (-(d/2 - t), d/2 - t), (t, h))
    return finish(P, name)

# h is the WALL height; the corner posts run h + 0.05, so the exported bbox is
# h + 0.05 tall. The interiors these buy (floor t up to wall top h, inset by the
# wall thickness sideways) are what src/data/tools.js declares as
# storage.interior -- change one and the other is wrong.
def b_box():     return _crate(0.98, 0.98, 0.70, 0.055, 0.11, "box", nx=5, nz=4)
def b_box_big(): return _crate(1.22, 1.22, 1.05, 0.07, 0.14, "box_big", nx=6, nz=5)

def b_container():
    """OTWARTY OD GORY - kaczki wrzuca sie do srodka."""
    P = []
    W, D, H, T = 2.20, 4.40, 1.90, 0.10
    P.append(box("floor", (W, D, T), (0, 0, T/2), "steel_d"))
    for sx in (-1, 1):
        P.append(box("wx", (T, D, H), (sx*(W/2-T/2), 0, H/2), "rust"))
    for sy in (-1, 1):
        P.append(box("wy", (W-2*T, T, H), (0, sy*(D/2-T/2), H/2), "rust"))
    for i in range(12):                       # pionowe przetloczenia na zewnatrz
        yy = -D/2 + 0.30 + i*(D-0.60)/11
        for sx in (-1, 1):
            P.append(box("rib", (0.06, 0.12, H-0.16), (sx*(W/2+0.01), yy, H/2), "rust"))
    ring_top = 0.09
    P.append(box("rimA", (W+0.08, ring_top, ring_top), (0, -D/2, H), "hazard"))
    P.append(box("rimB", (W+0.08, ring_top, ring_top), (0,  D/2, H), "hazard"))
    for sx in (-1, 1):
        P.append(box("rimC", (ring_top, D+0.08, ring_top), (sx*W/2, 0, H), "hazard"))
        for sy in (-1, 1):
            P.append(box("corner", (0.16, 0.16, H+0.10), (sx*(W/2-0.05), sy*(D/2-0.05), (H+0.10)/2), "steel_d"))
    cavity("container", (-(W/2-T), W/2-T), (-(D/2-T), D/2-T), (T, H))
    return finish(P, "container", merge=0.001)

def b_bucket():
    """Otwarta kadz - scianka z segmentow, bez pokrywy, dwa uchwyty po bokach.

    TRZY zmiany wzgledem pierwszej wersji, wszystkie z tego samego powodu: to,
    co siedzi w wiadrze, jest rozstawiane po siatce zbudowanej z BOUNDING BOXA
    modelu (src/sim/containers.js), wiec kazdy centymetr bboxa, ktory nie jest
    wnetrzem, to zmarnowane miejsce na kaczke.

      1. Palak (luk nad krawedzia) ZNIKA na rzecz dwoch uchwytow z boku.
         Luk dodawal 0.22 m pustego powietrza NAD wiadrem - ponad jedna trzecia
         calej wysokosci bryly - i kaczki lezaly w tym powietrzu.
      2. Sciana jest PIONOWA zamiast zbieznej. O tym, ile kaczek wchodzi,
         decyduje najwezszy przekroj, czyli dno; zbieznosc 0.175/0.235 zabierala
         z niego jedna trzecie promienia i nic nie dawala w zamian.
      3. Kadz jest wieksza: 0.75 x 0.90 zamiast 0.50 x 0.60. Kaczka ma 0.386 m
         wysokosci, wiec dwie warstwy potrzebuja 0.81 m samego wnetrza. Ponizej
         tego wiadro fizycznie miesci jedna warstwe i zadna liczba w danych tego
         nie zmieni.
    """
    P = []
    # H 0.95, nie 0.90. Dwie warstwy kaczek potrzebuja 0.386 * 2 = 0.772 m
    # samego wnetrza plus margines slotInset; przy 0.90 wnetrze wychodzilo
    # 0.795 m i siatka zwijala sie do JEDNEJ warstwy, czyli szesciu miejsc.
    # Roznica miedzy "wiadro na 6 kaczek" a "wiadro na 12" to tutaj 5 cm.
    N, R, H, TH = 16, 0.372, 0.95, 0.026
    FLOOR = 0.045
    wid = 2*math.pi*R/N * 1.32
    for i in range(N):
        a = math.radians(i*360.0/N)
        rm = R - TH/2
        # Co czwarta klepka ciemniejsza. Gladki niebieski walec czytal sie jak
        # rura, nie jak kadz - jednolita krzywizna bez ani jednej pionowej
        # krawedzi. To jest zmiana WYLACZNIE koloru: geometria zostaje co do
        # milimetra, bo cavity() ponizej jest kontraktem dla src/data/tools.js.
        P.append(box("w%d" % i, (wid, TH, H), (math.sin(a)*rm, math.cos(a)*rm, H/2),
                     "steel_d" if i % 4 == 0 else "blue", rot=(0, 0, -a)))
    P.append(cyl("bot", R-TH, FLOOR, (0, 0, FLOOR/2), "steel_d", verts=N))
    # Obrecze: gorna schowana tuz pod krawedzia, dolna na wysokosci dna - obie
    # WEWNATRZ promienia sciany, zeby bbox zostal kadzia i niczym wiecej.
    ring_xy("rim", R-0.03, N, 0.15, 0.045, 0.05, H-0.03, "hazard", P)
    ring_xy("hoop", R-0.03, N, 0.15, 0.04, 0.035, FLOOR+0.03, "steel", P)
    # Uchwyty: plaskie klamry wtopione w sciane, po dwoch przeciwnych stronach.
    for sx in (-1, 1):
        P.append(box("grip", (0.05, 0.30, 0.06), (sx*(R-0.028), 0, H-0.17), "steel"))
        for sy in (-1, 1):
            P.append(box("gripend", (0.05, 0.05, 0.15), (sx*(R-0.028), sy*0.125, H-0.245), "steel"))
    # Kadz jest okragla, a siatka miejsc prostokatna: wnetrze to kwadrat WPISANY
    # w wewnetrzny promien, inaczej kaczka w rogu siedzialaby w scianie.
    ins = (R - TH) / math.sqrt(2.0)
    cavity("bucket", (-ins, ins), (-ins, ins), (FLOOR, H - 0.06))
    return finish(P, "bucket", merge=0.001)

def b_cart():
    """Taczka. Koryto urosło z 0.72 x 0.86 x 0.34 do 0.94 x 1.76 x 0.56, bo
    24 kaczki po 0.178 x 0.386 x 0.146 nie mieszcza sie w skrzynce wielkosci
    walizki. Bbox taczki to w wiekszosci dyszle, nogi i kolo, a nie ladunek --
    dlatego wiersz w src/data/tools.js podaje `storage.interior` i to wnetrze
    koryta, nie bounding box, jest miejscem, w ktorym leza kaczki."""
    P = []
    tw, td, th, t = 0.94, 1.76, 0.56, 0.05
    Z0 = 0.40                                   # spod koryta
    P.append(box("bot", (tw, td, t), (0, 0.05, Z0 + t/2), "hazard"))
    for sx in (-1, 1):
        P.append(box("sx", (t, td, th), (sx*(tw/2), 0.05, Z0 + t + th/2), "hazard"))
    P.append(box("back", (tw, t, th), (0, 0.05+td/2, Z0 + t + th/2), "hazard"))
    P.append(box("front", (tw, t, th*0.65), (0, 0.05-td/2, Z0 + t + th*0.325), "hazard"))
    # dyszle biegna POD korytem i NA ZEWNATRZ niego - inaczej przebijaja przez ladunek
    for sx in (-1, 1):
        P.append(box("handle", (0.07, 1.70, 0.07), (sx*0.53, 0.60, 0.36), "wood"))
        P.append(box("grip", (0.08, 0.24, 0.08), (sx*0.53, 1.50, 0.36), "dark"))
        P.append(box("leg", (0.07, 0.07, 0.34), (sx*0.44, 0.62, 0.17), "steel"))
        P.append(box("strut", (0.06, 0.30, 0.06), (sx*0.49, -0.30, 0.37), "steel"))
        P.append(box("axle", (0.05, 0.05, 0.22), (sx*0.17, -0.72, 0.31), "steel"))
    P.append(cyl("wheel", 0.30, 0.13, (0, -0.72, 0.30), "rubber", verts=14, rot=(0, math.radians(90), 0)))
    P.append(cyl("rim", 0.15, 0.15, (0, -0.72, 0.30), "steel", verts=10, rot=(0, math.radians(90), 0)))
    # Samo koryto. Reszta bryly - dyszle siegajace 1.5 m do tylu i kolo 0.3 m
    # do przodu - to nie jest miejsce, w ktorym moga lezec kaczki.
    cavity("cart", (-(tw/2 - t), tw/2 - t),
           (0.05 - (td/2 - t), 0.05 + (td/2 - t)), (Z0 + t, Z0 + t + th))
    return finish(P, "cart", merge=0.001)

def b_broom():
    P = []
    P.append(cyl("stick", 0.035, 1.35, (0, 0, 0.78), "wood", verts=8))
    # 0.50 x 0.25 head: the thin axis is grown to a whole grid step rather than
    # stretched there by the snap, which would have turned the round stick into
    # an ellipse.
    P.append(box("head", (0.50, 0.25, 0.09), (0, 0, 0.145), "wood_lt"))
    for i in range(11):
        P.append(box("br%d" % i, (0.028, 0.23, 0.16), (-0.20+i*0.04, 0, 0.06), "hazard"))
    P.append(cyl("grip", 0.045, 0.16, (0, 0, 1.42), "rubber", verts=8))
    return finish(P, "broom")

def b_vacuum():
    P = []
    # Slimmed to a 0.25 m body so the snap does not squash the round tank into
    # an ellipse on the way to the grid.
    P.append(cyl("tank", 0.125, 0.46, (0, 0, 0.30), "blue", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(cyl("cap", 0.125, 0.05, (0, -0.24, 0.30), "steel", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(cone("nozzle", 0.09, 0.115, 0.30, (0, -0.42, 0.30), "steel_d", verts=9, rot=(math.radians(90), 0, 0)))
    P.append(box("grip", (0.07, 0.09, 0.26), (0, 0.10, 0.60), "dark", rot=(math.radians(-18), 0, 0)))
    P.append(box("trig", (0.05, 0.10, 0.07), (0, -0.02, 0.50), "hazard"))
    P.append(cyl("hose", 0.05, 0.34, (0, 0.26, 0.36), "rubber", verts=8, rot=(math.radians(60), 0, 0)))
    for sx in (-1, 1):
        P.append(box("foot", (0.055, 0.30, 0.10), (sx*0.09, 0.02, 0.06), "dark"))
    return finish(P, "vacuum")


# ============================================================== SWIAT
def b_tube():
    P = []
    """Masywna rura - przez wylot musi przejsc kontener 2,2 x 4,4 m."""
    P = []
    N, R, H = 18, 1.70, 6.20
    for i in range(N):                      # plaszcz z segmentow, srodek pusty
        a = math.radians(i*360.0/N)
        seg = 2*math.pi*R/N * 1.35
        P.append(box("sh%d" % i, (seg, 0.16, H), (math.sin(a)*R, math.cos(a)*R, H/2),
                     "steel_d", rot=(0, 0, -a)))
    ring_xy("mouth", R, N, 2*math.pi*R/N*1.40, 0.46, 0.26, H, "dark", P)
    for z in (0.90, 2.60, 4.30):
        ring_xy("band", R + 0.06, N, 2*math.pi*R/N*1.40, 0.14, 0.16, z, "hazard", P)
    ring_xy("plinth", R + 0.22, N, 2*math.pi*(R+0.22)/N*1.40, 0.50, 0.22, 0.11, "concrete", P)
    return finish(P, "tube", merge=0.001)

def b_shop():
    P = []
    P.append(box("floor", (2.60, 1.80, 0.12), (0, 0, 0.06), "concrete"))
    P.append(box("back", (2.60, 0.12, 2.20), (0, 0.84, 1.22), "teal"))
    for sx in (-1, 1):
        P.append(box("side", (0.12, 1.80, 2.20), (sx*1.24, 0, 1.22), "teal"))
    P.append(box("counter", (2.40, 0.36, 0.95), (0, -0.62, 0.60), "wood"))
    P.append(box("ctop", (2.52, 0.46, 0.08), (0, -0.62, 1.11), "wood_lt"))
    P.append(box("roof", (2.90, 2.10, 0.14), (0, 0, 2.36), "steel_d"))
    for i in range(7):
        P.append(box("awn%d" % i, (0.38, 0.70, 0.06), (-1.14+i*0.38, -1.10, 2.22),
                     "hazard" if i % 2 == 0 else "white", rot=(math.radians(-16), 0, 0)))
    P.append(box("sign", (1.70, 0.10, 0.42), (0, -0.98, 2.66), "hazard"))
    for sx in (-1, 1):
        P.append(box("shelf", (0.10, 1.40, 0.06), (sx*1.10, 0.10, 1.30), "steel"))
        P.append(box("post", (0.12, 0.12, 2.30), (sx*1.30, -1.02, 1.15), "steel_d"))
    return finish(P, "shop")

def _humanoid(name, shirt, pants, cap_col, boots, extra=None):
    """Postac z POLACZONYMI konczynami: kule w stawach lacza segmenty,
    zadne dwie sciany nie leza w tej samej plaszczyznie (koniec z-fightingu)."""
    P = []
    P.append(ball("pelvis", 0.13, (0, 0, 0.90), pants, seg=12, ring_count=8, scale=(1.55, 0.95, 0.75)))
    P.append(box("torso", (0.44, 0.25, 0.44), (0, 0, 1.18), shirt))
    P.append(ball("chest", 0.145, (0, 0, 1.36), shirt, seg=12, ring_count=8, scale=(1.65, 0.92, 0.62)))
    P.append(ball("belly", 0.135, (0, 0, 1.02), shirt, seg=12, ring_count=8, scale=(1.60, 0.95, 0.62)))
    P.append(cyl("neck", 0.072, 0.14, (0, 0, 1.54), "skin", verts=10))
    P.append(ball("head", 0.163, (0, -0.005, 1.71), "skin", seg=14, ring_count=10, scale=(1.0, 0.96, 1.06)))
    P.append(ball("cap", 0.168, (0, 0, 1.775), cap_col, seg=14, ring_count=6, scale=(1.0, 0.98, 0.62)))
    P.append(box("peak", (0.28, 0.15, 0.035), (0, -0.185, 1.752), cap_col, rot=(math.radians(-6), 0, 0)))
    for sx in (-1, 1):
        P.append(ball("eye", 0.023, (sx*0.068, -0.148, 1.735), "black", seg=7, ring_count=5))
        # ramie: bark -> ramie -> lokiec -> przedramie -> dlon
        P.append(ball("sh", 0.088, (sx*0.235, 0, 1.395), shirt, seg=10, ring_count=7))
        P.append(cyl("armU", 0.062, 0.28, (sx*0.255, 0, 1.255), shirt, verts=9))
        P.append(ball("elb", 0.068, (sx*0.262, 0, 1.115), shirt, seg=9, ring_count=6))
        P.append(cyl("armL", 0.055, 0.26, (sx*0.268, 0, 0.985), "skin", verts=9))
        P.append(ball("hand", 0.072, (sx*0.272, -0.005, 0.855), "skin", seg=9, ring_count=6,
                      scale=(0.85, 1.15, 1.0)))
        # noga: biodro -> udo -> kolano -> lydka -> but
        P.append(ball("hip", 0.098, (sx*0.108, 0, 0.855), pants, seg=10, ring_count=7))
        P.append(cyl("legU", 0.078, 0.36, (sx*0.112, 0, 0.675), pants, verts=9))
        P.append(ball("knee", 0.080, (sx*0.114, 0, 0.495), pants, seg=9, ring_count=6))
        P.append(cyl("legL", 0.066, 0.34, (sx*0.114, 0, 0.325), pants, verts=9))
        P.append(box("boot", (0.155, 0.245, 0.115), (sx*0.114, -0.030, 0.0575), boots))
        P.append(ball("ank", 0.070, (sx*0.114, 0.010, 0.135), boots, seg=9, ring_count=6))
    if extra: extra(P)
    return finish(P, name, merge=0.0008)

def b_vendor():
    def ex(P):
        P.append(box("apron", (0.40, 0.015, 0.46), (0, -0.137, 1.09), "white"))
        P.append(box("tash", (0.13, 0.045, 0.038), (0, -0.152, 1.655), "dark"))
    return _humanoid("vendor", "teal_lt", "dark", "teal", "black", ex)

def b_floor():
    """Gladki beton z tekstura - bez siatki dylatacji."""
    def concrete(u, v, rnd):
        g = 0.255 + (rnd() - 0.5) * 0.075
        if rnd() > 0.982: g -= 0.055          # rzadkie ciemne skazy
        if rnd() > 0.992: g += 0.045          # jasne wykwity
        return (g, g, g * 1.02, 1.0)
    img = make_image("tex_concrete", 128, 128, concrete)
    o = box("slab", (4.00, 4.00, 0.20), (0, 0, 0.10), "concrete")
    o.data.materials.clear()
    o.data.materials.append(tex_mat("m_concrete", img, repeat=3.0))
    return finish([o], "floor")

def b_marking():
    """Strzalka NAMALOWANA SPRAYEM - plaski quad z tekstura alpha, poszarpane brzegi."""
    def spray(u, v, rnd):
        x = (u - 0.5) * 2.0                  # -1..1
        y = v                                # 0 = grot, 1 = koniec trzonu
        if y < 0.42:                         # grot: trojkat rozszerzajacy sie ku gorze
            half = 0.12 + y * 2.05
            d = half - abs(x)
        else:                                # trzon
            d = 0.30 - abs(x)
            if y > 0.96: d = min(d, (1.0 - y) * 6.0)
        edge = 0.16
        a = max(0.0, min(1.0, d / edge))
        a *= 0.55 + 0.45 * rnd()             # ziarno farby w calej plamie
        if a < 0.10: a = 0.0
        if d > 0 and rnd() > 0.985: a *= 0.35 # przetarcia
        if d < 0 and d > -0.05 and rnd() > 0.80: a = 0.5 * rnd()  # rozprysk za krawedzia
        c = 0.93 + (rnd() - 0.5) * 0.10
        return (c, c * 0.79, 0.07, a)
    img = make_image("tex_arrow", 128, 128, spray)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.01))
    o = bpy.context.object; o.name = "arrow"; o.scale = (1.30, 1.90, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(tex_mat("m_arrow", img, alpha=True))
    return finish([o], "marking")

def b_lamp():
    P = []
    P.append(cyl("base", 0.26, 0.14, (0, 0, 0.07), "dark", verts=10))
    P.append(cyl("pole", 0.08, 3.00, (0, 0, 1.60), "steel_d", verts=8))
    P.append(box("arm", (0.10, 0.70, 0.10), (0, -0.30, 3.10), "steel_d"))
    P.append(cone("shade", 0.36, 0.16, 0.30, (0, -0.62, 2.98), "hazard", verts=10))
    P.append(cyl("bulb", 0.20, 0.06, (0, -0.62, 2.84), "white", verts=10))
    P.append(box("band", (0.18, 0.18, 0.10), (0, 0, 0.90), "hazard"))
    return finish(P, "lamp")

def b_pit_rim():
    P = []
    R = 1.60
    ring_xy("kerb", R, 32, 0.34, 0.30, 0.22, 0.11, "concrete", P)
    ring_xy("stripe", R, 32, 0.34, 0.32, 0.05, 0.245, "hazard", P)
    for i in range(0, 32, 2):
        a = math.radians(i*360.0/32)
        P.append(box("dash%d" % i, (0.20, 0.34, 0.055), (math.sin(a)*R, math.cos(a)*R, 0.248),
                     "dark", rot=(0, 0, -a)))
    return finish(P, "pit_rim")


# ============================================================== GRACZ
def b_avatar():
    def ex(P):
        P.append(box("vestF", (0.42, 0.016, 0.34), (0, -0.132, 1.17), "orange"))
        P.append(box("vestB", (0.42, 0.016, 0.34), (0,  0.132, 1.17), "orange"))
        for sx in (-1, 1):
            P.append(box("strap", (0.075, 0.28, 0.014), (sx*0.155, 0, 1.343), "orange"))
    return _humanoid("avatar", "hazard", "denim", "red", "dark", ex)


BUILDERS = [
    ("duck", b_duck, "Kaczka", "Gumowa kaczka. Twarz gry, ~25 cm, musi byc czytelna z 20 m."),
    ("crank", b_crank, "Maszyny", "Manual Duck Workbench - kolo z boku, 10 klikniec = kaczka."),
    ("machine", b_machine, "Maszyny", "Maszyna automatyczna, produkuje bez gracza."),
    ("press", b_press, "Maszyny", "Prasa wypychajaca kaczke."),
    ("vacuum_station", b_vacuum_station, "Maszyny", "Odkurzacz stacjonarny."),
    ("conveyor", b_conveyor, "Automatyzacja", "Tasmociag prosty, 2 m."),
    ("conveyor_corner", b_conveyor_corner, "Automatyzacja", "Tasmociag zakrecony 90 stopni."),
    ("conveyor_slope", b_conveyor_slope, "Automatyzacja", "Tasmociag wznoszacy."),
    ("fan", b_fan, "Automatyzacja", "Wiatrak. Model bez kolizji dla kaczek."),
    ("wall", b_wall, "Budowle", "Sciana podstawowa 2x1 m."),
    ("wall_high", b_wall_high, "Budowle", "Sciana wysoka 2x2,6 m."),
    ("rail", b_rail, "Budowle", "Niska bandka."),
    ("corner", b_corner, "Budowle", "Naroznik 90 stopni."),
    ("ramp", b_ramp, "Budowle", "Rampa."),
    ("chute", b_chute, "Budowle", "Rynna - polokragly kanal."),
    ("bridge", b_bridge, "Budowle", "Most nad tunelem."),
    ("pillar", b_pillar, "Budowle", "Filar / podpora."),
    ("box", b_box, "Przedmioty", "Skrzynia podstawowa, ~25 kaczek."),
    ("box_big", b_box_big, "Przedmioty", "Duza skrzynia."),
    ("container", b_container, "Przedmioty", "Kontener, 200 kaczek."),
    ("bucket", b_bucket, "Przedmioty", "Wiadro, ~10 kaczek."),
    ("cart", b_cart, "Przedmioty", "Taczka - pchasz przed soba."),
    ("broom", b_broom, "Przedmioty", "Miotla - przejmuje LPM."),
    ("vacuum", b_vacuum, "Przedmioty", "Odkurzacz reczny."),
    ("tube", b_tube, "Swiat", "Wielka rura, z ktorej wypadaja zakupy."),
    ("shop", b_shop, "Swiat", "Budka sprzedawcy."),
    ("vendor", b_vendor, "Swiat", "Sprzedawca stojacy w budce."),
    ("floor", b_floor, "Swiat", "Kafel posadzki 4x4 m."),
    ("marking", b_marking, "Swiat", "Zolta strzalka na posadzce."),
    ("lamp", b_lamp, "Swiat", "Lampa przemyslowa."),
    ("pit_rim", b_pit_rim, "Swiat", "Krawieznik pitu - 32-kat, srednica 3,2 m."),
    ("avatar", b_avatar, "Gracz", "Postac gracza - kask, kamizelka, dzinsy."),
]

# ================================================== FAZA 1 - GRUPA 1
# Maszyny z katalogu fazy 1, ktore potrzebuja WYLACZNIE pola produce.count.
# Geometria; wiersze danych pisze osobny przebieg (work/economy.md).
# Kazda z nich wyrzuca kaczki hurtem, wiec kazda ma widoczny WYLOT o swietle
# wiekszym niz kaczka (kolizja 0.178 x 0.386 x 0.146) - inaczej model klamie
# o tym, co robi.

def b_hive():
    """Kaczkowy ul - stos skrzynek pszczelarskich, deska wylotowa z przodu."""
    P = []
    P.append(box("plinth", (0.92, 0.92, 0.09), (0, 0, 0.045), "dark"))
    zs = [(0.86, 0.30, 0.24), (0.80, 0.28, 0.53), (0.74, 0.26, 0.80)]
    for i, (w, h, z) in enumerate(zs):
        P.append(box("sup%d" % i, (w, w, h), (0, 0, z), "wood" if i % 2 == 0 else "wood_lt"))
        P.append(box("lip%d" % i, (w + 0.05, w + 0.05, 0.045), (0, 0, z + h/2 - 0.02), "wood_lt"))
    # wylot: szczelina 0.44 x 0.22 - kaczka (0.178 x 0.146) przechodzi swobodnie
    P.append(box("mouth", (0.44, 0.10, 0.22), (0, -0.40, 0.26), "black"))
    P.append(box("board", (0.56, 0.26, 0.045), (0, -0.50, 0.155), "wood_lt",
                 rot=(math.radians(-14), 0, 0)))
    P.append(box("roof", (0.98, 0.98, 0.07), (0, 0, 0.96), "steel_d"))
    P.append(cone("cap", 0.50, 0.10, 0.26, (0, 0, 1.10), "hazard", verts=8))
    for i in range(3):
        P.append(box("band%d" % i, (0.90, 0.05, 0.05), (0, -0.44, 0.34 + i*0.26), "hazard"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("foot", (0.09, 0.09, 0.10), (sx*0.38, sy*0.38, 0.05), "steel_d"))
    return finish(P, "hive")

def b_incubator_double():
    """Podwojna wylegarnia - dwie przeszklone komory obok siebie, wspolny cokol."""
    P = []
    P.append(box("base", (1.42, 0.92, 0.20), (0, 0, 0.10), "dark"))
    P.append(box("body", (1.34, 0.84, 0.94), (0, 0, 0.67), "teal"))
    P.append(box("split", (0.07, 0.88, 0.98), (0, 0, 0.67), "steel_d"))
    for sx in (-1, 1):
        # kazda komora ma wlasne okno i wlasny wylot; szyba cofnieta w glab ramy
        P.append(box("glass", (0.52, 0.05, 0.60), (sx*0.34, -0.415, 0.72), "glass"))
        P.append(box("frame", (0.60, 0.035, 0.68), (sx*0.34, -0.435, 0.72), "steel_d"))
        P.append(box("out", (0.42, 0.22, 0.26), (sx*0.34, -0.50, 0.30), "dark"))
        P.append(box("outlip", (0.48, 0.08, 0.06), (sx*0.34, -0.60, 0.24), "hazard"))
        P.append(cyl("lamp", 0.06, 0.09, (sx*0.34, -0.44, 1.10), "red", verts=8,
                     rot=(math.radians(90), 0, 0)))
        for i in range(3):
            P.append(box("egg%d" % i, (0.10, 0.10, 0.13), (sx*0.34 - 0.16 + i*0.16, -0.20, 0.52), "white"))
    P.append(box("hood", (1.40, 0.88, 0.16), (0, 0, 1.22), "teal_lt"))
    for i in range(4):
        P.append(box("vent%d" % i, (1.20, 0.05, 0.05), (0, 0.44, 0.44 + i*0.16), "dark"))
    P.append(box("panel", (0.34, 0.06, 0.14), (0, -0.44, 1.10), "hazard"))
    return finish(P, "incubator_double")

def b_press_belt():
    """Prasa tasmowa - stempel nad przelotowa tasma. 5 kaczek na cykl."""
    P = []
    L, W = 1.86, 0.72
    P.append(box("belt", (W, L, 0.07), (0, 0, 0.50), "dark"))
    for i in range(6):
        P.append(box("slat%d" % i, (W - 0.05, 0.09, 0.04), (0, -L/2 + 0.22 + i*0.29, 0.545), "steel_d"))
    for sx in (-1, 1):
        P.append(box("side", (0.06, L, 0.16), (sx*(W/2 + 0.03), 0, 0.53), "hazard"))
        for sy in (-1, 1):
            P.append(box("leg", (0.08, 0.08, 0.46), (sx*(W/2 - 0.05), sy*(L/2 - 0.20), 0.23), "steel"))
    P.append(cyl("roll1", 0.10, W, (0, -L/2, 0.50), "steel", verts=10, rot=(0, math.radians(90), 0)))
    P.append(cyl("roll2", 0.10, W, (0,  L/2, 0.50), "steel", verts=10, rot=(0, math.radians(90), 0)))
    # brama stempla - stoi OKRAKIEM nad tasma, swiatlo 0.60 x 0.46 nad pasem
    for sx in (-1, 1):
        P.append(box("post", (0.12, 0.16, 1.30), (sx*0.42, 0.10, 0.65), "steel"))
    P.append(box("crown", (1.00, 0.42, 0.20), (0, 0.10, 1.40), "hazard"))
    P.append(cyl("ram", 0.13, 0.34, (0, 0.10, 1.14), "steel_d", verts=10))
    P.append(box("head", (0.62, 0.34, 0.16), (0, 0.10, 0.98), "orange"))
    for i in range(5):
        P.append(box("die%d" % i, (0.08, 0.08, 0.06), (-0.24 + i*0.12, 0.10, 0.87), "steel_d"))
    P.append(cyl("gauge", 0.09, 0.05, (0, -0.12, 1.40), "white", verts=9, rot=(math.radians(90), 0, 0)))
    return finish(P, "press_belt")

def b_feeder_vibe():
    """Wibracyjny podajnik - pochylone koryto na sprezynach, lej NAD tylnym koncem.

    Pierwsza wersja czytala sie jako lawka z abazurem. Trzy powody, wszystkie
    naprawione tutaj:
      * zebra dostawaly z = ... * tan(-ang), czyli pochylenie PRZECIWNE do
        koryta - przecinaly plyte na wylot zamiast na niej lezec;
      * lej wisial 0.2 m nad korytem i czytal sie jako osobna bryla;
      * scianki 0.22 m przy korycie 1.30 m czytaly sie jak belki, nie jak burty.
    Kazdy element koryta idzie teraz przez T(): wspolrzedne LOKALNE koryta
    (wzdluz, w gore) zamieniane na swiatowe TA SAMA rotacja co plyta, wiec nic
    nie moze sie rozjechac ze spadkiem."""
    P = []
    ang = math.radians(9)                 # tyl (+Y) w gorze, wylot z przodu
    ZC, LEN, WID = 0.66, 1.30, 0.80
    ca, sa = math.cos(ang), math.sin(ang)

    def T(s, up):
        """(wzdluz koryta, w gore od plyty) -> (y, z) w swiecie."""
        return (s*ca - up*sa, ZC + s*sa + up*ca)

    y, z = T(0, 0)
    P.append(box("tray", (WID, LEN, 0.05), (0, y, z), "steel", rot=(ang, 0, 0)))
    for sx in (-1, 1):                    # burty: swiatlo 0.70 m, kaczka ma 0.18
        y, z = T(0, 0.105)
        P.append(box("side", (0.05, LEN, 0.20), (sx*(WID/2 - 0.025), y, z), "hazard", rot=(ang, 0, 0)))
    for i in range(5):                    # zebra POPRZECZNE, lezace na plycie
        y, z = T(-0.48 + i*0.24, 0.045)
        P.append(box("rib%d" % i, (WID - 0.12, 0.05, 0.04), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    y, z = T(LEN/2 - 0.03, 0.12)          # tylna sciana zamyka koryto
    P.append(box("backw", (WID, 0.05, 0.28), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    y, z = T(-LEN/2 - 0.04, 0.02)         # jezyk wysypowy z przodu
    P.append(box("lip", (WID - 0.06, 0.16, 0.04), (0, y, z), "hazard", rot=(ang, 0, 0)))

    for sx in (-1, 1):                    # sprezyny miedzy cokolem a korytem
        for s in (-0.44, 0.44):
            yb, zb = T(s, -0.03)
            P.append(cyl("spr", 0.045, zb - 0.16, (sx*0.30, yb, (zb + 0.16)/2), "steel", verts=8))
            P.append(box("pad", (0.13, 0.13, 0.05), (sx*0.30, yb, 0.165), "dark"))
    P.append(box("base", (0.88, 1.24, 0.16), (0, 0, 0.08), "dark"))
    P.append(box("hazb", (0.94, 1.30, 0.04), (0, 0, 0.165), "hazard"))

    ym, zm = T(0.10, -0.02)               # naped przykrecony do boku koryta
    P.append(cyl("motor", 0.13, 0.24, (0.48, ym, zm), "orange", verts=10, rot=(0, math.radians(90), 0)))
    P.append(box("mount", (0.16, 0.20, 0.10), (0.42, ym, zm), "steel_d"))

    # Lej OSADZONY na tylnej scianie: dolny wieniec siedzi 3 cm PONIZEJ krawedzi
    # burty, wiec styka sie z korytem zamiast nad nim wisiec.
    N, RT, RB, HH = 10, 0.31, 0.15, 0.34
    yh, zh = T(LEN/2 - 0.22, 0.17)
    slant = math.hypot(RT - RB, HH)
    tilt = math.atan2(RT - RB, HH)
    rm = (RT + RB)/2
    for i in range(N):
        a = math.radians(i*360.0/N)
        P.append(box("hop%d" % i, (2*math.pi*rm/N*1.4, 0.03, slant),
                     (math.sin(a)*rm, yh + math.cos(a)*rm, zh + HH/2), "steel_d",
                     rot=(-tilt, 0, -a)))
    for i in range(N):                    # wieniec wlotu; ring_xy siedzi na osi,
        a = math.radians(i*360.0/N)       # a ten lej stoi nad tylem koryta
        P.append(box("hlip%d" % i, (2*math.pi*RT/N*1.45, 0.09, 0.05),
                     (math.sin(a)*RT, yh + math.cos(a)*RT, zh + HH), "hazard", rot=(0, 0, -a)))
    return finish(P, "feeder_vibe", merge=0.001)

def b_slot_machine():
    """Automat losowy - trzy bebny za szyba, dzwignia z boku, taca na wyplate."""
    P = []
    P.append(box("cab", (0.62, 0.58, 1.20), (0, 0, 0.62), "red"))
    P.append(box("plinth", (0.68, 0.64, 0.14), (0, 0, 0.07), "dark"))
    P.append(box("marq", (0.68, 0.50, 0.30), (0, -0.02, 1.37), "hazard"))
    P.append(box("marqf", (0.56, 0.05, 0.18), (0, -0.28, 1.37), "white"))
    # szyba cofnieta, bebny za nia - nic nie lezy w tej samej plaszczyznie
    P.append(box("glass", (0.50, 0.04, 0.34), (0, -0.29, 0.94), "glass"))
    P.append(box("bezel", (0.58, 0.03, 0.42), (0, -0.315, 0.94), "steel_d"))
    for i in range(3):
        P.append(cyl("reel%d" % i, 0.15, 0.14, (-0.16 + i*0.16, -0.20, 0.94), "white",
                     verts=10, rot=(0, math.radians(90), 0)))
        P.append(cyl("hubr%d" % i, 0.05, 0.16, (-0.16 + i*0.16, -0.20, 0.94), "dark",
                     verts=8, rot=(0, math.radians(90), 0)))
    for i in range(4):
        P.append(box("btn%d" % i, (0.08, 0.06, 0.05), (-0.21 + i*0.14, -0.30, 0.66), "hazard"))
    # wylot wyplaty: swiatlo 0.40 x 0.24, kaczki wypadaja na tace
    P.append(box("tray", (0.44, 0.16, 0.24), (0, -0.34, 0.32), "black"))
    P.append(box("traylip", (0.50, 0.14, 0.05), (0, -0.42, 0.21), "hazard", rot=(math.radians(20), 0, 0)))
    # dzwignia
    P.append(cyl("pivot", 0.05, 0.10, (0.33, -0.02, 1.02), "steel_d", verts=8, rot=(0, math.radians(90), 0)))
    P.append(cyl("lever", 0.03, 0.34, (0.42, -0.02, 1.16), "steel", verts=7, rot=(0, math.radians(30), 0)))
    P.append(ball("knob", 0.07, (0.51, -0.02, 1.30), "hazard", seg=8, ring_count=5))
    return finish(P, "slot_machine")

def b_factory():
    """Kaczkowa fabryka - hala z pilastym dachem, dwa kominy, tasma wyjsciowa."""
    P = []
    W, D, H = 2.30, 1.86, 1.50
    P.append(box("hall", (W, D, H), (0, 0, H/2), "steel"))
    P.append(box("plinth", (W + 0.12, D + 0.10, 0.16), (0, 0, 0.08), "dark"))
    # pilasty dach: cztery pochylone plyty, kazda z pasem szyby od polnocy
    for i in range(4):
        x = -0.86 + i*0.575
        P.append(box("saw%d" % i, (0.56, D, 0.06), (x, 0, H + 0.20), "steel_d",
                     rot=(0, math.radians(-26), 0)))
        P.append(box("sawg%d" % i, (0.05, D - 0.10, 0.24), (x + 0.26, 0, H + 0.14), "glass"))
    P.append(box("eave", (W + 0.10, D + 0.08, 0.06), (0, 0, H + 0.03), "hazard"))
    for i, x in enumerate((-0.62, 0.58)):
        P.append(cyl("chim%d" % i, 0.15, 0.90, (x, 0.60, H + 0.60), "concrete", verts=10))
        P.append(cyl("chimc%d" % i, 0.19, 0.10, (x, 0.60, H + 1.06), "dark", verts=10))
        P.append(cyl("chimb%d" % i, 0.17, 0.09, (x, 0.60, H + 0.34), "hazard", verts=10))
    # brama wyjsciowa: swiatlo 0.86 x 0.70, plus jezyk tasmy wystajacy na zewnatrz
    P.append(box("gate", (0.90, 0.14, 0.74), (0, -D/2 - 0.02, 0.45), "black"))
    P.append(box("gatef", (1.02, 0.05, 0.86), (0, -D/2 - 0.08, 0.45), "hazard"))
    P.append(box("tongue", (0.72, 0.34, 0.07), (0, -D/2 - 0.20, 0.36), "dark"))
    for i in range(3):
        P.append(box("tsl%d" % i, (0.66, 0.07, 0.035), (0, -D/2 - 0.30 + i*0.10, 0.40), "steel_d"))
    for sx in (-1, 1):                       # okna hali
        for i in range(4):
            P.append(box("win", (0.34, 0.05, 0.30), (-0.78 + i*0.52, sx*(D/2 + 0.005), 1.02), "glass"))
    for i in range(4):
        P.append(box("stripe%d" % i, (0.18, 0.05, 0.34), (-1.05 + i*0.70, -D/2 - 0.005, 0.22), "hazard"))
    P.append(box("sign", (1.10, 0.07, 0.24), (0, -D/2 - 0.06, 1.24), "hazard"))
    return finish(P, "factory")

def b_geyser():
    """Kaczkowy gejzer - skalny komin z stalowa obreecza. 30 kaczek naraz."""
    P = []
    # stozek z segmentow, w srodku PUSTY - gardziel 0.52 m przelotu
    N, RT, RB, ZT = 12, 0.30, 0.66, 0.86
    slant = math.hypot(RB - RT, ZT)
    tilt = math.atan2(RB - RT, ZT)
    rm = (RT + RB)/2
    for i in range(N):
        a = math.radians(i*360.0/N)
        P.append(box("cone%d" % i, (2*math.pi*rm/N*1.35, 0.10, slant),
                     (math.sin(a)*rm, math.cos(a)*rm, ZT/2), "rust", rot=(-tilt, 0, -a)))
    # Obreecze i glazy licza sie po 12 trojkatow za sztuke, wiec ida na 8 segmentow,
    # nie na 12 stozka: pierwsza wersja wyszla 876 trojkatow przy budzecie 800.
    ring_xy("throat", RT, N, 2*math.pi*RT/N*1.45, 0.14, 0.10, ZT, "steel_d", P)
    ring_xy("collar", RT + 0.10, 8, 2*math.pi*(RT+0.10)/8*1.45, 0.12, 0.07, ZT + 0.09, "hazard", P)
    # skalna podstawa + glazy dokola
    ring_xy("plinth", RB + 0.05, 8, 2*math.pi*(RB+0.05)/8*1.40, 0.24, 0.14, 0.07, "concrete", P)
    for i in range(4):
        a = math.radians(i*90 + 32)
        P.append(ball("rock%d" % i, 0.15, (math.sin(a)*0.66, math.cos(a)*0.66, 0.10), "concrete",
                      seg=6, ring_count=4, scale=(1.0, 0.85, 0.55)))
    for i in range(3):                        # rury zasilajace wchodzace w skale
        a = math.radians(i*120 + 40)
        P.append(cyl("feed%d" % i, 0.07, 0.42, (math.sin(a)*0.52, math.cos(a)*0.52, 0.30), "steel_d",
                     verts=8, rot=(math.radians(58)*math.cos(a), math.radians(-58)*math.sin(a), 0)))
    return finish(P, "geyser", merge=0.001)

def b_pipe_endless():
    """Nieskonczona rura - petla bez konca na cokole, kaczki leca z wylotu."""
    P = []
    R, N = 0.40, 16
    ZC = 0.92
    seg = 2*math.pi*R/N*1.40
    for i in range(N):                        # pionowa petla rury
        a = math.radians(i*360.0/N)
        P.append(box("loop%d" % i, (seg, 0.20, 0.19),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "steel_d", rot=(0, a, 0)))
    for i in range(0, N, 4):                  # obreecze
        a = math.radians(i*360.0/N)
        P.append(box("band%d" % i, (seg*0.9, 0.25, 0.06),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "hazard", rot=(0, a, 0)))
    # wylot: krotki odcinek w -Y, swiatlo 0.30 - kaczka przechodzi z zapasem
    NM = 10
    for i in range(NM):
        a = math.radians(i*360.0/NM)
        P.append(box("mouth%d" % i, (2*math.pi*0.19/NM*1.5, 0.34, 0.05),
                     (math.sin(a)*0.19, -0.34, 0.50 + math.cos(a)*0.19), "steel", rot=(0, a, 0)))
    for i in range(NM):
        a = math.radians(i*360.0/NM)
        P.append(box("mlip%d" % i, (2*math.pi*0.24/NM*1.5, 0.08, 0.09),
                     (math.sin(a)*0.24, -0.49, 0.50 + math.cos(a)*0.24), "hazard", rot=(0, a, 0)))
    P.append(box("column", (0.26, 0.26, 0.54), (0, 0.02, 0.27), "steel"))
    P.append(box("plinth", (0.86, 0.86, 0.14), (0, 0, 0.07), "dark"))
    P.append(box("hazbase", (0.92, 0.92, 0.05), (0, 0, 0.145), "hazard"))
    return finish(P, "pipe_endless", merge=0.001)


# ================================================== FAZA 1 - GRUPA 2
# Producenci, ktorzy sa czysta danina: producer_auto bez zadnej zmiany w kodzie.
# Roznia ich tylko sekundy i wagi rzadkosci, wiec ROZNICA MUSI BYC W SYLWETCE.
# Trzy ostatnie (drukarka, zlota prasa, reaktor) losuja wylacznie wysokie tiery
# i dlatego chodza w zlocie i turkusie, a nie w stali.

def b_machine_slow():
    """Wolny automat - przysadzisty, ciezki, z wielkim kolem zamachowym. 60 s."""
    P = []
    P.append(box("body", (0.86, 0.86, 0.72), (0, 0, 0.42), "steel"))
    P.append(box("base", (0.94, 0.94, 0.14), (0, 0, 0.07), "dark"))
    P.append(box("top", (0.78, 0.78, 0.14), (0, 0, 0.85), "steel_d"))
    P.append(box("win", (0.44, 0.05, 0.26), (0, -0.435, 0.52), "glass"))
    P.append(box("frame", (0.52, 0.035, 0.34), (0, -0.455, 0.52), "dark"))
    # wylot nisko z przodu - kaczka wytacza sie, nie wypada z wysoka
    P.append(box("out", (0.40, 0.24, 0.22), (0, -0.44, 0.22), "dark"))
    P.append(box("outlip", (0.46, 0.10, 0.05), (0, -0.56, 0.16), "hazard"))
    # Kolo zamachowe - powolny obrot to cala opowiesc tej maszyny, wiec musi byc
    # PIERWSZA rzecza, ktora widac. W pierwszej wersji bylo rdzawe na stali i
    # 0.07 m od sciany: z trzech metrow czytalo sie jako brazowa narosl. Zolte
    # i odsuniete na 0.10 czyta sie jak kolo, dokladnie jak na korbie.
    P.append(cyl("fly", 0.32, 0.07, (0.50, 0.06, 0.60), "hazard", verts=14, rot=(0, math.radians(90), 0)))
    P.append(cyl("flyhub", 0.09, 0.16, (0.50, 0.06, 0.60), "dark", verts=9, rot=(0, math.radians(90), 0)))
    for i in range(3):
        P.append(box("spoke%d" % i, (0.05, 0.54, 0.04), (0.495, 0.06, 0.60), "steel_d",
                     rot=(math.radians(i*60), 0, math.radians(90))))
    P.append(cyl("rodarm", 0.04, 0.34, (0.46, -0.16, 0.46), "rust", verts=7, rot=(math.radians(40), 0, 0)))
    P.append(cyl("pipe", 0.10, 0.40, (-0.26, 0.24, 1.05), "steel_d", verts=8))
    P.append(cyl("pcap", 0.13, 0.07, (-0.26, 0.24, 1.28), "dark", verts=8))
    for i in range(3):
        P.append(box("vent%d" % i, (0.66, 0.04, 0.05), (0, 0.435, 0.34 + i*0.15), "dark"))
    return finish(P, "machine_slow")

def b_condenser():
    """Zbiornik kondensacyjny - pionowa butla z zaworem i skroplinami. 90 s."""
    P = []
    P.append(cyl("tank", 0.34, 1.24, (0, 0, 0.76), "teal", verts=12))
    P.append(cone("dome", 0.34, 0.14, 0.22, (0, 0, 1.49), "teal_lt", verts=12))
    P.append(cyl("skirt", 0.40, 0.16, (0, 0, 0.08), "dark", verts=12))
    for z in (0.42, 0.86, 1.26):
        P.append(cyl("band", 0.36, 0.06, (0, 0, z), "steel_d", verts=12))
    # wziernik z poziomem skroplin
    P.append(box("sight", (0.10, 0.05, 0.44), (0, -0.35, 0.72), "glass"))
    P.append(box("level", (0.08, 0.045, 0.16), (0, -0.36, 0.60), "blue"))
    # zawor spustowy + wylot na dole
    P.append(cyl("valve", 0.07, 0.22, (0, -0.42, 0.30), "steel", verts=8, rot=(math.radians(90), 0, 0)))
    P.append(cyl("hand", 0.11, 0.04, (0, -0.54, 0.30), "red", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(box("out", (0.34, 0.20, 0.20), (0, -0.36, 0.18), "dark"))
    P.append(box("outlip", (0.40, 0.09, 0.05), (0, -0.47, 0.12), "hazard"))
    P.append(cyl("cool", 0.06, 0.62, (0.30, 0.22, 0.85), "steel_d", verts=8))
    P.append(cyl("cool2", 0.06, 0.62, (-0.30, 0.22, 0.85), "steel_d", verts=8))
    P.append(box("gauge", (0.14, 0.06, 0.14), (0, -0.36, 1.16), "white"))
    return finish(P, "condenser")

def b_duckomat():
    """Kaczkomat - automat vendingowy, kaczki na polkach za szyba. 30 s."""
    P = []
    P.append(box("cab", (0.92, 0.62, 1.60), (0, 0, 0.86), "red"))
    P.append(box("plinth", (0.98, 0.68, 0.14), (0, 0, 0.07), "dark"))
    # szyba cofnieta, rama przed nia, polki w srodku - nic wspolplaszczyznowego
    P.append(box("glass", (0.62, 0.05, 1.10), (-0.12, -0.30, 0.98), "glass"))
    P.append(box("frame", (0.70, 0.035, 1.18), (-0.12, -0.325, 0.98), "steel_d"))
    for i in range(4):
        P.append(box("shelf%d" % i, (0.58, 0.34, 0.03), (-0.12, -0.14, 0.52 + i*0.30), "steel_d"))
        for j in range(3):
            P.append(box("stock%d%d" % (i, j), (0.11, 0.11, 0.13),
                         (-0.34 + j*0.22, -0.14, 0.60 + i*0.30), "hazard"))
    # kolumna obslugi po prawej
    P.append(box("keys", (0.16, 0.05, 0.30), (0.30, -0.32, 1.24), "dark"))
    for i in range(6):
        P.append(box("key%d" % i, (0.04, 0.03, 0.04), (0.25 + (i % 2)*0.09, -0.35, 1.32 - (i//2)*0.08), "white"))
    P.append(box("slot", (0.12, 0.04, 0.03), (0.30, -0.33, 1.02), "black"))
    # odbior: swiatlo 0.44 x 0.28
    P.append(box("bin", (0.48, 0.22, 0.28), (0, -0.34, 0.34), "black"))
    P.append(box("flap", (0.52, 0.05, 0.26), (0, -0.44, 0.36), "hazard", rot=(math.radians(-24), 0, 0)))
    P.append(box("head", (0.96, 0.66, 0.16), (0, 0, 1.70), "hazard"))
    P.append(box("logo", (0.60, 0.05, 0.10), (0, -0.34, 1.70), "white"))
    return finish(P, "duckomat")

def b_hatchery():
    """Kaczkowa wylegarnia - plyta grzewcza z jajami pod kloszem. 20 s."""
    P = []
    P.append(box("bed", (1.14, 0.88, 0.30), (0, 0, 0.15), "steel"))
    P.append(box("plinth", (1.20, 0.94, 0.12), (0, 0, 0.06), "dark"))
    P.append(box("pad", (0.94, 0.68, 0.05), (0, 0.02, 0.325), "orange"))
    # klosz: cztery pochylone szyby + kalenica, otwarty od frontu
    for sx in (-1, 1):
        P.append(box("panex", (0.05, 0.72, 0.46), (sx*0.46, 0.02, 0.56), "glass",
                     rot=(0, math.radians(sx*16), 0)))
    P.append(box("paneb", (0.94, 0.05, 0.46), (0, 0.38, 0.56), "glass", rot=(math.radians(-14), 0, 0)))
    P.append(box("ridge", (1.00, 0.80, 0.06), (0, 0.02, 0.80), "teal"))
    P.append(box("rlip", (1.06, 0.86, 0.04), (0, 0.02, 0.835), "hazard"))
    for i in range(5):                      # jaja na plycie
        P.append(ball("egg%d" % i, 0.075, (-0.32 + i*0.16, 0.08, 0.40), "white",
                      seg=8, ring_count=5, scale=(1.0, 1.0, 1.25)))
    P.append(cyl("heat", 0.05, 0.86, (0, 0.30, 0.72), "red", verts=8, rot=(0, math.radians(90), 0)))
    # wylot z przodu, tuz nad podloga
    P.append(box("out", (0.50, 0.20, 0.22), (0, -0.40, 0.19), "dark"))
    P.append(box("outlip", (0.56, 0.10, 0.05), (0, -0.51, 0.13), "hazard"))
    P.append(box("panel", (0.20, 0.06, 0.12), (0.36, -0.45, 0.26), "hazard"))
    return finish(P, "hatchery")

def b_printer3d():
    """Kaczkowa drukarka 3D - OTWARTY portal z glowica nad stolem. 180 s.

    Pierwsza wersja miala peelna przeszklona obudowe z trzech stron. W palecie
    PAL["glass"] to (0.08, 0.16, 0.20) - kolor prawie czarny i CALKOWICIE
    nieprzezroczysty, bo eksport nie niesie alfy dla tego materialu. Efekt:
    ciemne pudlo, w ktorym nie bylo widac ani portalu, ani dyszy, ani szpuli,
    czyli wszystkiego, po czym poznaje sie drukarke. Zostaje sama szyba tylna,
    reszta idzie na otwarta rame."""
    P = []
    P.append(box("base", (1.00, 0.96, 0.18), (0, 0, 0.09), "dark"))
    P.append(box("hazb", (0.94, 0.90, 0.04), (0, 0, 0.19), "hazard"))
    P.append(box("bed", (0.64, 0.64, 0.04), (0, 0, 0.36), "teal_lt"))
    P.append(box("bedr", (0.70, 0.70, 0.03), (0, 0, 0.335), "steel_d"))
    for sx in (-1, 1):                      # rama portalu, otwarta na wylot
        P.append(box("colf", (0.07, 0.07, 1.08), (sx*0.42, -0.42, 0.73), "steel"))
        P.append(box("colb", (0.07, 0.07, 1.08), (sx*0.42,  0.42, 0.73), "steel"))
        P.append(box("beamy", (0.06, 0.90, 0.06), (sx*0.42, 0, 1.24), "steel_d"))
    P.append(box("beamx", (0.90, 0.09, 0.09), (0, 0.10, 1.24), "hazard"))
    P.append(box("beamf", (0.90, 0.06, 0.06), (0, -0.42, 1.24), "steel_d"))
    # glowica na belce, dysza wskazuje w dol na stol
    P.append(box("carriage", (0.22, 0.16, 0.14), (0.06, 0.10, 1.16), "orange"))
    P.append(cone("nozzle", 0.07, 0.02, 0.13, (0.06, 0.10, 1.03), "steel_d", verts=8))
    P.append(box("post", (0.05, 0.05, 0.62), (0.06, 0.10, 0.72), "duck"))   # wydruk w toku
    # szpula NA ZEWNATRZ tylnej kolumny - widac ja z kazdej strony
    P.append(cyl("spool", 0.16, 0.05, (0.30, 0.50, 0.98), "duck", verts=12, rot=(math.radians(90), 0, 0)))
    P.append(cyl("spoolh", 0.05, 0.10, (0.30, 0.50, 0.98), "dark", verts=8, rot=(math.radians(90), 0, 0)))
    P.append(box("skinb", (0.84, 0.04, 0.94), (0, 0.415, 0.78), "glass"))   # tylko tylna szyba
    P.append(box("out", (0.42, 0.20, 0.18), (0, -0.38, 0.16), "dark"))
    P.append(box("outlip", (0.48, 0.09, 0.05), (0, -0.48, 0.11), "hazard"))
    P.append(box("panel", (0.24, 0.05, 0.12), (-0.22, -0.45, 0.42), "teal"))
    return finish(P, "printer3d")

def b_press_gold():
    """Zlota prasa - ta sama kinematyka co prasa, w zlocie. 40 s, bez tieru 0."""
    P = []
    P.append(box("bed", (0.92, 0.62, 0.22), (0, 0, 0.11), "steel_d"))
    P.append(box("plinth", (0.98, 0.68, 0.10), (0, 0, 0.05), "dark"))
    for sx in (-1, 1):
        P.append(box("post", (0.13, 0.13, 1.24), (sx*0.36, 0, 0.74), "hazard"))
    P.append(box("crown", (0.96, 0.50, 0.22), (0, 0, 1.47), "hazard"))
    P.append(box("crest", (0.60, 0.36, 0.07), (0, 0, 1.61), "duck"))
    P.append(cyl("ram", 0.15, 0.46, (0, 0, 1.10), "duck", verts=10))
    P.append(box("head", (0.56, 0.44, 0.18), (0, 0, 0.86), "duck"))
    P.append(box("anvil", (0.66, 0.50, 0.09), (0, 0, 0.265), "duck"))
    for sx in (-1, 1):                      # zlote listwy na slupach
        P.append(box("inlay", (0.05, 0.15, 1.00), (sx*0.36, 0, 0.74), "duck"))
    P.append(cyl("gauge", 0.10, 0.05, (0, -0.27, 1.47), "white", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(box("out", (0.44, 0.18, 0.16), (0, -0.34, 0.14), "dark"))
    P.append(box("outlip", (0.50, 0.09, 0.04), (0, -0.43, 0.09), "duck"))
    return finish(P, "press_gold")

def b_reactor():
    """Reaktor rzadkosciowy - rdzen w klatce preetow chlodzacych. Tylko top tier."""
    P = []
    N = 10
    P.append(cyl("vessel", 0.42, 1.10, (0, 0, 0.72), "teal", verts=N))
    P.append(cone("dome", 0.42, 0.16, 0.26, (0, 0, 1.40), "teal_lt", verts=N))
    P.append(cyl("skirt", 0.52, 0.20, (0, 0, 0.10), "dark", verts=N))
    P.append(cyl("core", 0.20, 0.60, (0, 0, 0.72), "duck", verts=8))
    # okna rdzenia: cztery pionowe szczeliny w plaszczu
    for i in range(4):
        a = math.radians(i*90 + 45)
        P.append(box("slit%d" % i, (0.14, 0.06, 0.50), (math.sin(a)*0.42, math.cos(a)*0.42, 0.72),
                     "duck", rot=(0, 0, -a)))
    # Obreecze i cokol na 8 segmentach, prety szesciokatne: pierwsza wersja
    # wyszla 848 trojkatow przy budzecie 800, a roznicy w sylwetce nie widac.
    for z in (0.34, 1.02):
        ring_xy("band", 0.45, 8, 2*math.pi*0.45/8*1.45, 0.10, 0.07, z, "hazard", P)
    for i in range(6):                      # prety chlodzace dokola
        a = math.radians(i*60)
        P.append(cyl("rod%d" % i, 0.055, 1.30, (math.sin(a)*0.62, math.cos(a)*0.62, 0.68), "steel", verts=6))
        P.append(cyl("rodc%d" % i, 0.075, 0.09, (math.sin(a)*0.62, math.cos(a)*0.62, 1.36), "hazard", verts=6))
    ring_xy("plinth", 0.66, 8, 2*math.pi*0.66/8*1.40, 0.22, 0.12, 0.06, "concrete", P)
    P.append(box("out", (0.40, 0.24, 0.24), (0, -0.52, 0.24), "dark"))
    P.append(box("outlip", (0.46, 0.10, 0.05), (0, -0.64, 0.18), "hazard"))
    return finish(P, "reactor", merge=0.001)


# ================================================== FAZA 1 - GRUPA 3
# Budowle. Dwanascie to czysta danina (kind wall / ramp / conveyor / blower bez
# zmian), piec czeka na jedno pole w wierszu: restitution, friction albo
# blow.pitchDegrees. Geometria jest ta sama w obu przypadkach - pole opisuje
# zachowanie, nie ksztalt - wiec buduje sie je razem.
#
# Rodzina ogrodzeniowa (wall_glass, wall_soft, fence_mesh, neon_ducks) ma
# CELOWO ten sam obrys 2.00 x 0.25 co wall: dzieki temu miesza sie z istniejacym
# plotem bez szczelin, a gracz nie musi wiedziec, ktora sciana jest ktora.

def _fence_body(name, panel_col, panel_h, cap_col="hazard", ribs=True, extra=None):
    """Wspolny szkielet plotu: cokol, dwa zebra, czapka. Rozni sie wypelnieniem."""
    P = []
    P.append(box("foot", (2.06, 0.22, 0.10), (0, 0, 0.05), "steel_d"))
    if extra: extra(P)
    P.append(box("cap", (2.06, 0.20, 0.09), (0, 0, panel_h + 0.02), cap_col))
    if ribs:
        for sx in (-1, 1):
            P.append(box("rib", (0.10, 0.20, panel_h - 0.06), (sx*0.86, 0, panel_h/2), "steel_d"))
    return P

def b_wall_glass():
    """Sciana szklana - widac przez nia tor, wiec rama jest cala historia."""
    def ex(P):
        P.append(box("pane", (1.86, 0.07, 0.88), (0, 0, 0.52), "glass"))
        P.append(box("mull", (0.07, 0.11, 0.88), (0, 0, 0.52), "steel"))
        for sz in (0, 1):
            P.append(box("hbar", (1.90, 0.10, 0.05), (0, 0, 0.14 + sz*0.76), "steel"))
    P = _fence_body("wall_glass", "glass", 1.00, extra=ex)
    return finish(P, "wall_glass")

def b_wall_soft():
    """Miekka sciana - gumowe wypelnienie w stalowej ramie. collider.restitution."""
    def ex(P):
        for i in range(5):                  # poziome walce gumy - czyta sie miekko
            P.append(cyl("pad%d" % i, 0.095, 1.86, (0, 0, 0.20 + i*0.18), "rubber",
                         verts=8, rot=(0, math.radians(90), 0)))
        P.append(box("back", (1.90, 0.08, 0.92), (0, 0.07, 0.52), "dark"))
    P = _fence_body("wall_soft", "rubber", 1.00, cap_col="orange", extra=ex)
    return finish(P, "wall_soft")

def b_fence_mesh():
    """Plot siatkowy - przepuszcza nadmuch za darmo, bo dmuchawa to test stozka."""
    def ex(P):
        for sx in (-1, 1):
            P.append(box("post", (0.09, 0.12, 1.02), (sx*0.95, 0, 0.51), "steel"))
        for i in range(13):                 # pionowe druty
            P.append(box("wv%d" % i, (0.022, 0.022, 0.86), (-0.90 + i*0.15, 0, 0.51), "steel_d"))
        for i in range(5):                  # poziome druty, cienesze, w innej plaszczyznie
            P.append(box("wh%d" % i, (1.86, 0.016, 0.016), (0, 0.012, 0.16 + i*0.19), "steel_d"))
        P.append(box("toprail", (1.94, 0.06, 0.05), (0, 0, 0.98), "steel"))
    P = _fence_body("fence_mesh", "steel_d", 1.00, ribs=False, extra=ex)
    return finish(P, "fence_mesh")

# --- NEON LETTERS ARE STROKES, NOT PLACEHOLDER BARS --------------------------
# The old sign put five IDENTICAL yellow bars on the board and trusted distance
# to blur them into a word. It never did: five bars spell five bars, and Jurek
# read it as exactly that. A word only survives downsampling if the strokes are
# where the reader's eye expects them, so each glyph here is drawn the way a real
# neon tube is bent -- one box per straight run, the two diagonals of K rotated
# about Y (which is the sign's own plane, since the board faces -Y).
#
# The whole alphabet needed is D U C K S, so only those five are implemented; a
# generic font would cost tris nobody spends. 18 strokes x 12 tris = 216, which
# is where almost the entire budget of this model goes -- deliberately, because
# the letters ARE the model. Everything else was trimmed to pay for them.

def _neon_seg(P, x, z, sw, sh, t, y, col, rot=0.0):
    P.append(box("s", (sw, t, sh), (x, y, z), col, rot=(0, rot, 0)))


def _neon_glyph(P, ch, cx, cz, w, h, t, y, col):
    """Jedna litera z odcinkow rurki. cx/cz - srodek pola litery."""
    hw, hh = w / 2.0, h / 2.0
    L, R = cx - hw + t / 2, cx + hw - t / 2       # osie pionowych lasek
    TOP, BOT = cz + hh - t / 2, cz - hh + t / 2   # osie poziomych belek
    span = w - t                                  # dlugosc belki miedzy laskami

    def vert(x, zc, hgt): _neon_seg(P, x, zc, t, hgt, t, y, col)
    def horiz(zc, xc=None, ln=None):
        _neon_seg(P, cx if xc is None else xc, zc, span if ln is None else ln, t, t, y, col)
    def diag(x0, z0, x1, z1):
        dx, dz = x1 - x0, z1 - z0
        _neon_seg(P, (x0 + x1) / 2, (z0 + z1) / 2, math.hypot(dx, dz), t, t, y, col,
                  rot=-math.atan2(dz, dx))

    if ch == "D":
        vert(L, cz, h)                            # grzbiet
        horiz(TOP, cx + t / 2, span - t)
        horiz(BOT, cx + t / 2, span - t)
        vert(R, cz, h - 2 * t)                    # brzuch krotszy = czyta sie jako luk
    elif ch == "U":
        vert(L, cz + t / 2, h - t)
        vert(R, cz + t / 2, h - t)
        horiz(BOT)
    elif ch == "C":
        horiz(TOP, cx + t / 2, span - t)
        vert(L, cz, h - t)
        horiz(BOT, cx + t / 2, span - t)
    elif ch == "K":
        vert(L, cz, h)
        diag(L + t / 2, cz, R, TOP)
        diag(L + t / 2, cz, R, BOT)
    elif ch == "S":
        horiz(TOP, cx + t / 2, span - t)
        vert(L, cz + hh / 2, hh)                  # gorna polka po LEWEJ
        horiz(cz)
        vert(R, cz - hh / 2, hh)                  # dolna po PRAWEJ
        horiz(BOT, cx - t / 2, span - t)


def b_neon_ducks():
    """Neon DUCKS - swiecacy szyld. Litery sa prawdziwe, nie pieec slupkow."""
    P = []
    P.append(box("foot", (2.06, 0.22, 0.10), (0, 0, 0.05), "steel_d"))
    for sx in (-1, 1):                      # maszty
        P.append(box("mast", (0.09, 0.11, 1.30), (sx*0.90, 0, 0.68), "dark"))
    # Tablica jest CZARNA, nie ciemnoszara: zolta rurka na czerni to najwiekszy
    # kontrast, jaki daje paleta, a to on decyduje o czytelnosci po zmniejszeniu.
    P.append(box("board", (1.86, 0.06, 0.66), (0, 0.01, 1.06), "black"))
    P.append(box("bframe", (1.94, 0.05, 0.74), (0, 0.045, 1.06), "steel_d"))
    # 5 liter, podzialka 0.35 -> napis ma 1.75 z 1.86 szerokosci tablicy
    PITCH, GW, GH, T = 0.35, 0.27, 0.40, 0.055
    for i, ch in enumerate("DUCKS"):
        _neon_glyph(P, ch, -2 * PITCH + i * PITCH, 1.06, GW, GH, T, -0.055, "hazard")
    P.append(box("hood", (1.98, 0.20, 0.07), (0, -0.04, 1.45), "hazard"))
    P.append(box("underline", (1.60, 0.04, 0.03), (0, -0.05, 0.80), "white"))
    return finish(P, "neon_ducks")

def b_slide():
    """Zjezdzalnia prosta - trzymetrowa rynna ze spadkiem, burty przez cala dlugosc."""
    P = []
    L = 2.92
    ang = math.radians(14)
    ca, sa = math.cos(ang), math.sin(ang)
    ZC = 0.78
    def T(s, up):
        return (s*ca - up*sa, ZC + s*sa + up*ca)
    y, z = T(0, 0)
    P.append(box("bed", (0.84, L, 0.06), (0, y, z), "teal_lt", rot=(ang, 0, 0)))
    for sx in (-1, 1):
        y, z = T(0, 0.13)
        P.append(box("side", (0.06, L, 0.26), (sx*0.42, y, z), "hazard", rot=(ang, 0, 0)))
    for i in range(6):                      # przetloczenia dna
        y, z = T(-1.20 + i*0.48, 0.035)
        P.append(box("rib%d" % i, (0.74, 0.05, 0.02), (0, y, z), "teal", rot=(ang, 0, 0)))
    for i, s in enumerate((-1.20, -0.30, 0.60, 1.32)):   # nogi malejace ku przodowi
        yb, zb = T(s, -0.03)
        P.append(box("leg%d" % i, (0.09, 0.09, zb), (0, yb, zb/2), "steel"))
        P.append(box("tie%d" % i, (0.62, 0.06, 0.06), (0, yb, zb*0.45), "steel_d"))
    y, z = T(-L/2 - 0.05, 0.03)             # jezyk zjazdu przy podlodze
    P.append(box("lip", (0.80, 0.18, 0.04), (0, y, z), "hazard", rot=(ang, 0, 0)))
    y, z = T(L/2 - 0.02, 0.16)              # sciana na szczycie
    P.append(box("back", (0.84, 0.05, 0.34), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    return finish(P, "slide")

def b_fan_strong():
    """Wiatrak mocny - ta sama klasa co fan, wieksza tarcza i cieezszy cokol."""
    P = []
    P.append(cyl("base", 0.50, 0.14, (0, 0.26, 0.07), "dark", verts=12))
    P.append(box("ballast", (0.90, 0.30, 0.16), (0, 0.30, 0.20), "steel_d"))
    P.append(cyl("pole", 0.12, 1.00, (0, 0.26, 0.66), "steel", verts=8))
    P.append(box("brack", (0.14, 0.17, 0.14), (0, 0.225, 1.14), "steel_d"))
    ring_xz("ring", 0.68, 16, 0.30, 0.12, 0.12, 1.14, "steel", P)
    ring_xz("ring2", 0.60, 8, 0.50, 0.06, 0.06, 1.14, "hazard", P)
    P.append(cyl("hub", 0.19, 0.26, (0, 0, 1.14), "orange", verts=10, rot=(math.radians(90), 0, 0)))
    for i in range(5):
        a = math.radians(i*72 + 18)
        P.append(box("blade%d" % i, (0.21, 0.06, 0.50),
                     (math.sin(a)*0.31, 0, 1.14 + math.cos(a)*0.31), "hazard",
                     rot=(math.radians(24), a, 0)))
    P.append(box("motor", (0.22, 0.22, 0.22), (0, 0.30, 1.14), "steel_d"))
    return finish(P, "fan_strong")

def b_fan_vertical():
    """Wiatrak pionowy - dmucha W GORE. Czeka na blow.pitchDegrees."""
    P = []
    P.append(cyl("base", 0.42, 0.16, (0, 0, 0.08), "dark", verts=12))
    ring_xy("ring", 0.40, 14, 0.20, 0.11, 0.11, 0.72, "steel", P)
    P.append(cyl("hub", 0.15, 0.20, (0, 0, 0.72), "orange", verts=10))
    for i in range(4):                      # lopatki w plaszczyznie POZIOMEJ
        a = math.radians(i*90 + 20)
        P.append(box("blade%d" % i, (0.16, 0.34, 0.05),
                     (math.sin(a)*0.22, math.cos(a)*0.22, 0.72), "hazard",
                     rot=(math.radians(26), 0, -a)))
    for i in range(3):                      # kosz nosny
        a = math.radians(i*120)
        P.append(box("strut%d" % i, (0.07, 0.07, 0.60), (math.sin(a)*0.36, math.cos(a)*0.36, 0.42), "steel"))
    P.append(cyl("grille", 0.40, 0.04, (0, 0, 0.86), "steel_d", verts=14))
    for i in range(4):                      # krata wylotu - widac, ze dmucha w gore
        P.append(box("bar%d" % i, (0.78, 0.05, 0.03), (0, -0.27 + i*0.18, 0.88), "hazard"))
    P.append(box("haz", (0.84, 0.84, 0.04), (0, 0, 0.165), "hazard"))
    return finish(P, "fan_vertical", merge=0.001)

def b_vibe_floor():
    """Wibrator podlogowy - tasmociag o ZEROWEJ wysokosci. Plaski collider."""
    P = []
    L, W = 1.92, 0.92
    P.append(box("plate", (W, L, 0.07), (0, 0, 0.035), "steel_d"))
    for i in range(9):                      # poprzeczne zebra, po nich kaczki ida
        P.append(box("rib%d" % i, (W - 0.08, 0.07, 0.035), (0, -L/2 + 0.16 + i*0.20, 0.085), "steel"))
    for sx in (-1, 1):                      # krawezniki - 4 cm, kaczka je przejezdza
        P.append(box("edge", (0.05, L, 0.10), (sx*(W/2 + 0.025), 0, 0.05), "hazard"))
    for sy in (-1, 1):                      # skosne najazdy na obu koncach
        P.append(box("ramp", (W, 0.14, 0.03), (0, sy*(L/2 + 0.05), 0.028), "hazard",
                     rot=(math.radians(-sy*12), 0, 0)))
    for sx in (-1, 1):                      # wibratory przykrecone pod plyta
        P.append(cyl("mot", 0.07, 0.20, (sx*0.30, 0, 0.07), "orange", verts=8,
                     rot=(0, math.radians(90), 0)))
    for i in range(4):                      # zolte strzalki kierunku
        P.append(box("ar%d" % i, (0.10, 0.24, 0.012), (0, -0.66 + i*0.44, 0.106), "hazard"))
    return finish(P, "vibe_floor")

def b_platform():
    """Podest - plaski poziom 2x2 na czterech nogach. Kaczki po nim chodza."""
    P = []
    P.append(box("deck", (1.94, 1.94, 0.10), (0, 0, 0.55), "steel"))
    for i in range(7):                      # kraty pokladu
        P.append(box("gr%d" % i, (1.88, 0.16, 0.03), (0, -0.78 + i*0.26, 0.615), "steel_d"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.12, 0.12, 0.55), (sx*0.84, sy*0.84, 0.275), "steel"))
            P.append(box("foot", (0.20, 0.20, 0.05), (sx*0.84, sy*0.84, 0.025), "dark"))
        P.append(box("braceX", (1.72, 0.07, 0.07), (0, sx*0.84, 0.20), "steel_d"))
        P.append(box("braceY", (0.07, 1.72, 0.07), (sx*0.84, 0, 0.20), "steel_d"))
    for sx in (-1, 1):                      # zolty krawedziowy pasek
        P.append(box("nose", (2.00, 0.07, 0.05), (0, sx*0.97, 0.60), "hazard"))
        P.append(box("noseY", (0.07, 2.00, 0.05), (sx*0.97, 0, 0.60), "hazard"))
    return finish(P, "platform")

def b_stairs():
    """Schody - cztery stopnie na wysokosc podestu. Bryla SCHODKOWA, nie rama.

    Pierwsza wersja miala policzki 1.94 m dlugie obrocone o -24 stopnie, po
    jednym z kazdej strony, na samej krawedzi obrysu. Obrocona belka o dlugosci
    calego biegu to po prostu PLYTA: przykrywala wszystkie stopnie z obu stron,
    a pelnowymiarowy ciemny cokol dokladal czarny fartuch pod spodem. Z boku
    wygladalo to jak pochylnia, z gory jak plyta. Stopnie sa teraz pelnymi
    bryami narastajacymi ku tylowi - schody czytelne z KAZDEJ strony, i przy
    okazji uczciwy ksztalt dla collidera, ktory i tak jest prostopadloscianem.

    Wysokosc dobrana pod podest: 4 x 0.15 = 0.60, czyli dokladnie gorna plaszczyzna
    pokladu b_platform. Te dwie budowle maja do siebie pasowac."""
    P = []
    N, RISE, RUN = 4, 0.15, 0.45
    BACK, W = 0.98, 0.94
    for i in range(N):
        yf = -0.98 + i*RUN                  # czolo stopnia
        d = BACK - yf
        h = (i + 1)*RISE
        P.append(box("step%d" % i, (W, d, h), (0, yf + d/2, h/2), "steel"))
        P.append(box("nose%d" % i, (W + 0.04, 0.07, 0.035), (0, yf + 0.02, h - 0.015), "hazard"))
        P.append(box("riser%d" % i, (W + 0.02, 0.035, RISE - 0.05), (0, yf, h - RISE/2 - 0.02), "steel_d"))
    for sx in (-1, 1):                      # krawezniki boczne, TYLKO przy podstawie
        P.append(box("skirt", (0.03, 1.96, 0.10), (sx*0.485, 0, 0.05), "steel_d"))
    P.append(box("foot", (1.00, 0.10, 0.04), (0, -0.95, 0.02), "dark"))
    return finish(P, "stairs")

def b_roof():
    """Dach - zadaszenie 2x2 na dwoch slupach. Kaczki pod nim, deszczu i tak nie ma."""
    P = []
    P.append(box("sheet", (1.94, 1.94, 0.07), (0, 0, 1.72), "steel_d"))
    for i in range(8):                      # blacha trapezowa
        P.append(box("corr%d" % i, (0.14, 1.94, 0.05), (-0.84 + i*0.24, 0, 1.78), "steel"))
    P.append(box("edge", (2.00, 2.00, 0.05), (0, 0, 1.665), "hazard"))
    for sx in (-1, 1):
        P.append(box("post", (0.13, 0.13, 1.66), (sx*0.82, 0.82, 0.83), "steel"))
        P.append(box("base", (0.24, 0.24, 0.06), (sx*0.82, 0.82, 0.03), "dark"))
        P.append(box("brace", (0.30, 0.30, 0.06), (sx*0.70, 0.70, 1.52), "steel_d",
                     rot=(0, 0, math.radians(45))))
    P.append(box("beam", (1.80, 0.10, 0.12), (0, 0.82, 1.60), "steel_d"))
    P.append(box("gutter", (1.98, 0.10, 0.09), (0, -0.94, 1.63), "hazard"))
    return finish(P, "roof")

def b_ice_slide():
    """Slizg lodowy - plyta o niemal zerowym tarciu. collider.friction w wierszu."""
    P = []
    P.append(box("slab", (1.94, 1.94, 0.09), (0, 0, 0.045), "glass"))
    P.append(box("sheen", (1.80, 1.80, 0.03), (0, 0, 0.10), "teal_lt"))
    for i in range(5):                      # rysy na lodzie, plytkie i nieregularne
        P.append(box("crack%d" % i, (1.60 - i*0.18, 0.03, 0.012), (0.05*i, -0.62 + i*0.31, 0.117),
                     "white", rot=(0, 0, math.radians(-9 + i*5))))
    for sx in (-1, 1):                      # obramowanie - bez niego plyta znika na betonie
        P.append(box("edgeX", (2.00, 0.08, 0.13), (0, sx*0.96, 0.065), "teal"))
        P.append(box("edgeY", (0.08, 2.00, 0.13), (sx*0.96, 0, 0.065), "teal"))
        for sy in (-1, 1):
            P.append(box("stud", (0.16, 0.16, 0.15), (sx*0.92, sy*0.92, 0.075), "hazard"))
    return finish(P, "ice_slide")

def b_pit_kerb():
    """Krawezniek pitu - prosty odcinek obrzeza, dokladany do pit_rim."""
    P = []
    P.append(box("kerb", (0.94, 0.44, 0.26), (0, 0, 0.13), "concrete"))
    P.append(box("stripe", (0.98, 0.46, 0.05), (0, 0, 0.275), "hazard"))
    for i, x in enumerate((-0.30, 0.02, 0.34)):
        P.append(box("dash%d" % i, (0.18, 0.47, 0.055), (x, 0, 0.278), "dark"))
    P.append(box("skirt", (1.00, 0.50, 0.07), (0, 0, 0.035), "steel_d"))
    P.append(box("inner", (0.94, 0.07, 0.12), (0, -0.24, 0.32), "dark"))
    return finish(P, "pit_kerb")

def b_lamp_post():
    """Lampa - niski slupek oswietleniowy. Mniejszy brat swiatowej lamp.glb."""
    P = []
    P.append(cyl("base", 0.22, 0.12, (0, 0, 0.06), "dark", verts=10))
    P.append(cyl("pole", 0.06, 1.90, (0, 0, 1.02), "steel_d", verts=8))
    P.append(box("band", (0.14, 0.14, 0.08), (0, 0, 0.42), "hazard"))
    P.append(cone("shade", 0.24, 0.09, 0.20, (0, 0, 2.02), "hazard", verts=10))
    P.append(cyl("bulb", 0.14, 0.05, (0, 0, 1.90), "white", verts=10))
    P.append(cyl("cap", 0.08, 0.06, (0, 0, 2.14), "steel_d", verts=8))
    return finish(P, "lamp_post")

def b_sign_dir():
    """Znak kierunkowy - strzalka na slupku. Mowi graczowi, gdzie jest pit."""
    P = []
    P.append(box("foot", (0.28, 0.20, 0.07), (0, 0, 0.035), "dark"))
    P.append(cyl("post", 0.045, 1.30, (0, 0, 0.72), "steel", verts=8))
    P.append(box("plate", (0.52, 0.05, 0.24), (0.06, 0, 1.24), "hazard"))
    P.append(box("edge", (0.56, 0.03, 0.28), (0.06, 0.02, 1.24), "dark"))
    P.append(box("head", (0.16, 0.06, 0.16), (0.34, 0, 1.24), "hazard", rot=(0, 0, math.radians(45))))
    for i in range(3):                      # kreski "napisu"
        P.append(box("txt%d" % i, (0.09, 0.03, 0.05), (-0.10 + i*0.13, -0.035, 1.24), "dark"))
    P.append(box("plate2", (0.44, 0.05, 0.18), (-0.02, 0, 0.94), "white"))
    P.append(box("head2", (0.13, 0.05, 0.13), (-0.26, 0, 0.94), "white", rot=(0, 0, math.radians(45))))
    return finish(P, "sign_dir")

def b_bumper():
    """Odbijacz - gumowy grzyb, ktory odrzuca kaczki. collider.restitution."""
    P = []
    P.append(cyl("plinth", 0.46, 0.10, (0, 0, 0.05), "dark", verts=12))
    P.append(cyl("skirt", 0.42, 0.16, (0, 0, 0.18), "hazard", verts=12))
    P.append(cyl("body", 0.36, 0.40, (0, 0, 0.44), "rubber", verts=12))
    P.append(cone("cap", 0.40, 0.20, 0.20, (0, 0, 0.72), "red", verts=12))
    P.append(cyl("top", 0.20, 0.07, (0, 0, 0.85), "white", verts=10))
    for i in range(6):                      # gumowe zebra - czyta sie sprezyscie
        a = math.radians(i*60)
        P.append(box("rib%d" % i, (0.09, 0.07, 0.36), (math.sin(a)*0.37, math.cos(a)*0.37, 0.44),
                     "red", rot=(0, 0, -a)))
    ring_xy("ring", 0.44, 12, 0.24, 0.09, 0.05, 0.27, "white", P)
    return finish(P, "bumper", merge=0.001)

def b_trampoline():
    """Trampolina - wyrzuca kaczki w GORE. blow.pitchDegrees + duza sila."""
    P = []
    R, N = 0.66, 12
    P.append(cyl("mat", R, 0.05, (0, 0, 0.44), "dark", verts=N))
    P.append(cyl("matt", R - 0.06, 0.02, (0, 0, 0.475), "teal", verts=N))
    ring_xy("frame", R + 0.06, N, 2*math.pi*(R+0.06)/N*1.45, 0.13, 0.10, 0.46, "hazard", P)
    for i in range(N):                      # sprezyny promieniowe
        a = math.radians(i*360.0/N + 15)
        P.append(box("spr%d" % i, (0.05, 0.14, 0.05), (math.sin(a)*(R + 0.02), math.cos(a)*(R + 0.02), 0.46),
                     "steel", rot=(0, 0, -a)))
    for i in range(6):                      # nogi
        a = math.radians(i*60 + 30)
        P.append(box("leg%d" % i, (0.07, 0.07, 0.46), (math.sin(a)*(R + 0.02), math.cos(a)*(R + 0.02), 0.23),
                     "steel_d", rot=(math.radians(-7)*math.cos(a), math.radians(7)*math.sin(a), 0)))
    ring_xy("footring", R + 0.08, 8, 2*math.pi*(R+0.08)/8*1.40, 0.14, 0.05, 0.025, "dark", P)
    for i in range(4):                      # strzalki w gore na macie
        a = math.radians(i*90)
        P.append(box("ar%d" % i, (0.08, 0.22, 0.015), (math.sin(a)*0.30, math.cos(a)*0.30, 0.49),
                     "hazard", rot=(0, 0, -a)))
    return finish(P, "trampoline", merge=0.001)


# ================================================== FAZA 1 - GRUPA 4
# Narzedzia i pojemniki. Dwanascie to czysta danina (kind storage / carry /
# tool w trybie sweep albo beam), piec czeka na jedno pole: storage.leakPerSecond,
# tool.pull albo nowy tryb w KINDS.tool.modes.
#
# Cztery z nich (dmuchawa, spychacz, waz, wentylator) roznia sie w danych
# WYLACZNIE zasiegiem, katem i sila - wiec cala robota polega na tym, zeby
# roznily sie SYLWETKA. Inaczej gracz ma cztery wiersze i jeden przedmiot.

def b_sack():
    """Worek - miekki, przewiazany u gory. Wnetrze 0.62 x 0.62, kaczka ma 0.18."""
    P = []
    N = 10
    for i in range(N):                      # scianka z segmentow, lekko baryklowata
        a = math.radians(i*360.0/N)
        for j, (r, z, h) in enumerate(((0.30, 0.16, 0.32), (0.34, 0.44, 0.28), (0.26, 0.66, 0.20))):
            P.append(box("w%d%d" % (i, j), (2*math.pi*r/N*1.45, 0.03, h),
                         (math.sin(a)*r, math.cos(a)*r, z), "wood_lt", rot=(0, 0, -a)))
    P.append(cyl("bot", 0.29, 0.04, (0, 0, 0.02), "wood", verts=N))
    ring_xy("tie", 0.22, N, 2*math.pi*0.22/N*1.5, 0.07, 0.09, 0.80, "rust", P)
    for i in range(5):                      # zmarszczona szyjka nad przewiazaniem
        a = math.radians(i*72)
        P.append(box("fold%d" % i, (0.14, 0.07, 0.20), (math.sin(a)*0.17, math.cos(a)*0.17, 0.94),
                     "wood_lt", rot=(math.radians(9), 0, -a)))
    P.append(box("label", (0.20, 0.03, 0.14), (0, -0.32, 0.46), "white"))
    return finish(P, "sack", merge=0.001)

def b_crate_wood():
    """Skrzynia drewniana - pelne deski, bez azuru. storage.leakPerSecond."""
    P = []
    W, D, H, T = 0.94, 0.94, 0.66, 0.05
    P.append(box("bot", (W - 2*T, D - 2*T, T), (0, 0, T/2), "wood"))
    for sx in (-1, 1):
        for k in range(3):                  # deski poziome, kazda inaczej wysoko
            P.append(box("px", (T, D - 0.02, 0.19), (sx*(W/2 - T/2), 0, 0.10 + k*0.21), "wood_lt"))
        P.append(box("cx", (T + 0.02, D + 0.02, 0.05), (sx*(W/2 - T/2), 0, H - 0.02), "wood"))
    for sy in (-1, 1):
        for k in range(3):
            P.append(box("py", (W - 2*T - 0.02, T, 0.19), (0, sy*(D/2 - T/2), 0.10 + k*0.21), "wood_lt"))
        P.append(box("cy", (W - 2*T, T + 0.02, 0.05), (0, sy*(D/2 - T/2), H - 0.02), "wood"))
    for sx in (-1, 1):
        for sy in (-1, 1):                  # slupki narozne wystaja o 12 mm
            P.append(box("post", (0.09, 0.09, H + 0.04),
                         (sx*(W/2 - 0.033), sy*(D/2 - 0.033), (H + 0.04)/2), "wood"))
    for sx in (-1, 1):                      # przekatne wzmocnienia na dwoch bokach
        P.append(box("diag", (0.06, 1.18, 0.02), (sx*(W/2 + 0.008), 0, H/2), "wood",
                     rot=(math.radians(30), 0, 0)))
    return finish(P, "crate_wood")

def b_bucket_leaky():
    """Kubel dziurawy - to samo wiadro, ale z dziurami i strugami. leakPerSecond."""
    P = []
    N, RT, RB, H = 14, 0.35, 0.26, 0.52
    slant = math.hypot(RT - RB, H)
    tilt = math.atan2(RT - RB, H)
    wid = 2*math.pi*((RT + RB)/2)/N * 1.40
    rm = (RT + RB)/2
    for i in range(N):
        a = math.radians(i*360.0/N)
        P.append(box("w%d" % i, (wid, 0.022, slant), (math.sin(a)*rm, math.cos(a)*rm, H/2),
                     "rust", rot=(-tilt, 0, -a)))
    P.append(cyl("bot", RB, 0.03, (0, 0, 0.015), "steel_d", verts=N))
    ring_xy("rim", RT, N, 0.16, 0.05, 0.05, H, "steel", P)
    # DZIURY: ciemne wglebienia + strugi lecace w dol. Bez nich to zwykle wiadro.
    for i, (ai, zi) in enumerate(((40, 0.34), (150, 0.22), (250, 0.40), (310, 0.16))):
        a = math.radians(ai)
        rr = RB + (RT - RB)*(zi/H)
        P.append(box("hole%d" % i, (0.09, 0.05, 0.09), (math.sin(a)*rr, math.cos(a)*rr, zi),
                     "black", rot=(0, 0, -a)))
        P.append(box("drip%d" % i, (0.035, 0.035, zi), (math.sin(a)*(rr + 0.04), math.cos(a)*(rr + 0.04), zi/2),
                     "teal_lt"))
    NB = 7                                  # palak
    for i in range(NB - 1):
        t0 = math.radians(i * 180.0/(NB - 1)); t1 = math.radians((i + 1) * 180.0/(NB - 1))
        x0, z0 = math.cos(t0)*RT, H + math.sin(t0)*RT*0.92
        x1, z1 = math.cos(t1)*RT, H + math.sin(t1)*RT*0.92
        P.append(box("bail%d" % i, (math.hypot(x1 - x0, z1 - z0)*1.25, 0.028, 0.028),
                     ((x0 + x1)/2, 0, (z0 + z1)/2), "steel",
                     rot=(0, math.atan2(-(z1 - z0), (x1 - x0)), 0)))
    return finish(P, "bucket_leaky", merge=0.001)

def b_dumper():
    """Wywrotka - koryto na dwoch kolach, przechyla sie do przodu."""
    P = []
    tw, td, th, t = 1.02, 1.24, 0.44, 0.05
    P.append(box("bot", (tw, td, t), (0, 0.06, 0.52), "blue"))
    for sx in (-1, 1):
        P.append(box("sx", (t, td, th), (sx*(tw/2), 0.06, 0.52 + th/2), "blue"))
    P.append(box("back", (tw, t, th), (0, 0.06 + td/2, 0.52 + th/2), "blue"))
    P.append(box("front", (tw, t, th*0.55), (0, 0.06 - td/2, 0.52 + th*0.28), "blue"))
    ring = 0.05
    P.append(box("rimF", (tw + 0.05, ring, ring), (0, 0.06 - td/2, 0.52 + th), "hazard"))
    P.append(box("rimB", (tw + 0.05, ring, ring), (0, 0.06 + td/2, 0.52 + th), "hazard"))
    for sx in (-1, 1):
        P.append(box("rimS", (ring, td, ring), (sx*(tw/2), 0.06, 0.52 + th), "hazard"))
        P.append(box("frame", (0.07, 1.34, 0.07), (sx*0.44, 0.10, 0.44), "steel_d"))
        P.append(box("leg", (0.07, 0.07, 0.40), (sx*0.44, -0.48, 0.20), "steel"))
        P.append(box("axle", (0.06, 0.06, 0.24), (sx*0.30, 0.52, 0.34), "steel"))
        P.append(cyl("wheel", 0.30, 0.13, (sx*0.44, 0.52, 0.30), "rubber", verts=12,
                     rot=(0, math.radians(90), 0)))
        P.append(cyl("hub", 0.12, 0.15, (sx*0.44, 0.52, 0.30), "steel", verts=9,
                     rot=(0, math.radians(90), 0)))
        P.append(box("handle", (0.06, 0.50, 0.06), (sx*0.44, -0.72, 0.62), "wood",
                     rot=(math.radians(-22), 0, 0)))
        P.append(box("grip", (0.07, 0.16, 0.07), (sx*0.44, -0.90, 0.70), "dark"))
    P.append(cyl("pivot", 0.05, 0.94, (0, 0.30, 0.46), "hazard", verts=8, rot=(0, math.radians(90), 0)))
    return finish(P, "dumper", merge=0.001)

def b_pallet_jack():
    """Wozek paletowy - dwa widlaste ramiona przy podlodze, dyszel z pompa."""
    P = []
    for sx in (-1, 1):                      # widly
        P.append(box("fork", (0.20, 1.66, 0.07), (sx*0.24, -0.10, 0.075), "hazard"))
        P.append(box("forkt", (0.16, 0.26, 0.04), (sx*0.24, -0.88, 0.055), "hazard",
                     rot=(math.radians(7), 0, 0)))
        P.append(cyl("rollf", 0.055, 0.10, (sx*0.24, -0.80, 0.055), "rubber", verts=8,
                     rot=(0, math.radians(90), 0)))
        P.append(box("rib", (0.06, 1.50, 0.06), (sx*0.24, -0.10, 0.125), "steel_d"))
    P.append(box("yoke", (0.66, 0.16, 0.20), (0, 0.76, 0.14), "steel_d"))
    for sx in (-1, 1):
        P.append(cyl("wheel", 0.13, 0.09, (sx*0.26, 0.82, 0.13), "rubber", verts=10,
                     rot=(0, math.radians(90), 0)))
    P.append(box("pump", (0.22, 0.22, 0.34), (0, 0.74, 0.38), "steel"))
    P.append(cyl("mast", 0.05, 0.86, (0, 0.80, 0.86), "steel_d", verts=8, rot=(math.radians(-16), 0, 0)))
    P.append(box("tiller", (0.34, 0.09, 0.09), (0, 1.05, 1.22), "hazard"))
    P.append(box("lever", (0.09, 0.18, 0.05), (0.16, 0.96, 1.14), "orange"))
    return finish(P, "pallet_jack")

def b_broom_wide():
    """Miotla szeroka - dwa razy szerszy lob niz broom, ten sam tryb sweep."""
    P = []
    P.append(cyl("stick", 0.038, 1.42, (0, 0, 0.82), "wood", verts=8))
    P.append(box("head", (0.96, 0.22, 0.10), (0, 0, 0.155), "wood_lt"))
    P.append(box("cap", (0.98, 0.24, 0.04), (0, 0, 0.215), "steel_d"))
    for i in range(21):
        P.append(box("br%d" % i, (0.026, 0.20, 0.16), (-0.44 + i*0.044, 0, 0.06), "hazard"))
    P.append(cyl("ferr", 0.05, 0.14, (0, 0, 0.28), "steel", verts=8))
    P.append(cyl("grip", 0.048, 0.18, (0, 0, 1.46), "rubber", verts=8))
    return finish(P, "broom_wide")

def b_vacuum_industrial():
    """Odkurzacz przemyslowy - beczka na kolkach z waskiem. Tryb beam, dalszy zasieg."""
    P = []
    P.append(cyl("drum", 0.33, 0.70, (0, 0, 0.48), "blue", verts=12))
    P.append(cyl("lid", 0.35, 0.14, (0, 0, 0.90), "steel", verts=12))
    P.append(cyl("motor", 0.24, 0.20, (0, 0, 1.05), "dark", verts=10))
    P.append(cyl("cap2", 0.13, 0.09, (0, 0, 1.19), "hazard", verts=8))
    for z in (0.28, 0.66):
        P.append(cyl("band", 0.35, 0.05, (0, 0, z), "hazard", verts=12))
    for sx in (-1, 1):                      # zatrzaski
        P.append(box("clip", (0.07, 0.05, 0.16), (sx*0.33, 0, 0.86), "steel_d"))
    P.append(cone("intake", 0.13, 0.06, 0.20, (0, -0.36, 0.62), "steel_d", verts=9,
                  rot=(math.radians(90), 0, 0)))
    for i in range(6):                      # waz zwiniety po boku
        a = math.radians(i*60)
        P.append(cyl("hose%d" % i, 0.05, 0.22, (math.sin(a)*0.36, 0.14 + math.cos(a)*0.10, 0.74),
                     "rubber", verts=6, rot=(math.radians(90), 0, -a)))
    P.append(box("handle", (0.09, 0.09, 0.30), (0, 0.34, 0.94), "dark", rot=(math.radians(20), 0, 0)))
    for i in range(3):                      # kolka
        a = math.radians(i*120 + 30)
        P.append(cyl("cast", 0.07, 0.05, (math.sin(a)*0.24, math.cos(a)*0.24, 0.07), "dark",
                     verts=7, rot=(0, math.radians(90), 0)))
    return finish(P, "vacuum_industrial", merge=0.001)

def b_leaf_blower():
    """Dmuchawa do liesci - dluga rura z silnikiem z tylu. Tryb sweep, waski stozek."""
    P = []
    P.append(cyl("tube", 0.09, 0.74, (0, -0.22, 0.42), "orange", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(cone("muzzle", 0.09, 0.055, 0.20, (0, -0.68, 0.42), "dark", verts=9,
                  rot=(math.radians(90), 0, 0)))
    P.append(cyl("ring", 0.10, 0.05, (0, -0.58, 0.42), "hazard", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(box("engine", (0.22, 0.30, 0.26), (0, 0.28, 0.44), "orange"))
    P.append(box("cover", (0.24, 0.18, 0.10), (0, 0.30, 0.60), "dark"))
    for i in range(4):                      # zebra chlodzenia
        P.append(box("fin%d" % i, (0.25, 0.03, 0.16), (0, 0.18 + i*0.06, 0.44), "steel_d"))
    P.append(cyl("fuel", 0.09, 0.16, (0, 0.42, 0.26), "white", verts=9))
    P.append(box("grip", (0.07, 0.10, 0.20), (0, 0.06, 0.62), "dark", rot=(math.radians(-14), 0, 0)))
    P.append(box("trig", (0.05, 0.09, 0.05), (0, -0.01, 0.54), "hazard"))
    # Plozy, NIE dwie osobne stopki. Pierwsza wersja stawiala dwa klocki na
    # z=0.07, podczas gdy rura ma os na 0.42 i spod na 0.33 - nic ich nie laczylo
    # z reszta i lezaly obok narzedzia jak upuszczone cegly. Szyna plus dwa
    # slupki domykaja bryle do podlogi.
    P.append(box("skid", (0.17, 0.66, 0.05), (0, 0.12, 0.025), "dark"))
    for yy in (-0.10, 0.34):
        P.append(box("strut", (0.07, 0.07, 0.30), (0, yy, 0.18), "steel_d"))
    return finish(P, "leaf_blower")

def b_pusher():
    """Spychacz - szeroki lemiesz na dragu. Tryb sweep, najszerszy luk."""
    P = []
    P.append(box("blade", (1.16, 0.07, 0.36), (0, -0.10, 0.22), "hazard"))
    P.append(box("edge", (1.20, 0.09, 0.06), (0, -0.11, 0.045), "steel_d"))
    P.append(box("top", (1.18, 0.10, 0.05), (0, -0.10, 0.42), "steel_d"))
    for i, x in enumerate((-0.40, 0.0, 0.40)):          # zebra usztywniajace
        P.append(box("rib%d" % i, (0.07, 0.20, 0.30), (x, -0.01, 0.24), "steel"))
    P.append(box("spine", (0.90, 0.07, 0.07), (0, 0.02, 0.34), "steel"))
    P.append(cyl("shaft", 0.045, 0.90, (0, 0.30, 0.62), "wood", verts=8, rot=(math.radians(-52), 0, 0)))
    P.append(box("tbar", (0.34, 0.08, 0.08), (0, 0.66, 0.98), "dark"))
    for sx in (-1, 1):
        P.append(box("stay", (0.05, 0.34, 0.05), (sx*0.26, 0.14, 0.38), "steel_d",
                     rot=(math.radians(-24), 0, 0)))
    return finish(P, "pusher")

def b_lasso():
    """Lasso - PIONOWA petla nad zwojem. Tryb beam, przyciaga pojedyncza kaczke.

    Poprzednia wersja byla plaskim plackiem: trzy zwoje sznura o promieniach
    0.21/0.19/0.17 ulozone jeden na drugim na wysokosci 0.24 m, wszystkie w tym
    samym kolorze wood_lt. Z rzutu z gory to jest lasso; z kamery gry, ktora
    patrzy pod katem, to kupka piachu z brazowym klockiem - i dokladnie tak sie
    renderowala. Cala informacja o ksztalcie lezala w widoku, ktorego gracz nie
    oglada.

    Petla stoi teraz PIONOWO. Kolo o srednicy 0.38 m sterczace na 0.5 m nad
    ziemia jest sylwetka, ktora czyta sie z kazdej strony i nie ginie przy
    zmniejszeniu - a zwoj u podstawy, w ciemniejszym odcieniu sznura, mowi
    reszte. Przy okazji taniej: 32 bryly zamiast 45."""
    P = []
    NC, NL = 10, 12
    for j, (R, z) in enumerate(((0.215, 0.035), (0.175, 0.085))):
        for i in range(NC):
            a = math.radians(i*360.0/NC + j*14)
            P.append(box("c%d%d" % (j, i), (2*math.pi*R/NC*1.5, 0.05, 0.05),
                         (math.sin(a)*R, math.cos(a)*R, z), "wood", rot=(0, 0, -a)))
    # Petla w plaszczyznie XZ. Jasniejszy sznur niz zwoj - dwa tony jednej liny
    # rozdzielaja te dwie bryly bez wprowadzania obcego koloru do palety.
    ring_xz("loop", 0.19, NL, 2*math.pi*0.19/NL*1.55, 0.05, 0.05, 0.33, "wood_lt", P)
    P.append(box("knot", (0.09, 0.09, 0.09), (0, 0, 0.135), "rust"))
    P.append(box("grip", (0.055, 0.055, 0.13), (0, 0, 0.175), "rust"))
    return finish(P, "lasso", merge=0.001)

def b_fire_hose():
    """Waz strazacki - zwoj z pradownica. Tryb sweep, najwieksza sila."""
    P = []
    N = 14
    for j, (R, z, col) in enumerate(((0.30, 0.09, "red"), (0.30, 0.22, "red"), (0.22, 0.35, "red"))):
        for i in range(N):
            a = math.radians(i*360.0/N + j*8)
            P.append(box("c%d%d" % (j, i), (2*math.pi*R/N*1.5, 0.11, 0.12),
                         (math.sin(a)*R, math.cos(a)*R, z), col, rot=(0, 0, -a)))
    P.append(cyl("nozzle", 0.06, 0.30, (0.06, -0.34, 0.44), "hazard", verts=9,
                 rot=(math.radians(74), 0, 0)))
    P.append(cone("tip", 0.06, 0.028, 0.14, (0.06, -0.44, 0.52), "steel_d", verts=9,
                  rot=(math.radians(74), 0, 0)))
    P.append(cyl("collar", 0.075, 0.05, (0.06, -0.28, 0.40), "steel", verts=9,
                 rot=(math.radians(74), 0, 0)))
    P.append(box("lever", (0.05, 0.16, 0.04), (0.13, -0.24, 0.44), "dark", rot=(math.radians(20), 0, 0)))
    P.append(cyl("plate", 0.34, 0.03, (0, 0, 0.015), "steel_d", verts=N))
    return finish(P, "fire_hose", merge=0.001)

def b_fan_handheld():
    """Wentylator reczny - najmniejszy z rodziny dmuchajacych. Krotki zasieg."""
    P = []
    P.append(cyl("hub", 0.07, 0.06, (0, 0, 0.60), "orange", verts=9, rot=(math.radians(90), 0, 0)))
    ring_xz("ring", 0.20, 12, 0.12, 0.05, 0.05, 0.60, "steel", P)
    for i in range(4):
        a = math.radians(i*90 + 30)
        P.append(box("blade%d" % i, (0.08, 0.03, 0.16), (math.sin(a)*0.10, 0, 0.60 + math.cos(a)*0.10),
                     "hazard", rot=(math.radians(22), a, 0)))
    P.append(box("neck", (0.09, 0.07, 0.14), (0, 0.02, 0.44), "dark"))
    P.append(box("grip", (0.10, 0.09, 0.34), (0, 0.02, 0.22), "teal"))
    P.append(box("switch", (0.05, 0.03, 0.06), (0, -0.03, 0.26), "hazard"))
    P.append(box("foot", (0.16, 0.20, 0.05), (0, 0.02, 0.025), "dark"))
    return finish(P, "fan_handheld")

def b_plank():
    """Deska - dwa metry sosny. Rzucona w poprzek robi mostek albo bandke."""
    P = []
    P.append(box("board", (0.22, 1.94, 0.05), (0, 0, 0.06), "wood_lt"))
    for i in range(4):                      # sloje
        P.append(box("grain%d" % i, (0.015, 1.86, 0.008), (-0.075 + i*0.05, 0, 0.087), "wood"))
    for sy in (-1, 1):                      # okucia na koncach
        P.append(box("band", (0.24, 0.07, 0.07), (0, sy*0.90, 0.06), "steel_d"))
        P.append(box("nail", (0.03, 0.03, 0.02), (0, sy*0.90, 0.10), "hazard"))
    P.append(box("batten", (0.20, 0.16, 0.04), (0, 0, 0.015), "wood"))
    P.append(box("knot", (0.05, 0.09, 0.012), (0.04, 0.36, 0.088), "wood"))
    return finish(P, "plank")

def b_horn():
    """Trabka - stozek na uchwycie. Zwoluje kaczki, nie popycha ich."""
    P = []
    # Obrot MINUS 90, nie plus. cone() klade waski koniec (r2) na lokalnym +Z,
    # a R_x(+90) odwzorowuje +Z na -Y - czyli czara wypadala z TYLU, przy graczu,
    # a z przodu sterczal wlot. Przy -90 waski koniec idzie na +Y, gdzie siedzi
    # ustnik, i czara otwiera sie do przodu, gdzie obreecz ma po co byc.
    P.append(cone("bell", 0.20, 0.06, 0.44, (0, -0.10, 0.46), "hazard", verts=10,
                  rot=(math.radians(-90), 0, 0)))
    ring_xz("rim", 0.20, 10, 0.14, 0.05, 0.05, 0.46, "duck", P)
    for o in P[-10:]: o.location.y = -0.32
    P.append(cyl("throat", 0.055, 0.20, (0, 0.20, 0.46), "steel", verts=9, rot=(math.radians(90), 0, 0)))
    P.append(cyl("mouth", 0.075, 0.06, (0, 0.32, 0.46), "dark", verts=9, rot=(math.radians(90), 0, 0)))
    # Uchwyt musi DOSIEGAC czary. Przy y=0.10 stozek ma juz tylko 0.066 promienia,
    # wiec jego spod jest na z=0.394 - a poprzedni uchwyt konczyl sie na 0.325 i
    # wisial 7 cm pod trabka jak osobny hantel.
    P.append(box("grip", (0.08, 0.16, 0.20), (0, 0.10, 0.32), "rubber"))
    P.append(cyl("stem", 0.035, 0.18, (0, 0.10, 0.14), "steel_d", verts=8))
    P.append(box("foot", (0.16, 0.22, 0.05), (0, 0.08, 0.025), "dark"))
    return finish(P, "horn")

def b_rake():
    """Grabie - ciagna kaczki DO SIEBIE. tool.pull, czyli odwrocony znak sily."""
    P = []
    P.append(cyl("shaft", 0.035, 1.40, (0, 0, 0.80), "wood", verts=8))
    P.append(box("head", (0.64, 0.09, 0.07), (0, 0, 0.135), "steel_d"))
    for i in range(9):                      # zeby ZAGIETE do gracza (+Y)
        x = -0.28 + i*0.07
        P.append(box("tine%d" % i, (0.022, 0.07, 0.16), (x, 0.03, 0.075), "steel",
                     rot=(math.radians(-34), 0, 0)))
    P.append(box("brace", (0.44, 0.05, 0.05), (0, -0.02, 0.24), "steel_d"))
    for sx in (-1, 1):
        P.append(box("stay", (0.04, 0.05, 0.22), (sx*0.20, 0.0, 0.20), "steel_d",
                     rot=(0, math.radians(sx*22), 0)))
    P.append(cyl("grip", 0.045, 0.18, (0, 0, 1.44), "rubber", verts=8))
    return finish(P, "rake")

def b_magnet():
    """Reeczny magnes - podkowa na uchwycie. tool.pull, ten sam mechanizm co grabie."""
    P = []
    N = 9
    R, TH = 0.17, 0.09
    for i in range(N):                      # luk podkowy: od -80 do +80 stopni
        a = math.radians(-80 + i*160.0/(N - 1))
        P.append(box("arc%d" % i, (2*math.pi*R/N*1.4, TH, TH),
                     (math.sin(a)*R, 0, 0.62 + math.cos(a)*R), "red", rot=(0, a, 0)))
    for sx in (-1, 1):                      # bieguny - jasne koncowki
        a = math.radians(sx*80)
        P.append(box("pole", (0.11, TH + 0.01, 0.13), (math.sin(a)*R, 0, 0.62 + math.cos(a)*R - 0.06),
                     "white"))
    P.append(box("neck", (0.10, 0.09, 0.16), (0, 0, 0.36), "steel_d"))
    P.append(box("grip", (0.11, 0.10, 0.26), (0, 0, 0.18), "dark"))
    P.append(box("band", (0.12, 0.11, 0.04), (0, 0, 0.30), "hazard"))
    P.append(box("foot", (0.20, 0.18, 0.04), (0, 0, 0.02), "dark"))
    return finish(P, "magnet")

def b_dustpan():
    """Szufelka - otwarta z jednej strony. Czeka na nowy tryb w KINDS.tool.modes.

    Swiatlo wlotu 0.40 x 0.22: kaczka (0.178 x 0.146 w rzucie) wjezdza swobodnie,
    inaczej narzedzie do zgarniania kaczek nie zgarnia kaczek."""
    P = []
    P.append(box("floor", (0.44, 0.42, 0.03), (0, 0.04, 0.055), "hazard",
                 rot=(math.radians(-9), 0, 0)))
    P.append(box("lip", (0.46, 0.10, 0.012), (0, -0.21, 0.014), "steel_d",
                 rot=(math.radians(-9), 0, 0)))
    for sx in (-1, 1):
        P.append(box("side", (0.03, 0.42, 0.17), (sx*0.215, 0.04, 0.135), "hazard"))
    P.append(box("back", (0.44, 0.03, 0.22), (0, 0.245, 0.16), "hazard"))
    P.append(box("hood", (0.46, 0.12, 0.03), (0, 0.21, 0.28), "steel_d"))
    P.append(cyl("stem", 0.035, 0.34, (0, 0.30, 0.40), "steel_d", verts=8, rot=(math.radians(-18), 0, 0)))
    P.append(box("grip", (0.07, 0.09, 0.18), (0, 0.38, 0.62), "rubber", rot=(math.radians(-18), 0, 0)))
    P.append(box("hang", (0.05, 0.05, 0.05), (0, 0.40, 0.72), "dark"))
    return finish(P, "dustpan")


# ===================================================== SKRZYNKA HAZARDOWA
# Dwa modele, jeden obiekt w grze. Powod jest w FOOTPRINT wyzej: finish() scala
# wszystko w JEDNA siatke, wiec wieko, ktore ma sie osobno obracac, nie moze
# byc czescia korpusu.
#
# Korpus jest zbudowany pod ZMIANE ODCIENIA, nie pod detal: jedna duza plaska
# bryla w kolorze bazowym zajmuje wiekszosc sylwetki, a wszystko, co ma zostac
# neutralne przy przebarwianiu (slupki, cokol, obrecz), jest ciemne albo stalowe.
# Gdyby korpus byl posiekany na dwadziescia malych kawalkow, przesuniety odcien
# dalby papke zamiast blysku.

def b_gamble_box():
    """Skrzynka hazardowa - KORPUS. Wieko jest osobnym modelem."""
    P = []
    P.append(box("plinth", (0.74, 0.74, 0.09), (0, 0, 0.045), "dark"))
    P.append(box("core", (0.66, 0.66, 0.46), (0, 0, 0.31), "teal"))       # pole odcienia
    for sx in (-1, 1):                       # slupki narozne wyznaczaja obrys 0.75
        for sy in (-1, 1):
            P.append(box("post", (0.10, 0.10, 0.50), (sx*0.325, sy*0.325, 0.30), "dark"))
    # OBRECZ - miejsce styku z wiekiem. Ma byc widoczna z daleka, bo to ona mowi
    # "to sie otwiera"; stad jasna stal na ciemnym korpusie, nie kolejny teal.
    P.append(box("rim", (0.75, 0.75, 0.07), (0, 0, 0.575), "steel"))
    P.append(box("rimlip", (0.69, 0.69, 0.03), (0, 0, 0.625), "hazard"))
    P.append(box("badge", (0.26, 0.04, 0.26), (0, -0.335, 0.34), "hazard"))
    P.append(box("slot", (0.16, 0.04, 0.04), (0, -0.345, 0.50), "black"))
    for sx in (-1, 1):                       # pasy czytelne z boku
        P.append(box("stripe", (0.04, 0.60, 0.05), (sx*0.335, 0, 0.20), "hazard"))
    return finish(P, "gamble_box")


def b_gamble_box_lid():
    """Skrzynka hazardowa - WIEKO. Spod na z=0, zawias na tylnej dolnej krawedzi."""
    P = []
    P.append(box("slab", (0.75, 0.75, 0.09), (0, 0, 0.045), "hazard"))
    P.append(box("crown", (0.56, 0.56, 0.07), (0, 0, 0.125), "orange"))
    P.append(box("knob", (0.16, 0.16, 0.05), (0, 0, 0.185), "white"))
    P.append(box("hinge", (0.62, 0.06, 0.05), (0, 0.345, 0.025), "dark"))
    P.append(box("latch", (0.14, 0.05, 0.10), (0, -0.355, 0.05), "steel"))
    return finish(P, "gamble_box_lid")


# ======================================================== AUTOMAT NA KOLO
# crank_bot montuje sie NA KOLE warsztatu i kreci nim zamiast gracza.
#
# UKLAD WSPOLRZEDNYCH - to jest kontrakt dla kodu doczepiajacego:
#   * origin (0,0,0) = PIASTA KOLA, czyli machine.wheelLocal* = (0.4685, 0.78,
#     -0.225) w ukladzie modelu crank. Zaden offset do policzenia.
#   * +X = OS OBROTU kola, dokladnie ta sama, wokol ktorej main.js kreci kolem,
#     i zwrocona NA ZEWNATRZ, od szafy w strone gracza. Obejma siedzi w
#     x 0.02..0.11, silnik w 0.11..0.30 - czyli caly bot jest po zewnetrznej
#     stronie plaszczyzny kola i niczego w niej nie zaslania.
#   * Ramie wychodzi wzdluz +Y (w gore w ukladzie gry) na promien 0.245, czyli
#     doklanie na promien korby. Zeby wskazac korbe w jej pozycji spoczynkowej
#     (45 stopni), obroc bota o -45 stopni wokol X; jesli bot ma sie krecic
#     razem z kolem, po prostu wsadz go do tej samej puli co kolo i nie obracaj
#     wcale - dlatego ramie celuje w os, a nie w zapieczony kat 45 stopni.
#
# Skala: obejma ma promien 0.115 przy kole o promieniu 0.34, a ramie siega 0.245
# z 0.34 - bot zajmuje mniej wiecej jedna trzecia tarczy i zostawia obrecz,
# szprychy i luk korby widoczne.

def b_crank_bot():
    """Automat nakrecajacy - obejma na piascie, silnik, ramie do korby."""
    P = []
    # obejma na piascie: pierscien w plaszczyznie YZ, czyli w plaszczyznie kola.
    # sep=0.006, a nie 0.003 jak w crank: przy 0.003 rozjezdzaja sie owszem
    # sciany, ale SCIECIA bevela (0.012) sasiada laduja 1.2 mm od sciany obok.
    # 0.006 wypycha i je poza prog. Bot jedzie na kole, wiec obraca sie razem
    # z nim tuz przed oczami gracza - tu nie ma marginesu na "prawie".
    ring_yz("collar", 0.115, 8, 0.13, 2*math.pi*0.115/8*1.5, 0.055, 0.045, 0.0,
            "steel_d", P, sep=0.006)
    for sy in (-1, 1):                       # sruby obejmy - widac, ze SIE ZACISKA
        P.append(box("bolt", (0.13, 0.05, 0.05), (0.045, sy*0.150, 0), "orange"))
    # silnik - lezy na osi, wystaje na zewnatrz. To on mowi "to robi maszyna".
    P.append(cyl("motor", 0.105, 0.17, (0.195, 0, 0), "teal", verts=10,
                 rot=(0, math.radians(90), 0)))
    P.append(cyl("motorcap", 0.075, 0.05, (0.295, 0, 0), "dark", verts=10,
                 rot=(0, math.radians(90), 0)))
    for i in range(3):                       # zebra chlodzace
        P.append(box("fin%d" % i, (0.02, 0.22, 0.22), (0.145 + i*0.05, 0, 0), "teal_lt"))
    # 0.258, nie 0.255: przy 0.255 tylna sciana diody lezala dokladnie w tylnej
    # scianie ostatniego zebra (0.235) - dwie plaszczyzny, dwa rozne kolory.
    P.append(box("led", (0.04, 0.05, 0.05), (0.258, 0, 0.10), "hazard"))
    # ramie do korby: wzdluz +Y na promien korby, zakonczone widelcem
    P.append(box("arm", (0.055, 0.075, 0.20), (0.105, 0, 0.145), "steel"))
    P.append(box("wrist", (0.075, 0.10, 0.07), (0.105, 0, 0.245), "steel_d"))
    for sz in (-1, 1):                       # widelec obejmujacy raczke korby
        P.append(box("fork", (0.09, 0.035, 0.06), (0.145, sz*0.055, 0.255), "hazard"))
    return finish(P, "crank_bot", bevel=0.012, merge=0.0008, origin="raw")


BUILDERS += [
    ("crank_bot", b_crank_bot, "Maszyny", "Automat nakrecajacy kolo warsztatu."),
    ("gamble_box", b_gamble_box, "Maszyny", "Skrzynka hazardowa - korpus."),
    ("gamble_box_lid", b_gamble_box_lid, "Maszyny", "Skrzynka hazardowa - wieko."),
    ("sack", b_sack, "Przedmioty", "Worek."),
    ("crate_wood", b_crate_wood, "Przedmioty", "Skrzynia drewniana - leakPerSecond."),
    ("bucket_leaky", b_bucket_leaky, "Przedmioty", "Kubel dziurawy - leakPerSecond."),
    ("dumper", b_dumper, "Przedmioty", "Wywrotka."),
    ("pallet_jack", b_pallet_jack, "Przedmioty", "Wozek paletowy."),
    ("broom_wide", b_broom_wide, "Przedmioty", "Miotla szeroka."),
    ("vacuum_industrial", b_vacuum_industrial, "Przedmioty", "Odkurzacz przemyslowy."),
    ("leaf_blower", b_leaf_blower, "Przedmioty", "Dmuchawa do liesci."),
    ("pusher", b_pusher, "Przedmioty", "Spychacz."),
    ("lasso", b_lasso, "Przedmioty", "Lasso."),
    ("fire_hose", b_fire_hose, "Przedmioty", "Waz strazacki."),
    ("fan_handheld", b_fan_handheld, "Przedmioty", "Wentylator reczny."),
    ("plank", b_plank, "Przedmioty", "Deska 2 m."),
    ("horn", b_horn, "Przedmioty", "Trabka."),
    ("rake", b_rake, "Przedmioty", "Grabie - tool.pull."),
    ("magnet", b_magnet, "Przedmioty", "Reeczny magnes - tool.pull."),
    ("dustpan", b_dustpan, "Przedmioty", "Szufelka - nowy tryb."),
    ("wall_glass", b_wall_glass, "Budowle", "Sciana szklana 2 m."),
    ("wall_soft", b_wall_soft, "Budowle", "Miekka sciana - collider.restitution."),
    ("fence_mesh", b_fence_mesh, "Budowle", "Plot siatkowy - przepuszcza nadmuch."),
    ("neon_ducks", b_neon_ducks, "Budowle", "Neon DUCKS - dekoracja."),
    ("slide", b_slide, "Budowle", "Zjezdzalnia prosta, 3 m."),
    ("fan_strong", b_fan_strong, "Budowle", "Wiatrak mocny."),
    ("fan_vertical", b_fan_vertical, "Budowle", "Wiatrak pionowy - blow.pitchDegrees."),
    ("vibe_floor", b_vibe_floor, "Budowle", "Wibrator podlogowy - plaski tasmociag."),
    ("platform", b_platform, "Budowle", "Podest 2x2 m."),
    ("stairs", b_stairs, "Budowle", "Schody na podest."),
    ("roof", b_roof, "Budowle", "Dach 2x2 m na slupach."),
    ("ice_slide", b_ice_slide, "Budowle", "Slizg lodowy - collider.friction."),
    ("pit_kerb", b_pit_kerb, "Budowle", "Krawezniek pitu - prosty odcinek."),
    ("lamp_post", b_lamp_post, "Budowle", "Lampa - niski slupek."),
    ("sign_dir", b_sign_dir, "Budowle", "Znak kierunkowy."),
    ("bumper", b_bumper, "Budowle", "Odbijacz - collider.restitution."),
    ("trampoline", b_trampoline, "Budowle", "Trampolina - wyrzuca w gore."),
    ("hive", b_hive, "Maszyny", "Kaczkowy ul - 3 kaczki na cykl."),
    ("incubator_double", b_incubator_double, "Maszyny", "Podwojna wylegarnia - 2 kaczki."),
    ("press_belt", b_press_belt, "Maszyny", "Prasa tasmowa - 5 kaczek."),
    ("feeder_vibe", b_feeder_vibe, "Maszyny", "Wibracyjny podajnik - 5 kaczek."),
    ("slot_machine", b_slot_machine, "Maszyny", "Automat losowy - 1-10 kaczek."),
    ("factory", b_factory, "Maszyny", "Kaczkowa fabryka - 10 kaczek."),
    ("geyser", b_geyser, "Maszyny", "Kaczkowy gejzer - 30 kaczek."),
    ("pipe_endless", b_pipe_endless, "Maszyny", "Nieskonczona rura - ciagly strumien."),
    ("machine_slow", b_machine_slow, "Maszyny", "Wolny automat - 60 s, kolo zamachowe."),
    ("condenser", b_condenser, "Maszyny", "Zbiornik kondensacyjny - 90 s."),
    ("duckomat", b_duckomat, "Maszyny", "Kaczkomat - automat vendingowy, 30 s."),
    ("hatchery", b_hatchery, "Maszyny", "Kaczkowa wylegarnia - 20 s."),
    ("printer3d", b_printer3d, "Maszyny", "Kaczkowa drukarka 3D - 180 s, bez tieru 0."),
    ("press_gold", b_press_gold, "Maszyny", "Zlota prasa - 40 s, bez tieru 0."),
    ("reactor", b_reactor, "Maszyny", "Reaktor rzadkosciowy - tylko najwyzsze tiery."),
]


def build_all(only=None):
    rep = []
    for name, fn, grp, desc in BUILDERS:
        if only and name not in only: continue
        clear()
        o, tris = fn()
        p, size = export(o, name)
        d = o.dimensions
        row = {"name": name, "group": grp, "desc": desc, "tris": tris,
               "kb": max(1, size // 1024), "dim": [round(d.x, 2), round(d.y, 2), round(d.z, 2)]}
        if name in CAVITY_OUT: row["interior"] = CAVITY_OUT[name]
        rep.append(row)
    return rep
