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


# THE PALETTE, AND WHAT EACH PART OF IT IS FOR.
#
# Twenty-one entries that behaved like about twelve. Measured as CIE76 dE on the
# gamma-encoded colour -- which is what the eye gets, not the linear numbers
# below -- the closest pairs were:
#
#     dE 2.7  hazard / duck       <-- the important one
#     dE 3.6  dark / rubber
#     dE 3.8  steel / concrete
#     dE 4.7  black / rubber
#
# hazard/duck at 2.7 was the failure that mattered, and not because two swatches
# looked alike. `hazard` was on 71 of the 84 models and `duck` on 6. So the
# colour that means "a duck, i.e. the entire economy of this game" was also the
# trim on very nearly every object in the world. An accent worn by everything is
# not an accent, and that -- not the vendor's teal shed -- is why world colour
# guided nothing. The shed was merely the loudest symptom.
#
# So the palette now has FIVE JOBS, and every colour belongs to one:
#
#   duck / beak        THE PRODUCT AND THE OBJECTIVE. Ducks, the golden press's
#                      output, the workbench lamps, the paint round the pit.
#                      Reserved. Nothing else in the world may be this gold.
#   hazard / orange    POWERED MACHINERY. Anything that moves, produces, blows
#                      or presses. Moved off gold and onto a safety orange, so
#                      it now reads as paint on a machine rather than as money.
#   white              WALKABLE STRUCTURE. Stair nosings, bridge rails, the
#                      edges you are meant to stand on. Previously these wore
#                      the same hazard yellow as the machines, so the two
#                      classes of object were indistinguishable at play
#                      distance -- which is exactly the conveyor/stairs and
#                      bridge/slide confusion.
#   teal / teal_lt     COMMERCE. The vendor's booth. Desaturated hard: it was
#                      the most saturated thing in the game and it is not the
#                      objective, so it now says "shop" up close without
#                      winning the frame from 30 m.
#   steel / steel_d / concrete / dark / rubber / black / wood / wood_lt / glass /
#   rust / red / blue / denim / skin
#                      NEUTRAL AND MATERIAL. Deliberately kept low-chroma. If
#                      the greys drift towards a hue, the accents stop meaning
#                      anything.
#
# Four of these are LIGHT/DARK PAIRS OF ONE MATERIAL, not two identities, and
# they are meant to be close -- steel/steel_d appear together on 39 models,
# wood/wood_lt on 8, teal/teal_lt on 8, denim/blue on the same trousers. Pulling
# those apart would not fix a confusion, it would destroy every model's internal
# shading. They are exempt from the separation target on purpose.
#
# Everything else is now at least dE 6.7 apart, up from 2.7, and the count of
# confusable non-pair combinations under dE 8 is 4, down from 6 -- with the two
# worst (hazard/duck, dark/rubber) gone entirely. `skin` is used by zero models
# and is left alone because an unused colour cannot confuse anything.
PAL = {
    # --- reserved: the product and the objective ----------------------------
    "duck":    (0.98, 0.80, 0.10), "beak":    (0.97, 0.34, 0.02),
    # --- powered machinery --------------------------------------------------
    "hazard":  (0.88, 0.47, 0.02), "orange":  (0.72, 0.22, 0.03),
    "red":     (0.66, 0.08, 0.13),
    # --- commerce -----------------------------------------------------------
    "teal":    (0.10, 0.28, 0.30), "teal_lt": (0.18, 0.45, 0.47),
    # --- metal, stone, and the walkable white -------------------------------
    "steel":   (0.40, 0.44, 0.54), "steel_d": (0.235, 0.275, 0.385),
    "concrete":(0.62, 0.60, 0.55), "white":   (0.91, 0.91, 0.93),
    "rust":    (0.40, 0.185, 0.07),
    # --- the three darks, now three actual values rather than one -----------
    # dark is a structural mid-dark, rubber a warm near-black for hose and
    # tyre, black an absolute. They used to sit within dE 4.7 of each other,
    # and black/rubber appeared together on ZERO models -- two names for one
    # colour. Now dE 11 apart, so a hose reads as a hose against a frame.
    "dark":    (0.225, 0.220, 0.225), "rubber":  (0.115, 0.105, 0.085),
    "black":   (0.030, 0.030, 0.038), "glass":   (0.045, 0.115, 0.155),
    # --- organic and cloth ---------------------------------------------------
    "wood":    (0.48, 0.29, 0.13), "wood_lt": (0.74, 0.54, 0.30),
    "skin":    (0.86, 0.66, 0.50),
    "denim":   (0.17, 0.24, 0.44), "blue":    (0.10, 0.36, 0.74),
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

def ring_xz(prefix, R, seg, seclen, secd, sech, z, color, out, sep=0.0):
    """Pierscien w plaszczyznie XZ. Obrot wokol Y o +a odwzorowuje os X na styczna.

    sep > 0: co drugi segment jest o 2*sep chudszy w Y. Segmenty MUSZA na siebie
    zachodzic (seclen > obwod/seg), zeby pierscien byl ciagly, a obrot wokol Y
    nie zmienia orientacji ich scian +-Y: bez sep wszystkie leza w dwoch
    wspolnych plaszczyznach i kazda para sasiadow to remis w buforze glebi.
    To jest ten sam idiom, ktory ring_yz juz naprawia -- ring_xz i ring_xy nie
    naprawialy go wcale, i stad 64 pary w fan.glb i 792 w tube.glb.
    Sprawdzane przez tools/check-coplanar.py."""
    for i in range(seg):
        a = math.radians(i * 360.0 / seg)
        d = secd - (2*sep if (sep > 0 and i % 2) else 0.0)
        out.append(box("%s%d" % (prefix, i), (seclen, d, sech),
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


def ring_xy(prefix, R, seg, seclen, secw, sech, z, color, out, sep=0.0):
    """Pierscien lezacy plasko w XY.

    sep > 0: co drugi segment jest o 2*sep nizszy. Patrz ring_xz -- tutaj
    wspolne plaszczyzny to GORA i DOL (obrot wokol Z ich nie rusza), wiec to
    wysokosc musi sie zmieniac, nie glebokosc."""
    for i in range(seg):
        a = math.radians(i * 360.0 / seg)
        h = sech - (2*sep if (sep > 0 and i % 2) else 0.0)
        out.append(box("%s%d" % (prefix, i), (seclen, secw, h),
                       (math.sin(a)*R, math.cos(a)*R, z), color, rot=(0, 0, -a)))


# --- THE OUTLET IS DERIVED FROM THE SIMULATION, NOT DRAWN WHERE IT LOOKS NICE -
# src/sim/producers.js mouthOf() spawns every `producer_auto` duck at
#
#     local z = footprint.z * config.producers.mouthDepthFrac + mouthClear
#     local y = footprint.y * config.producers.mouthHeightFrac
#
# with mouthDepthFrac 0.5, mouthClear 0.28 and mouthHeightFrac 0.45. There is no
# per-machine offset table and there is not going to be one: a row gets its mouth
# from its footprint alone. So the GEOMETRY has to meet the simulation, and this
# is the single place in this file that knows those three numbers.
#
# Before this helper existed, not one of the seventeen auto-producers had an
# opening where its ducks actually came from. The Duckomat spawned 46 cm above
# its own delivery bin, the Duck Assembler 39 cm above its hatch, the Gold Press
# 38 cm, and `press` and `press_belt` had no outlet geometry at all -- a duck
# simply appeared in mid-air beside a machine that showed no way out. That is the
# same defect as the container's decorative side door, and it was in seventeen
# places at once.
#
# The contract this helper keeps:
#   * the aperture's CENTRE sits at z = MOUTH_HEIGHT_FRAC * H, so the duck leaves
#     through the middle of the hole rather than clipping its lintel;
#   * the SILL is the model's frontmost geometry, at y = -D/2 exactly, so after
#     finish()'s grid snap the lip tip lands on the footprint's front face and
#     the duck appears 0.28 m clear of it, in the open, where a player can see
#     the machine hand it over;
#   * the throat is recessed 30 mm behind the jamb, so the opening reads as a
#     HOLE -- negative space, which is the only kind of detail that survives at
#     22 px per metre -- instead of as a dark decal painted on a flat face.
MOUTH_DEPTH_FRAC = 0.5      # config.producers.mouthDepthFrac
MOUTH_CLEAR = 0.28          # config.producers.mouthClear  (metres past the face)
MOUTH_HEIGHT_FRAC = 0.45    # config.producers.mouthHeightFrac


def mouth_z(H):
    """Height of the spawn point above the floor, for a model H metres tall."""
    return MOUTH_HEIGHT_FRAC * H


def chute(out, H, D, w=0.36, h=0.30, x=0.0, tag="", throat="black",
          frame="hazard", jamb="steel_d", deep=0.26, sill=True, yf=None):
    """A duck-sized opening at the point the simulation spawns from.

    H, D  -- the row's exported height and depth (footprint[1], footprint[2]).
    w, h  -- the clear aperture. A duck is 0.178 x 0.386 x 0.146, so 0.36 x 0.30
             is a hole it visibly fits through rather than a slot it would have
             to be folded into; at 22 px/m that is 8 x 7 px of black, which is
             about as small as an opening can be and still read.
    x     -- lateral offset, for machines with more than one face. The DEFAULT is
             0 and it should stay 0 for anything the sim spawns from, because
             mouthOf() has no lateral term: `incubator_double` used to wear two
             outlets at x = +/-0.34 and spawn on the centreline between them.

    Returns (zc, yf): the aperture centre height and the front-face plane.
    """
    zc = mouth_z(H)
    # yf defaults to the footprint's own front plane, which is right whenever
    # the builder authored its raw depth AS D. Two builders cannot: the geyser's
    # raw extent is set by its boulder ring and the factory's by its discharge
    # belt, and finish() scales the whole mesh to land the FRONTMOST vertex on
    # the face. Those two pass yf explicitly, past their own widest part, so the
    # sill is what the snap puts on the front plane.
    if yf is None:
        yf = -D / 2.0
    t = 0.055
    # EVERY PIECE BELOW IS DELIBERATELY OUT OF PLANE WITH EVERY OTHER, and the
    # offsets are not decoration. Four boxes framing a hole is the single easiest
    # way to write a coplanar-overlap cluster by accident: the jamb's inner face
    # wants to sit exactly on the throat's side, the lintel's underside exactly
    # on the throat's top, and the sill's face exactly on the jamb's. That is
    # four depth-buffer ties per outlet and seventeen outlets, and it is the
    # idiom tools/check-coplanar.py exists to catch. So the frame members OVERLAP
    # the throat by 7 mm instead of butting against it, and the three depths
    # (jamb 0.020..0.080, lintel 0.0275..0.0825, sill 0.000..0.100) are three
    # different pairs of planes.
    #
    # Recessed throat: its face is 30 mm behind the frame, so the hole has depth.
    out.append(box("mouth%s" % tag, (w, deep, h), (x, yf + deep/2 + 0.03, zc), throat))
    # Jamb: a frame AROUND the hole, which is what makes a dark rectangle read as
    # a doorway rather than as a smudge painted on a flat face.
    out.append(box("jambL%s" % tag, (t, 0.06, h + 2*t + 0.02),
                   (x - (w/2 + t/2 - 0.007), yf + 0.05, zc), jamb))
    out.append(box("jambR%s" % tag, (t, 0.06, h + 2*t + 0.02),
                   (x + (w/2 + t/2 - 0.007), yf + 0.05, zc), jamb))
    out.append(box("jambT%s" % tag, (w + 2*t - 0.030, 0.055, t),
                   (x, yf + 0.055, zc + h/2 + t/2 - 0.007), jamb))
    if sill:
        # THE FRONTMOST GEOMETRY IN THE MODEL, by construction: centre y minus
        # half depth = (yf + 0.05) - 0.05 = yf. Nothing else in a builder that
        # calls this may reach further forward, or the footprint snap will
        # squeeze the whole machine in depth to make room for it.
        out.append(box("sill%s" % tag, (w + 2*t + 0.02, 0.10, t),
                       (x, yf + 0.05, zc - h/2 - t/2 + 0.007), frame))
    return zc, yf


def alt(i, sep=0.0015, phases=2):
    """The ring_xy/ring_xz `sep` trick for rings that are HAND-ROLLED rather than
    built by those helpers -- the bucket's staves, the sack's barrel, the hose
    and lasso coils, the magnet's arc.

    Returns the amount to SUBTRACT from this segment on the one axis whose faces
    its neighbours share. Which axis that is depends on the spin: rotating about
    Z leaves the top and bottom caps parallel and at the same height, so a ring
    laid flat shares its CAPS; rotating about Y leaves the +-Y faces parallel, so
    a ring standing up shares its SIDES. The caller knows which it built, so the
    caller picks the axis -- exactly as ring_xy (height) and ring_xz (depth) do.

    SHRINK ONLY, never a radial push, and that is a contract and not a taste:
    finish() scales X and Y so the exported footprint hits FOOTPRINT exactly, and
    it puts cavity() through the SAME factor. Moving a segment outward changes the
    raw bounding box, which changes that factor, which silently rescales the
    interior half-extents that src/data/tools.js holds as literals. Shrinking on
    the third axis cannot touch the horizontal box at all, because the segments
    that were not shrunk still define both horizontal extremes -- and on the
    vertical axis they still define minZ and maxZ, so the height is safe too.

    2*sep = 3 mm, which at the game's 22 px per metre is 0.07 px -- below the
    point where a pixel could change. Costs no triangles: same box count, same
    vertex count, only different numbers in them.

    `phases` is how many segments have to differ before the pattern may repeat,
    and TWO IS NOT ALWAYS ENOUGH. A segment overlaps every neighbour its own
    length reaches, and these rings are authored 1.4x to 1.55x longer than their
    arc spacing so the ring has no slit in it -- at 1.4x a segment still overlaps
    i+2, so an odd/even alternation leaves every second pair tied exactly as it
    found them. That is measurable, not theoretical: the magnet went 118 -> 46
    with phases=2 and the 46 that survived were all i to i+2.

    PHASES MUST DIVIDE THE SEGMENT COUNT of a CLOSED ring, and that is the trap
    this helper is documented for. The ring wraps, so segment N-1 is a neighbour
    of segment 0; if phases does not divide N those two land on the same phase
    and tie. Raising the sack from 2 to 3 phases over its ten segments did not
    improve it, it took it from 5 pairs to 43 -- worse than either neighbour
    count alone, because the seam pair is the widest overlap in the ring. Use a
    divisor of N (10 -> 5, 14 -> 7, 16 -> 4). An OPEN arc such as the magnet's
    horseshoe has no seam, so any value works there.

    And then MEASURE, because more phases is not monotonically better. A bigger
    phase count means a bigger maximum shrink, and the deepest-shrunk segment can
    fall into line with something that is not part of the ring at all -- the
    bucket's floor disc and hoops, the sack's tie. Over this set the best value
    was 2 for the bucket (36 pairs; 4 gave 52) and 2 for the sack (5 pairs; 3
    gave 43 and 5 gave 36), but 5 for the lasso (8 pairs) and 7 for the hose
    (0 pairs). tools/check-coplanar.py is the oracle -- pick by running it."""
    return sep * 2 * (i % phases)

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
    """Manual Duck Workbench. The single most-looked-at model in the game:
    cranking is a HELD charge, so a player stares at this object for seconds at a
    time, every duck, from two metres away.

    Jurek's verdict on the last one was "too toy-like", and the independent
    critic traced it to six things. Five were surface. The sixth was the whole
    problem, and it is fixed here:

    *** THE WHEEL WAS ON THE WRONG FACE. ***

    It lived on the cabinet's local +X side, turning about the local X axis --
    i.e. EDGE-ON to anybody standing in front of the machine, which is the only
    place you can stand to crank it. At 0 degrees and at 25 degrees, the two
    angles a player actually cranks from, all that showed of it was a sliver of
    grip past the right-hand corner; the big gold ring dominating the front view
    was the EJECTOR PIPE. The machine's one interactive part was invisible from
    its one interactive position, and the part that looked interactive was a
    spout. No amount of paint fixes that.

    The wheel now stands on the FRONT of the machine, in the local XZ plane,
    turning about the model's local Z axis, offset to the right so a third of it
    overhangs the cabinet and reads against the sky. Its hub is at model-local
    (0.2872, 1.0200, 0.2750) and the crank handle sweeps an arc TOWARDS the
    player. This is a renderer change as well as a model change and it is not
    optional -- see the notes at the end of this docstring.

    The other five, each with the fix:
      * a 0.62 x 0.46 glass panel that read as a SCREEN -- gone; the instruments
        are now a 0.22 x 0.14 recessed cluster, which at this scale is 3 px of
        detail instead of 22 px of black rectangle;
      * a 3.2 cm world-scale bevel on every edge (0.020 model x 1.6 scale), which
        is what rounds a machine into a toy -- down to 0.008, i.e. 1.3 cm;
      * near-cube proportions -- the mass is now three courses of different width
        with a hood that oversails, so the outline steps three times;
      * no frame member reaching the floor -- the left-hand column runs from
        z = 0 to 1.30, and the cabinet is lifted onto four legs with 0.20 m of
        daylight under it (0.32 m at world scale, ~7 px at 10 m);
      * one uniform grey -- three values now (black skirt, dark frame, steel_d
        skin) plus rust on the working panel, and yellow used ONLY on the wheel
        and the pipe lip, which are the two things that mean something.

    WHAT IS UNCHANGED, and why:
      * THE PIPE. It is the only correct duck outlet in the game and its mouth is
        authored in config.machine.pipeLocal (-0.043, 0.42, 0.66). Its raw
        coordinates below are byte-for-byte what they were.
      * THE RAW BOUNDING BOX: x -0.5447..0.7677, y -0.89..0.44, z 0..1.41, giving
        1.3124 x 1.4100 x 1.3300 and, at config.machine.scale 1.6, the footprint
        [2.096, 2.256, 2.128] that src/data/machines.js hard-codes. `crank` is not
        in the FOOTPRINT table, so finish() does NOT snap it: these numbers are
        hit by construction, and the extremes are load-bearing geometry (left
        column at -0.5447, wheel rim at 0.7677, pipe lip at -0.89, skirt at 0.44).
      * wheelRadius 0.34: the rim's OUTER radius is 0.369 and its centreline 0.34,
        so the aim sphere config.machine.wheelRadius still describes it.

    WHAT MUST CHANGE IN src/ FOR THIS MODEL TO BE RIGHT -- three small edits,
    reported rather than made because src/ is not this pass's to touch:
      1. config.machine.wheelLocalX/Y/Z: 0.4685, 0.78, -0.225  ->  0.2872, 1.0200,
         0.2750.
      2. The spin axis. src/render/props.js setWheelAngle() and
         src/render/placed.js setWheelAngle() both do `wheel.rotation.x = a`; the
         wheel now turns about local Z, so both become `wheel.rotation.z = -a`.
         (Negated so the handle still rises on the far side and a player's
         clockwise crank still reads as clockwise.)
      3. The split. config.machine.splitMinX / splitRadius drive a predicate in
         src/render/models.js that is hand-written coordinates, and the critic was
         right that a rework would break it silently -- it did: every triangle
         with x > 0.40 near the old hub is now cabinet. Two ways out, and the
         second is better:
           (a) keep the in-mesh split and change the predicate to
                   (x - 0.2872)^2 + (y - 1.0200)^2 < 0.42^2   AND   z > 0.19
               (distance in the local XY plane about the new hub, plus "in front
               of the cabinet skin", which sits at z = 0.175). Both clauses are
               needed: the pipe passes the z test and fails the distance test at
               0.737 from the hub; the cabinet fails the z test. Verified with
               tools/check-crank-split.py.
           (b) DROP THE PREDICATE. This builder also exports crank_wheel.glb --
               the same wheel, alone, with its origin AT the hub -- so the
               renderer can mount a second model at wheelLocal and rotate it,
               exactly the way gamble_box_lid is mounted on gamble_box. That
               removes a hand-tuned coordinate contract from the codebase
               permanently, and it is the reason crank.glb still CONTAINS the
               wheel: the footprint row is measured over the whole machine, so
               the asset may not lose it.
    """
    P = []
    SEP = 0.003            # see the 3 mm rule below
    # --- THE 3 MM RULE, unchanged in principle ------------------------------
    # No two parallel faces that overlap in projection may share a plane: that is
    # a depth-buffer tie, and this model turns in front of the player's face for
    # seconds at a time, so every tie is visible. 3 mm of model space is 4.8 mm
    # of world space, a sixth of the bevel, and an order of magnitude more than
    # the depth buffer needs. Checked by tools/check-coplanar.py.
    #
    # --- the cabinet ---------------------------------------------------------
    # Three courses of different width, lifted off the floor. The old cabinet was
    # 1.00 x 0.80 x 1.15 sitting on a skirt: one mass, one value, no gap.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("foot", (0.17, 0.17, 0.045), (sx*0.33, sy*0.28, 0.0225), "dark"))
            P.append(box("leg", (0.12, 0.12, 0.19), (sx*0.33, sy*0.28, 0.105), "black"))
    P.append(box("skirt", (1.00, 0.82, 0.13), (0, 0.03, 0.255), "black"))
    P.append(box("plinth", (0.94, 0.74, 0.08), (0, 0.02, 0.355), "dark"))
    P.append(box("body", (0.90, 0.70, 0.62), (0, 0.02, 0.70), "steel_d"))
    P.append(box("belt1", (0.96, 0.76, 0.05), (0, 0.02, 0.62), "dark"))
    P.append(box("upper", (0.84, 0.66, 0.30), (0, 0.02, 1.14), "steel_d"))
    P.append(box("belt2", (0.945, 0.735, 0.05), (0, 0.02, 1.00), "dark"))
    P.append(box("hood", (0.98, 0.82, 0.27), (0, 0.03, 1.275), "dark"))
    P.append(box("hoodlip", (0.92, 0.74, 0.04), (0, 0.02, 1.125), "steel"))
    # THE LEFT COLUMN, and it goes all the way to the floor -- the critic counted
    # "no frame members reaching the floor" as one of the six. It also owns the
    # model's -X extreme, so the width contract sits on real structure.
    P.append(box("colL", (0.10, 0.68, 1.30), (-0.4947, 0.02, 0.65), "dark"))
    P.append(box("colLc", (0.14, 0.735, 0.06), (-0.4947, 0.02, 1.325), "steel"))
    for sy in (-1, 1):
        P.append(box("gusset", (0.16 - SEP, 0.10, 0.10), (-0.42, sy*0.285, 1.02), "dark"))
    # Working panel: rust, small, off to the left. Instruments are 0.22 x 0.14,
    # not a 0.62 x 0.46 sheet of glass.
    P.append(box("panel", (0.30, 0.06, 0.20), (-0.24, -0.365, 0.86), "rust"))
    P.append(box("dial", (0.20, 0.05, 0.12), (-0.24, -0.385, 0.86), "dark"))
    for i, x in enumerate((-0.31, -0.24, -0.17)):
        P.append(box("led%d" % i, (0.035, 0.035, 0.035), (x, -0.398, 0.86), "hazard"))
    for i in range(3):                     # louvres, on the flank not the face
        P.append(box("louvre%d" % i, (0.06, 0.44, 0.04), (0.455, 0.06, 0.60 + i*0.13), "dark"))
    # --- THE EJECTOR PIPE ----------------------------------------------------
    # UNTOUCHED. config.machine.pipeLocal is measured off these exact numbers and
    # the authored spawn depends on them; the only correct duck outlet in the
    # game does not move because the wheel did.
    NP, RP, LP = 10, 0.175, 0.52
    ZP = 0.40
    YC = -0.62
    # PX: the pipe's raw x, shifted -0.020 from the 0 it used to be authored at.
    # finish() centres the mesh on its own bounding box, and the bounding box
    # changed when the wheel moved, so an unmoved pipe would NOT have exported to
    # an unmoved place. Measured off the shipped asset, the old pipe mouth came
    # out at model-local x = -0.1115; this offset puts the new one back on that
    # exact number, so the authored eject point is untouched in the coordinates
    # the game actually reads. (Its z, 0.6650, and its height, 0.3974 against the
    # old 0.3998, come out right on their own.)
    PX = -0.020
    for i in range(NP):
        a = math.radians(i * 360.0 / NP)
        P.append(box("pipe%d" % i, (2*math.pi*RP/NP*1.45, LP - (2*SEP if i % 2 else 0), 0.05),
                     (PX + math.sin(a)*RP, YC, ZP + math.cos(a)*RP), "steel_d", rot=(0, a, 0)))
    RL = RP + 0.045
    for i in range(NP):
        a = math.radians(i * 360.0 / NP)
        P.append(box("lip%d" % i, (2*math.pi*RL/NP*1.45, 0.10 - (2*SEP if i % 2 else 0), 0.09),
                     (PX + math.sin(a)*RL, YC - LP/2 + 0.04, ZP + math.cos(a)*RL), "hazard", rot=(0, a, 0)))
    P.append(box("collar", (0.46, 0.16, 0.46), (PX, -0.40, ZP), "dark"))
    P.extend(_crank_wheel_parts(SEP))
    return finish(P, "crank", bevel=0.008, merge=0.0008)


# Wheel hub in the BUILDER's raw coordinates. Everything about the wheel is
# derived from these three numbers and the radius, in one place, so crank.glb and
# crank_wheel.glb cannot drift apart.
#
# WX is not chosen, it is solved: the rim's outer radius is 0.369 and the model's
# +X extreme is contractually 0.7677, so WX = 0.7677 - 0.369.
CRANK_WX, CRANK_WY, CRANK_WZ, CRANK_WR = 0.3676, -0.505, 1.02, 0.34


def _crank_wheel_parts(SEP=0.003, ox=0.0, oy=0.0, oz=0.0):
    """The wheel, in the crank's raw coordinates, offset by (ox,oy,oz).

    It turns about the model's local Z (Blender Y), so it FACES the player. The
    segments are laid out with rotation (0, a, 0), which maps the box's local +Z
    onto the radial direction and its local +X onto the tangent -- the same
    construction as ring_xz, which is the helper that already knows this.

    THE COPLANAR TRAP IS DIFFERENT ON THIS AXIS. Rotating about Y leaves every
    segment's FRONT and BACK faces (normal +/-Y) parallel, so all twelve rim
    segments would land in the same two planes and every neighbouring pair --
    yellow against dark -- would tie in the depth buffer, right on the part of
    the machine the player watches. Hence the alternating thickness: the dark
    segments are 2*SEP thinner, so their faces stand 3 mm inside the yellow ones.
    """
    WX, WY, WZ, WR = CRANK_WX + ox, CRANK_WY + oy, CRANK_WZ + oz, CRANK_WR
    P = []
    # Dark disc BEHIND the wheel, so steel spokes are not read against a steel
    # cabinet. It sits 0.025 in front of the body skin, not in it -- that exact
    # mistake was the source of the flicker report on the previous model.
    P.append(cyl("backplate", 0.30, 0.05, (WX, WY + 0.075, WZ), "black", verts=12,
                 rot=(math.radians(90), 0, 0)))
    NRIM = 12
    RR = WR
    for i in range(NRIM):
        a = math.radians(i * 360.0 / NRIM)
        P.append(box("rim%d" % i, (2*math.pi*RR/NRIM*1.45,
                                   0.085 - (2*SEP if i % 2 else 0), 0.058),
                     (WX + math.sin(a)*RR, WY, WZ + math.cos(a)*RR),
                     "hazard" if i % 2 == 0 else "dark", rot=(0, a, 0)))
    # Six spokes: the silhouette repeats every 60 degrees, so the wheel is in a
    # visibly different pose in every frame instead of looking like a still disc.
    for i in range(6):
        a = math.radians(i * 60.0)
        # Long enough to bury its outer end IN the rim: at exactly rim-inner
        # radius the two met in a plane and tied 0.0010 apart, which is the
        # tolerance check-coplanar.py tests at.
        Rm = 0.075 + (WR - 0.075) / 2
        P.append(box("spoke%d" % i, (0.05, 0.042, WR - 0.075),
                     (WX + math.sin(a)*Rm, WY, WZ + math.cos(a)*Rm), "steel",
                     rot=(0, a, 0)))
    P.append(cyl("hub", 0.105, 0.15, (WX, WY + 0.02, WZ), "steel_d", verts=10,
                 rot=(math.radians(90), 0, 0)))
    P.append(cyl("hubcap", 0.055, 0.19, (WX, WY - 0.035, WZ), "orange", verts=8,
                 rot=(math.radians(90), 0, 0)))
    # THE HANDLE, and it is the reason this face is the right face: it sticks out
    # of the wheel's plane TOWARDS the player and sweeps an arc in the air 25 cm
    # across. On the old model the same handle swept its arc side-on and read as
    # a twitching stub.
    KR = 0.245
    KA = math.radians(45)
    P.append(box("crankarm", (0.055, 0.055, 0.30),
                 (WX + math.sin(KA)*0.125, WY - 0.075, WZ + math.cos(KA)*0.125), "steel",
                 rot=(0, KA, 0)))
    P.append(cyl("grip", 0.052, 0.20,
                 (WX + math.sin(KA)*KR, WY - 0.160, WZ + math.cos(KA)*KR), "orange",
                 verts=8, rot=(math.radians(90), 0, 0)))
    return P


def b_crank_wheel():
    """The workbench wheel ALONE, origin at its own hub.

    Not a placeable and not in machines.js: a part, offered so the renderer can
    stop identifying the wheel by hand-written coordinates. Mount it at
    config.machine.wheelLocal (0.2872, 1.0200, 0.2750) with identity rotation and
    it lands exactly on top of the wheel baked into crank.glb.

    AXIS: the model's local Z. TRAVEL: unbounded rotation, driven by the existing
    crank spin model (config.machine.spinMinRadPerSec .. spinMaxRadPerSec, chased
    by fill fraction). Positive angle should turn the handle up on the far side;
    with the geometry below that is rotation.z = -angle.
    """
    P = _crank_wheel_parts(0.003, -CRANK_WX, -CRANK_WY, -CRANK_WZ)
    return finish(P, "crank_wheel", bevel=0.008, merge=0.0008, origin="raw")

def b_machine():
    """Duck Assembler. H 2.10, footprint 1.50 x 1.25.

    Two faults, both named by the critic. Its delivery hatch sat at 0.30 while
    the simulation spawned at 0.945 -- 39 cm of daylight between the duck and the
    door it was supposed to have come out of -- and at 10 m the whole thing was a
    31 x 43 px rectangle with a slightly darker rectangle painted on it.

    The hatch moves to the number the sim actually uses. The rectangle is broken
    by giving the machine a WAIST: a wide lower cabinet, a narrow open gantry
    above it with 0.56 m of sky showing between two columns, and a cap that
    overhangs both. That gantry gap is 12 px of background at 10 m, punched
    through the middle of the outline where the old model was solid -- which is
    the difference between a machine and a crate, and it costs 6 boxes."""
    H, W, D = 2.10, 1.50, 1.25
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.13, 0.13, 0.24), (sx*0.60, sy*0.46, 0.12), "dark"))
    P.append(box("base", (W, 1.14, 0.14), (0, 0, 0.29), "dark"))
    P.append(box("body", (1.40, 1.02, 0.86), (0, 0, 0.80), "steel"))
    chute(P, H, D)                       # aperture centre z = 0.945
    for sx in (-1, 1):                   # ribs on the flanks, not on the front
        P.append(box("rib", (0.06, 0.94, 0.80), (sx*0.715, 0, 0.80), "steel_d"))
    P.append(box("waist", (1.46, 1.08, 0.12), (0, 0, 1.28), "dark"))
    P.append(box("hazb", (1.36, 1.00, 0.05), (0, 0, 1.355), "hazard"))
    # THE GANTRY. Two columns and a hole through the machine: the one feature
    # that stops this reading as the same box as every other 1.5 m producer.
    for sx in (-1, 1):
        P.append(box("col", (0.17, 0.34, 0.52), (sx*0.55, -0.18, 1.655), "steel"))
        P.append(box("colb", (0.15, 0.30, 0.50), (sx*0.55, 0.34, 1.645), "steel_d"))
        P.append(box("brace", (0.13, 0.09, 0.09), (sx*0.55, 0.08, 1.86), "dark",
                     rot=(math.radians(38), 0, 0)))
    # What hangs IN the gap, so the hole has something to be a hole around
    P.append(cyl("spindle", 0.10, 0.44, (0, 0.02, 1.72), "orange", verts=10))
    P.append(cyl("spincap", 0.15, 0.06, (0, 0.02, 1.96), "dark", verts=10))
    P.append(box("cap", (W, 1.10, 0.18), (0, 0, 2.01), "hazard"))
    P.append(box("caplip", (1.42, 1.04, 0.05), (0, 0, 1.90), "dark"))
    for i in range(4):
        P.append(box("vent%d" % i, (1.10, 0.05, 0.06), (0, 0.53, 0.50 + i*0.15), "dark"))
    P.append(cyl("lamp", 0.07, 0.10, (-0.52, -0.53, 1.14), "red", verts=8,
                 rot=(math.radians(90), 0, 0)))
    P.append(box("panel", (0.26, 0.06, 0.16), (0.46, -0.545, 1.130), "teal"))
    return finish(P, "machine")

def b_press():
    """Duck Press. H 1.80, footprint 1.00 x 0.75.

    The critic's read of the old one was right twice over. It had NO OUTLET AT
    ALL -- ducks appeared 0.81 m up in the empty window between its posts, out of
    nothing -- and its bed sat flat on the floor, so the only negative space it
    owned was that window.

    Both are structural here. The bed is lifted onto four short legs, which puts
    0.28 m of background under the machine (about 6 px at 10 m, and it is the
    bottom edge of the silhouette that tells a standing machine from a solid
    block). The window between the posts is kept, because it is the thing that
    made this model one of the four the critic said already worked. And the duck
    now leaves through a chute at exactly mouth_z(1.80) = 0.810, directly under
    the die the ram comes down on: stamped at 0.90, out at 0.81.

    THE RAM IS A SEPARATE MODEL (press_ram.glb), the gamble_box_lid pattern.
    Origin, axis and travel are in b_press_ram."""
    H, W, D = 1.80, 1.00, 0.75
    P = []
    # Legs. Daylight under the bed is the cheapest silhouette this machine can
    # buy: it costs 8 boxes and turns a solid base into a standing frame.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.11, 0.11, 0.27), (sx*0.39, sy*0.26, 0.140), "dark"))
            P.append(box("foot", (0.17, 0.17, 0.045), (sx*0.39, sy*0.26, 0.0225), "steel_d"))
    P.append(box("bed", (W, 0.66, 0.21), (0, 0, 0.385), "steel_d"))
    P.append(box("bedlip", (0.92, 0.72, 0.05), (0, 0, 0.475), "dark"))
    # The delivery housing, wrapped around the chute. Narrower than the bed, so
    # the outline steps in on the way up instead of running straight.
    P.append(box("hous", (0.80, 0.60, 0.45), (0, 0.02, 0.720), "dark"))
    chute(P, H, D)                       # aperture centre z = 0.810
    # The die the ram strikes, immediately above the mouth: the duck is made at
    # 0.94 and falls into the chute at 0.81, which is a mechanism a player can
    # read off the shapes rather than off the tooltip.
    P.append(box("anvil", (0.60, 0.46, 0.09), (0, 0.04, 0.980), "hazard"))
    P.append(box("die", (0.42, 0.34, 0.05), (0, 0.04, 1.045), "steel_d"))
    # The window. Two posts and 0.44 m of sky between them -- 10 px of background
    # at 10 m, which is the whole reason this machine reads.
    for sx in (-1, 1):
        P.append(box("post", (0.15, 0.17, 0.62), (sx*0.415, 0, 1.39), "steel"))
        P.append(box("tie", (0.07, 0.13, 0.30), (sx*0.415, -0.19, 1.30), "dark"))
    P.append(box("crown", (W, 0.60, 0.20), (0, 0, 1.70), "hazard"))
    P.append(box("crownlip", (0.94, 0.66, 0.05), (0, 0, 1.585), "dark"))
    P.append(cyl("gauge", 0.09, 0.05, (-0.28, -0.31, 1.70), "white", verts=9,
                 rot=(math.radians(90), 0, 0)))
    for i in range(2):
        P.append(box("led%d" % i, (0.06, 0.04, 0.06), (0.16 + i*0.14, -0.31, 1.70), "red"))
    return finish(P, "press")


def b_press_ram():
    """The Duck Press's moving half. NOT placed by the player and NOT in
    machines.js: a part, mounted by the renderer on `press`.

    ORIGIN (0,0,0) is the ram's own TOP CENTRE, on the press's local centreline.
    Mount it at model-local (0, 1.585, 0) -- the underside of the crown -- with
    identity rotation, and it hangs in the window in its rest pose.

    AXIS: straight down the model's local -Y (world down when the press is
    upright). One degree of freedom, no rotation.

    TRAVEL: 0 (rest, head face at 1.585 - 0.425 = 1.160) to -0.090 (struck, head
    face at 1.070, exactly on the die, whose top is 1.045 + half its 0.05). So
    the full stroke is 90 mm, in model space and in world space alike -- `press`
    carries no modelScale. Anything past -0.090 drives the head through the die.

    STATE: the row's produce.secondsPerDuck cycle. Suggested drive -- ease down
    over the last 0.18 s before the duck pops, hold 0.06 s at -0.075, ease back
    over 0.30 s. The duck should leave the chute on the frame the ram bottoms
    out, because that is the only thing that makes the machine look causal."""
    P = []
    P.append(cyl("shaft", 0.10, 0.34, (0, 0, -0.17), "steel_d", verts=10))
    P.append(cyl("collar", 0.14, 0.07, (0, 0, -0.055), "dark", verts=10))
    P.append(box("head", (0.52, 0.40, 0.13), (0, 0, -0.360), "orange"))
    P.append(box("headlip", (0.58, 0.46, 0.04), (0, 0, -0.300), "dark"))
    for sx in (-1, 1):                    # guide shoes riding the posts
        P.append(box("shoe", (0.09, 0.13, 0.16), (sx*0.31, 0, -0.330), "steel"))
    return finish(P, "press_ram", origin="raw")

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
    """Stacja ssaca - LEJ WLOTOWY na kozle, a nie szafka z kominem.

    At 10 m the old one was a blue box 22 px wide with a grey nub on the front,
    and what it read as was a fuel pump: a closed cabinet with a hose. The thing
    a collector has to communicate is that it EATS -- and the catalog already
    proved how, because the model the critic named as the one that reads at play
    distance is `magnet`: an open two-colour shape whose meaning is carried by
    the hole in it, not by anything on its surface.

    So this piece is now built around a hole. Eight staves make a funnel mouth
    0.72 m across, standing clear of the tank, with nothing behind it but shadow
    -- 16 px of open dark at play distance, and the only round opening at floor
    level in the game. The tank stays blue (it is the only blue object in the
    catalog and that is worth keeping) but it moves BEHIND the mouth, so the
    silhouette is funnel-then-body rather than body-with-nub.

    Height 1.28 EXACTLY (src/data/machines.js `vacuum_station`), owned by the
    axis-aligned lid box -- not by a 12-gon's outermost vertex, which is what
    used to own it and is a number nobody can predict from the literals."""
    P = []
    H = 1.28
    # Kadlub - cofniety, zeby lej stal wolno.
    # 0.655, so the tank's underside is at 0.185 and NOT on the trestles' 0.19
    # top plane; and the pads alone touch the floor. Two planes, 24 pairs.
    P.append(cyl("tank", 0.30, 0.94, (0, 0.16, 0.655), "blue", verts=12))
    P.append(box("lid", (0.56, 0.50, 0.16), (0, 0.16, H - 0.08), "steel"))
    P.append(box("band", (0.62, 0.56, 0.05), (0, 0.16, 0.86), "hazard"))
    # Kozly - podloga widoczna pod kadlubem.
    for sx in (-1, 1):
        P.append(box("foot", (0.10, 0.52, 0.182), (sx*0.24, 0.16, 0.099), "dark"))
        P.append(box("pad", (0.16, 0.14, 0.05), (sx*0.24, 0.16, 0.025), "steel_d"))
    # THE MOUTH. Eight staves round a 0.36 m radius, splayed 26 degrees so the
    # opening flares forwards, and deliberately NOT closed off at the back: the
    # dark inside the cone is the feature.
    for i in range(8):
        a = math.radians(i*45 + 22.5)
        P.append(box("stave%d" % i, (0.20, 0.30, 0.055 - (0.006 if i % 2 else 0.0)),
                     (math.sin(a)*0.30, -0.30, 0.60 + math.cos(a)*0.30), "steel_d",
                     rot=(0, a, 0)))
        P.append(box("lip%d" % i, (0.17, 0.07, 0.075 - (0.008 if i % 2 else 0.0)),
                     (math.sin(a)*0.36, -0.42, 0.60 + math.cos(a)*0.36), "hazard",
                     rot=(0, a, 0)))
    P.append(cyl("throat", 0.13, 0.30, (0, -0.16, 0.60), "black", verts=8,
                 rot=(math.radians(90), 0, 0)))
    P.append(cyl("hose", 0.07, 0.52, (0.26, 0.06, 0.92), "rubber", verts=8,
                 rot=(math.radians(38), 0, 0)))
    return finish(P, "vacuum_station")


# ======================================================== AUTOMATYZACJA
def b_conveyor():
    """Tasmociag - poklad MIEDZY czterema slupkami, ktore wystaja nad tasme.

    Conveyor and stairs are 1.00 x ~0.6 x 2.00 apiece and both are steel with a
    yellow band; an earlier pass moved the stair nosings to white, which fixed
    the colour half but left both objects as a 1 x 2 m steel rectangle. The
    remaining fix has to be structural, and there is exactly one structural fact
    that separates them: STAIRS IS SOLID TO THE GROUND, a wedge with no gap
    under it, and a conveyor is a deck in the air.

    So the deck is now hung between four CORNER STANCHIONS that run the full
    0.65 m and stand 0.085 proud of the belt. From any angle the outline is two
    posts with a bar slung between them and 0.45 m of daylight underneath -- a
    10 px void where the stairs have solid steel, plus four pips on top that a
    wedge cannot have. The old legs stopped at the belt and were inboard, so the
    top edge was a plain unbroken line: the same plain unbroken line the top
    step of the staircase draws.

    Height is 0.65 EXACTLY (src/data/machines.js `conveyor`); the stanchions own
    it and run floor to H, so minY and height are both exact by construction.

    THE BELT LINE IS NOW THE RIDE LINE. It was not. collider.half[1] is 0.325
    on an anchor:'floor' row, so a duck carried by this piece stands at y 0.65 --
    and the band's top face was at 0.555, with the four stanchion tips the only
    thing up at 0.65. Every duck on a belt run therefore floated 9.5 cm over the
    thing that was supposedly carrying it. Nothing in src/data had to move to fix
    that: the CLEAT tops are now at 0.65 exactly and the band sits 2 cm under
    them, so a duck rides on the cleats that push it. The stanchions no longer
    stand proud (they cannot: 0.65 is the ceiling); the void under the deck grew
    by the same 9.5 cm instead, which is where the conveyor/stairs separation
    actually lives.

    The cleats are NOT in this model. They are `conveyor_belt`, a separate GLB on
    the same origin, because they travel -- see b_conveyor_belt."""
    H = 0.65
    # L and W are authored so the OUTER box lands on the grid before the snap:
    # length = L + 2 x bearing plate 0.11 = 2.00, width = W + 0.11 = 1.00.
    # The bearing plates matter beyond decoration: they are AXIS-ALIGNED, so the
    # y extent is exactly 2.00 by construction and finish()'s snap factor is
    # exactly 1.0 on both axes. That is what lets conveyor_belt be authored in
    # this same frame with origin="raw" and still line up to the micron. It used
    # to be the roller cylinders that set the length, and a 10-gon's extreme
    # vertex is a number nobody should have to predict.
    L, W = 1.78, 0.89
    BT = 0.07
    ZB = 0.595                          # band centre; top 0.63, cleat tops 0.65
    P = []
    # ONE PART OWNS EACH EXTREME PLANE, and everything else stops short of it.
    # That is the whole discipline behind the numbers below: the four hazard
    # caps own y = 0.65, the four steel posts own x = +-0.50, the two bearing
    # plates own z = +-1.00, and nothing else is allowed to land on any of them.
    # Getting this wrong is not a cosmetic slip -- a first pass at this model
    # had caps, posts, side rails, drums and bearings all topping out at 0.65
    # together, which is 46 coplanar-overlap pairs across the top of the deck.
    P.append(box("belt", (W, L+0.01, BT), (0, 0, ZB), "dark"))
    for sx in (-1, 1):
        # Top at 0.640, clear of the posts' 0.645 and the caps' 0.650: three
        # families, three planes.
        P.append(box("side", (0.06, L-0.04, 0.16), (sx*0.455, 0, H-0.090), "hazard"))
        for sy in (-1, 1):
            # Full-height corner stanchion: floor to 0.645, capped at 0.65.
            P.append(box("post", (0.11, 0.11, H-0.005), (sx*W/2, sy*(L/2-0.10), (H-0.005)/2), "steel"))
            P.append(box("cap", (0.10, 0.19, 0.06), (sx*W/2, sy*(L/2-0.10), H-0.03), "hazard"))
        # A single cross-tie low down, so the void under the deck stays a void.
        P.append(box("tie", (0.05, L-0.30, 0.05), (sx*W/2, 0, 0.11), "steel_d"))
    for sy in (-1, 1):
        # 0.09 radius and a 0.16 bearing, not 0.11 and 0.216. THE END VIEW IS
        # THE CONVEYOR/STAIRS TEST and it is decided by how much of the 0.65 is
        # solid bar and how much is daylight between two legs. A first pass at
        # this rework thickened the bar to 0.215 and the pair's head-on pixel
        # XOR fell from 45.3% to 39.4% -- it had made the belt MORE like the
        # stairs' solid trapezoid, which is the opposite of the job. Thinned to
        # 0.16 the void under the deck runs 0.135..0.485, i.e. 54% of the
        # object's height is open air, and a wedge has none.
        P.append(cyl("roll", 0.09, W-0.06, (0, sy*L/2, H-0.095), "steel", verts=10,
                     rot=(0, math.radians(90), 0)))
        P.append(box("bear", (W-0.10, 0.11, 0.16), (0, sy*(L/2+0.055), H-0.085), "steel_d"))
    # The drive pod, under the deck at ONE end. Two things at once: the piece now
    # says which end is powered (an asymmetry a symmetric wedge cannot fake), and
    # the void under the deck stops being a plain 10 px rectangle -- it is a
    # rectangle with a lump in one corner, which is a shape and not a gap.
    # Tucked UP against the belt rather than hung in the middle of the void:
    # the pod has to read as machinery without filling the gap that is doing
    # the silhouette work.
    P.append(cyl("motor", 0.085, 0.26, (0, -L/2+0.34, 0.435), "orange", verts=8,
                 rot=(0, math.radians(90), 0)))
    P.append(box("mount", (0.30, 0.12, 0.14), (0, -L/2+0.34, 0.50), "steel_d"))
    return finish(P, "conveyor")


def b_conveyor_belt():
    """The MOVING half of `conveyor`: eight cleats and nothing else.

    Same reason the gambling box is two models -- finish() joins everything it
    is given into one mesh, so a part that has to move independently cannot be
    in it. src/render/rotor.js is no help here: it finds ROTATIONALLY symmetric
    congruent groups, and a row of cleats marching down a straight belt is a
    translation. So this follows the gamble_box_lid pattern instead: a separate
    GLB, authored in the body's own coordinates, with its motion stated as data
    rather than discovered by measuring.

    origin="raw", so nothing is re-centred and nothing is snapped: these
    coordinates ARE conveyor.glb's coordinates, which is exact because
    b_conveyor's snap factor is 1.0 on both horizontal axes by construction.
    The renderer draws this mesh with the placed object's own transform and one
    extra translation -- no offset, no rotation.

    HOW IT MOVES (this is the spec, and it is exact):
      travel axis    local +Z (the game's Y-up frame), i.e. the belt's own
                     forward, the same direction `belt.speed` already drives
      period         0.2225 m = L / 8. Translating by exactly one period maps
                     cleat k onto where cleat k+1 was, so the loop is seamless
                     and needs no wrap, no clipping and no second copy.
      phase          (distance travelled) mod 0.2225, where distance is the
                     integral of the row's own belt.speed -- the belt already
                     knows its speed and its direction, and reversing the drive
                     reverses this with no extra state.
      range          cleats are authored at z = -L/2 + k*0.2225 for k = 0..7,
                     spanning -0.89 .. +0.6675. Adding a phase in [0, 0.2225)
                     keeps every cleat inside -0.89 .. +0.89, so no cleat ever
                     leaves the band -- they appear at the trailing drum and
                     vanish at the leading one, which is what a cleat does when
                     it wraps over a roller.
    A duck rides on the cleat tops at y 0.65, which is exactly collider.half[1]
    * 2 on the row: the physics surface and the visible surface are the same
    plane for the first time."""
    H, L, W, BT = 0.65, 1.78, 0.89, 0.07
    ZB = 0.595
    N = 8
    S = L / N                                  # 0.2225 m
    P = []
    for k in range(N):
        # 0.035 tall, seated 0.015 INTO the band: the cleat top is the ride
        # line and the two solids overlap rather than share a face, so the pair
        # cannot z-fight (tools/check-coplanar.py).
        P.append(box("cleat%d" % k, (W - 0.06, 0.07, 0.035),
                     (0, -L/2 + k*S, H - 0.0175), "steel_d"))
    return finish(P, "conveyor_belt", origin="raw")

# --- THE CORNER'S GEOMETRY, ONCE, SO THE BELT MODEL CANNOT DISAGREE ---------
# b_conveyor_corner and b_conveyor_corner_belt have to sit on the same arc to
# the micron, and the second one is authored with origin="raw" -- it does not
# get the centring that would have hidden a mismatch. So the arc is defined
# here and both read it.
#
# The quarter turn is authored to fill the 1.50 x 1.50 tile EXACTLY, with flat
# axis-aligned faces at every extreme, so finish()'s snap factor comes out 1.0
# on both axes and the arc stays a circle. The old one did not: it was a stubby
# 81-degree arc whose bounding box was 1.45 and got stretched 3.4% into an
# ellipse, and whose two legs stood so close together that at 10 m the whole
# piece read as a round table on one central pillar.
#
#   centre   CX, CY = -0.75, -0.75   (a tile corner, after finish() centres it)
#   band     RC 1.00 +- W/2, W 0.89  -- the same 0.89 band the straight belt has
#   ends     a = 0 leaves through the -X face, a = 90 through the -Y face, and
#            each end's CENTRELINE is 0.25 m off the tile's edge midpoint --
#            an exact multiple of config.build.grid, so a straight belt butts
#            onto it with a seam of zero and no duck-swallowing step.
#   extent   the two end plates own all four extremes: -X at CX, +X at CX+1.50,
#            -Y at CY, +Y at CY+1.50. Nothing else reaches them.
CC = {"CX": -0.75, "CY": -0.75, "RC": 1.00, "W": 0.89, "H": 0.66, "N": 8}


def b_conveyor_corner():
    """Luk 90 stopni. Poklad na TRZECH nogach nad pusta cwiartka.

    The corner's whole silhouette problem was that it had no hole in it. Seen
    from anywhere it was a disc with a stalk, which is a table. It now has the
    one thing a 90-degree turn can have and a straight belt cannot: the INSIDE
    of the turn is empty, floor to deck, all the way to the tile edge. From 10 m
    that is a 30 px notch bitten out of a square -- and the three legs stand at
    the outer radius, so the daylight under the deck is a band, not a shadow.

    Height 0.66 (src/data/buildings.js has no corner row; src/data/machines.js
    `conveyor_corner` footprint [1.50, 0.66, 1.50], collider half[1] 0.33), and
    as on the straight belt the CLEAT tops are that 0.66 -- a duck rides on the
    thing that carries it. Cleats live in conveyor_corner_belt."""
    CX, CY, RC, W, H, N = CC["CX"], CC["CY"], CC["RC"], CC["W"], CC["H"], CC["N"]
    RI, RO = RC - W/2, RC + W/2         # 0.555 .. 1.445
    ZB = H - 0.055                      # band centre; top 0.63, cleats to 0.66
    P = []
    # Band: N segments, tangential length overlapping so the arc is continuous.
    # Przy obrocie (0,0,-a) os X wypada STYCZNIE, os Y promieniowo.
    # AN ARC OF OVERLAPPING BOXES IS THE RING IDIOM AGAIN, and it needs the same
    # cure: rotating about Z leaves every segment's top and bottom face in one
    # shared plane, so 26 of them tie across 0.38 m^2 -- the largest single
    # coincident cluster this model could contain, right on the surface the
    # player watches ducks travel over. Alternate segments are 8 mm thinner.
    for i in range(N):
        a = math.radians((i + 0.5) * 90.0 / N)
        seg = 2*math.pi*RC/4/N * 1.35
        # Shrunk about the CENTRE, so neither the top nor the bottom face is
        # shared. Anchoring one end and varying the other just moves the tie.
        t = 0.07 - (i % 4) * 0.004
        P.append(box("belt%d" % i, (seg, W, t),
                     (math.sin(a)*RC+CX, math.cos(a)*RC+CY, ZB), "dark",
                     rot=(0, 0, -a)))
    # Rail radii are 0.024 and not 0.0275 off the band's own edge, deliberately:
    # at half their own width the rail's inner face lands EXACTLY on the band's
    # outer face, and a 90-degree arc of that is 64 opposite-facing ties. 3.5 mm
    # of overlap instead of a butt joint removes all of them.
    #
    # Guard rails. The outer one is the tall one: on a turn, that is the wall a
    # duck is actually thrown against, and it is also the edge the eye follows
    # to read the curve. The inner one is a low kerb, so the notch stays open.
    # Both alternate their section for the same reason the band does.
    for i in range(N):
        a = math.radians((i + 0.5) * 90.0 / N)
        ho = 0.19 - (i % 4) * 0.004
        hi = 0.10 - (i % 4) * 0.004
        P.append(box("rout%d" % i, (2*math.pi*(RO+0.03)/4/N*1.35, 0.055, ho),
                     (math.sin(a)*(RO+0.024)+CX, math.cos(a)*(RO+0.024)+CY, H-0.100),
                     "hazard", rot=(0, 0, -a)))
        P.append(box("rin%d" % i, (2*math.pi*(RI-0.03)/4/N*1.35, 0.055, hi),
                     (math.sin(a)*(RI-0.024)+CX, math.cos(a)*(RI-0.024)+CY, H-0.058),
                     "steel_d", rot=(0, 0, -a)))
    # The two end plates. These own every extreme of the bounding box, and they
    # are the faces a straight conveyor butts against. There were skirts beside
    # them in a first pass, sharing both the 0.66 top plane and an inner face
    # with the plates over 0.22 m^2; they are gone rather than nudged, because
    # they were saying nothing the plates were not already saying.
    P.append(box("endA", (0.06, W+0.11, 0.30), (CX+0.03, CY+RC, H-0.15), "steel"))
    P.append(box("endB", (W+0.11, 0.06, 0.30), (CX+RC, CY+0.03, H-0.15), "steel"))
    # Drums at both mouths, radial axis: Z -> rotY(90) -> X -> rotZ(90-a).
    # 6.3 degrees in from each mouth, not 0 and 90: a drum's radius pokes along
    # the belt's direction, so a drum centred exactly on the a = 0 end face
    # would hang 0.11 m past x = -0.75 -- outside the tile, and enough to make
    # finish() rescale the whole arc into an ellipse to fit 1.50. 0.11 / RC in
    # degrees is 6.3, which is exactly the offset that tucks it inside.
    for ad in (6.3, 83.7):
        a = math.radians(ad)
        cxp, cyp = math.sin(a)*RC+CX, math.cos(a)*RC+CY
        P.append(cyl("roll", 0.11, W-0.04, (cxp, cyp, H-0.114), "steel", verts=10,
                     rot=(0, math.radians(90), math.radians(90)-a)))
    # THREE legs, all on the OUTER radius: two under the mouths and one under
    # the apex of the turn. Nothing stands in the inner quadrant, which is the
    # whole point -- you see the floor through this piece from two sides.
    for ad in (4, 45, 86):
        a = math.radians(ad)
        lx, ly = math.sin(a)*(RO-0.09)+CX, math.cos(a)*(RO-0.09)+CY
        # Feet own z = 0; the legs start 0.02 up, inside them.
        P.append(box("leg%d" % ad, (0.10, 0.10, H-0.12), (lx, ly, 0.02 + (H-0.12)/2), "steel"))
        P.append(box("foot%d" % ad, (0.18, 0.18, 0.04), (lx, ly, 0.02), "dark"))
    return finish(P, "conveyor_corner", merge=0.001)


def b_conveyor_corner_belt():
    """The MOVING half of `conveyor_corner`. Same contract as conveyor_belt,
    except that a cleat on a turn travels along an ARC, so the motion is a
    rotation and not a translation.

    HOW IT MOVES:
      pivot      model-local (x, z) = (-0.75, +0.75) in the game's Y-up frame,
                 at any y -- the arc centre. It is the blender-space corner
                 (-0.75, -0.75), and export_yup maps blender +Y to game -Z,
                 which is why the sign of the second number flips. MEASURE it
                 off the exported GLB rather than trusting this line: it is the
                 centre of the circle the cleats sit on, and tools/measure-glb.py
                 prints the bounding box that contains it.
      axis       local +Y (straight up). A belt corner turns in the floor plane.
      period     11.25 degrees = 90 / 8. One period maps cleat k onto cleat
                 k+1's start, so the loop is seamless with no wrap.
      phase      (distance travelled / RC) in radians, mod 11.25 deg, where
                 distance is the integral of the row's belt.speed. RC is 1.00 m
                 exactly, so the angular rate IS the linear speed in rad/s and
                 a corner carries ducks at the same surface speed as a straight.
      direction  positive phase runs from the -X mouth to the -Y mouth, which
                 is the row's belt.turn = 90 sense.
      range      cleats are authored at a = 2 + k*11.25 deg for k = 0..7, so
                 they span 2 .. 80.75 deg and a phase in [0, 11.25) keeps every
                 one of them inside the 0..90 deg band."""
    CX, CY, RC, W, H, N = CC["CX"], CC["CY"], CC["RC"], CC["W"], CC["H"], CC["N"]
    P = []
    for k in range(N):
        a = math.radians(2.0 + k * 90.0 / N)
        P.append(box("cleat%d" % k, (0.07, W-0.06, 0.035),
                     (math.sin(a)*RC+CX, math.cos(a)*RC+CY, H - 0.0175),
                     "steel_d", rot=(0, 0, -a)))
    return finish(P, "conveyor_corner_belt", origin="raw")

# The sloped belt's band, stated once. src/data/machines.js `conveyor_slope`
# carries FOUR numbers measured off this band -- belt.rise -0.718,
# belt.surfaceOffsetY 0.0555, collider.surface.half[2] 1.0625 and
# surface.pitchDegrees 19.741 -- and I may not edit that file. So the band's
# literals (L, W, ang, and the band's own centre height) are frozen, and
# everything this builder changes is bolted to the OUTSIDE of them. Anything
# that would move the y extent past the band's own +-0.9986 would also change
# finish()'s snap factor and silently retune all four numbers.
CS = {"L": 2.10, "W": 0.73, "ANG": math.radians(20), "ZB": 0.80}


def b_conveyor_slope():
    """Tasmociag pochyly. Burty to teraz KRATOWNICA, nie blacha.

    The piece already read as a slope -- a diagonal is the one silhouette
    nothing else in the catalog has. What it did not read as was a MACHINE: two
    solid orange plates down the flanks made a filled triangle, and a filled
    triangle 2 m long is the same 45 px wedge the ramp draws. Replacing each
    plate with a chord-and-web truss puts five holes down each flank, so the
    descent is now drawn by a LINE with daylight under it rather than by a
    block, and the piece reads as lifted at one end from every angle.

    The band, its length, its width and its pitch are untouched, for the reason
    in the CS comment above."""
    L, W, ang, ZB = CS["L"], CS["W"], CS["ANG"], CS["ZB"]
    ca, sa = math.cos(ang), math.sin(ang)
    P = []
    P.append(box("belt", (W, L, 0.07), (0, 0, ZB), "dark", rot=(ang, 0, 0)))
    for sx in (-1, 1):
        X = sx*(W/2+0.02)
        # Truss instead of a plate: a top chord level with the old rail's top, a
        # bottom chord at its foot, and diagonals between them.
        P.append(box("chordT", (0.06, L, 0.07), (X, 0, ZB+0.105), "hazard", rot=(ang, 0, 0)))
        P.append(box("chordB", (0.06, L, 0.05), (X, 0, ZB-0.055), "hazard", rot=(ang, 0, 0)))
        for i in range(6):
            t = -L/2 + 0.175 + i*0.35
            # Alternating diagonals. Authored in the band's own tilted frame,
            # then tilted with it, so the web stays square to the belt.
            P.append(box("web%d%d" % (sx, i), (0.05, 0.30, 0.05),
                         (X, t*ca, ZB + 0.025 + t*sa), "steel_d",
                         rot=(ang, 0, math.radians(38 if i % 2 else -38))))
        # podpory PRZYKRECONE OD ZEWNATRZ, nie pod tasma
        P.append(box("legL", (0.09, 0.09, 0.86), (sx*(W/2+0.09), -L/2+0.16, 0.43), "steel"))
        P.append(box("legH", (0.09, 0.09, 1.55), (sx*(W/2+0.09),  L/2-0.16, 0.78), "steel"))
        P.append(box("bracL", (0.22, 0.08, 0.08), (sx*(W/2+0.03), -L/2+0.16, 0.80), "steel_d"))
        P.append(box("bracH", (0.22, 0.08, 0.08), (sx*(W/2+0.03),  L/2-0.16, 1.50), "steel_d"))
    # Cross-ties under the band, in the space the solid plates used to hide.
    for i in range(3):
        t = -L/2 + 0.45 + i*0.60
        P.append(box("tie%d" % i, (W+0.14, 0.06, 0.06),
                     (0, t*ca, ZB - 0.115 + t*sa), "steel_d", rot=(ang, 0, 0)))
    return finish(P, "conveyor_slope")


def b_conveyor_slope_belt():
    """The MOVING half of `conveyor_slope`. Same pattern as conveyor_belt, one
    difference: this belt is TILTED, so its travel is not local +Z.

    HOW IT MOVES:
      travel axis  the band's own downhill direction in model space,
                   (0, -0.3376, +0.9413) in the game's Y-up frame -- i.e.
                   normalize(0, belt.rise, 2.00) with belt.rise = -0.718, which
                   is the vector src/data/machines.js already states. Local +Z
                   alone would walk the cleats straight off the surface.
      period       0.30 m along that axis (7 cleats over the 2.10 m band).
      phase        (distance travelled) mod 0.30, distance being the integral of
                   the row's belt.speed. Sign follows the drive, so a reversed
                   belt runs its cleats uphill with no extra state.
      range        cleats span t = -0.83 .. +0.97 along the band, and the band
                   runs to +-1.05, so a phase in [0, 0.30) never pushes one off
                   the end.
    origin="raw": these are b_conveyor_slope's own coordinates. NOTE the one
    caveat that does not apply to the straight belt -- conveyor_slope's snap
    factor is not exactly 1.0 (the band's tilted corners set the y extent at
    +-0.9986, so fy = 1.0014), and origin="raw" skips it. The cleats therefore
    sit up to 1.4 mm short of the band's ends: 0.03 px at 10 m, and I would
    rather state the number than hide it by re-deriving the band."""
    L, W, ang, ZB = CS["L"], CS["W"], CS["ANG"], CS["ZB"]
    ca, sa = math.cos(ang), math.sin(ang)
    P = []
    for k in range(7):
        t = -0.83 + k*0.30
        # 12 mm proud of the band and 33 mm buried in it. Proud, because a flush
        # cleat is invisible; only 12 mm, because unlike the flat conveyor this
        # piece's physics surface IS the band's top face (collider.surface,
        # offsetY 0.0555) -- a 40 mm cleat would stand through every duck.
        P.append(box("cleat%d" % k, (W-0.05, 0.09, 0.045),
                     (0, t*ca, ZB + 0.0267 + t*sa), "steel_d", rot=(ang, 0, 0)))
    return finish(P, "conveyor_slope_belt", origin="raw")

def b_fan():
    """Wiatrak - obrecz na slupie. Stopa TROJNOZNA, nie talerz.

    This is the model the other two fans are read against, so its class does not
    move: a circle on a thin pole, weight at the top. Two things changed.

    1. THE RING NO LONGER Z-FIGHTS WITH ITSELF. ring_xz lays 16 overlapping
       boxes around a circle and rotating about Y does not turn their +-Y faces,
       so all 32 of those faces sat in two shared planes and every neighbouring
       pair was a depth tie: 64 coplanar-overlap pairs on a 360-triangle model,
       on the one part of the one model that is meant to be seen spinning. The
       ring_yz helper had carried the cure (`sep`) since the crank; ring_xz and
       ring_xy simply never got it. They have it now.
    2. THE PLATE FOOT BECAME A TRIPOD. A 0.84 m disc under a 0.18 m pole is a
       solid 18 px lozenge on the floor at 10 m, and it was the only part of the
       fan with no hole in it -- so the piece read circle-on-stick-on-blob. Three
       feet put daylight between the floor and the machine, which is the same
       trick the deck of the conveyor plays and the reason `magnet` reads.

    Height is 1.63 (src/data/machines.js `fan`), owned by the ring: z 1.00 plus
    R 0.58 plus half of the 0.10 section. The tripod does not touch it, and the
    even-numbered ring segments keep the full section, so the extreme is exact.

    ROTOR SAFETY (src/render/rotor.js): the four blades are the only congruent
    group anywhere near the axis -- the ring's segments now split into two
    groups of 8 at radius 0.58 and the feet are three parts at 0.40, all further
    out than the blades' 0.27, and detectRotor takes the CLOSEST valid group."""
    P = []
    # slup stoi ZA tarcza (y>0), inaczej dolna lopatka przez niego przechodzi
    P.append(cyl("pole", 0.09, 0.98, (0, 0.24, 0.56), "steel", verts=8))
    # Tripod: three splayed feet and a hub collar. The extremes in Y are owned
    # by feet 1 and 2, as flat-topped boxes, so the y extent is predictable.
    # THE THREE PADS ARE THE ONLY THINGS TOUCHING z = 0, and the three feet the
    # only things at their own height. A first pass had feet, pads and collar
    # all standing on the floor plane and all 0.05 thick, which put 42 pairs
    # into a 424-triangle model -- the tripod was a coincident-face factory
    # exactly the way the plate it replaced was not. Each foot is also 2 mm
    # thinner than the last, so where two of them overlap near the collar they
    # cannot share a face either.
    P.append(cyl("collar", 0.13, 0.09, (0, 0.24, 0.052), "steel_d", verts=10))
    for i in range(3):
        a = math.radians(i*120 + 60)
        fx, fy = math.sin(a)*0.20, math.cos(a)*0.20
        t = 0.05 - i*0.002
        P.append(box("foot%d" % i, (0.10, 0.40, t), (fx, 0.24 + fy, 0.008 + t/2), "dark",
                     rot=(0, 0, -a)))
        P.append(box("pad%d" % i, (0.16, 0.09, 0.035), (math.sin(a)*0.38, 0.24 + math.cos(a)*0.38, 0.0175),
                     "hazard", rot=(0, 0, -a)))
    # wspornik konczy sie NA TYLNEJ scianie piasty (y=0.11), nie przechodzi przez lopatki
    P.append(box("brack", (0.11, 0.15, 0.11), (0, 0.205, 1.00), "steel_d"))
    ring_xz("ring", 0.58, 16, 0.25, 0.10, 0.10, 1.00, "steel", P, sep=0.006)
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
    # The foot plates alone touch z=0; the arms and the post start 4 mm up, so
    # four parts no longer share the ground plane. The caps and feet are also
    # pulled 12 mm inside the arm tips, which used to be their own end plane
    # as well -- the arms still define the 1.00 m bounding faces on their own.
    lb = la - 0.012
    P.append(box("a", (la, T, H - 0.004), (-e - la/2, 0.0, 0.004 + (H - 0.004)/2), "concrete"))
    P.append(box("b", (T, la, H - 0.004), (0.0, -e - la/2, 0.004 + (H - 0.004)/2), "concrete"))
    P.append(box("post", (PS, PS, H - 0.004), (0, 0, 0.004 + (H - 0.004)/2), "steel_d"))
    P.append(box("capa", (lb, T+0.05, 0.08), (-e - la/2, 0, H + 0.04), "hazard"))
    P.append(box("capb", (T+0.05, lb, 0.08), (0, -e - la/2, H + 0.04), "hazard"))
    P.append(box("capp", (PS+0.05, PS+0.05, 0.10), (0, 0, H + 0.05), "hazard"))
    P.append(box("foota", (lb, T+0.07, 0.09), (-e - la/2, 0, 0.045), "steel_d"))
    P.append(box("footb", (T+0.07, lb, 0.09), (0, -e - la/2, 0.045), "steel_d"))
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
        # 1.28, not 1.30: at 1.30 the treads' flanks land on x = +-0.65, which
        # is exactly where the new kerbs' outer faces are, and the pair ties
        # over the whole length of the ramp.
        # zz + 0.004, not zz + 0.009: laid exactly ON the sloped face the tread
        # hovered 0.0008 m over it, which is a 0.39 m^2 near-tie across the
        # whole ramp -- the one cluster this model has always had. Sunk 5 mm it
        # intersects the wedge instead, and still stands 0.013 proud.
        P.append(box("tread%d" % i, (1.28, 0.10, 0.018), (0, yy, zz + 0.004),
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
    # SIDE KERBS, and they are the change that matters here.
    #
    # A ramp's silhouette is a triangle and there is nothing to improve about
    # that -- it is already the least ambiguous outline in the catalog. What it
    # could not do was tell you WHICH SIDE IT IS, because a bare wedge seen from
    # its flank is a single flat concrete plane 45 px wide with no line on it at
    # all, and the treads are on the top face where a flank view cannot see
    # them. Two raised kerbs give the flank an edge that catches the sun, and
    # give the top face a channel a duck reads as a lane.
    #
    # 0.055 proud, 0.12 thick (so 0.065 of it is buried in the wedge and there
    # is no gap under it), and 1.19 m of clear lane between the pair -- eight
    # duck-widths, nothing can wedge.
    #
    # THE HEIGHT ENVELOPE IS -0.45 .. +0.47 AND THIS STAYS INSIDE IT, which is
    # the whole reason the kerb stops short of both ends: it spans y -0.55 to
    # +0.80 rather than the full run. Carried to the crest at y = -0.97 a kerb
    # standing 0.055 proud would top out at 0.505 and silently make the model
    # 0.9425 tall against a data row that says 0.92; carried to the tip at
    # y = +0.97, where the wedge has no thickness at all, its underside would
    # poke out below -0.45. Measured envelope as built: -0.402 .. +0.275.
    for sx in (-1, 1):
        P.append(box("kerb%d" % sx, (0.11, 1.35, 0.12), (sx*0.595, 0.125, -0.0635),
                     "hazard", rot=(-math.atan(SLOPE), 0, 0)))
    return finish(P, "ramp")

def b_chute():
    """Rynna - polokragly kanal otwarty do gory.

    Same ring idiom, third instance: eleven overlapping shell staves rotated
    about Y, so all 22 of their end faces sat in the two planes y = +-1.00 and
    every neighbouring pair overlapped there. 172 coplanar-overlap pairs out of
    540 triangles, 32%, and the rims doubled it at both ends. The staves now
    alternate 8 mm in length, which is 0.18 px at play distance and removes the
    tie completely.

    The silhouette change is HOOPS, and the reason it is not the legs is
    arithmetic. The trough's underside sits at 0.12 and its rim at 0.53, so
    there is only 0.14 m of leg under it -- three pixels at 10 m. Nothing done
    down there can be read, and a first attempt at splayed A-frames proved it
    twice over: invisible, and it pushed the model to 0.5511 tall against a
    0.53 contract, because a tilted leg lifts its own foot off the floor and
    finish() reports max minus min.
    So the change is on the part that HAS pixels: four hoops standing 0.05
    proud of the shell, at the quarter stations. End-on the outline is
    unchanged, but along the length the trough now has four notches breaking
    its top edge -- which is what tells it from a kerb, a rail or a low wall,
    all of which draw one unbroken horizontal line."""
    P = []
    # rynna OTWARTA DO GORY: luk od -90 przez dol (180) do +90 stopni
    L, N, R, ZC = 2.00, 10, 0.34, 0.46
    for i in range(N + 1):
        a = math.radians(90 + i * 180.0 / N)
        # Alternating stave length: 2.000 / 1.992. The rims cap both ends, so
        # the 4 mm step at each end is covered as well as invisible.
        P.append(box("shell%d" % i, (0.14, L - (0.008 if i % 2 else 0.0), 0.09),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "steel", rot=(0, a, 0)))
    for sy in (-1, 1):
        for i in range(N + 1):
            a = math.radians(90 + i * 180.0 / N)
            P.append(box("rim%d%d" % (sy, i), (0.13, 0.06 - (0.006 if i % 2 else 0.0), 0.13),
                         (math.sin(a)*R, sy*(L/2), ZC + math.cos(a)*R), "hazard", rot=(0, a, 0)))
    # Cztery pary klamer NA SAMEJ KRAWEDZI, i tylko tam.
    #
    # A full hoop round the half-pipe costs 11 boxes and 132 triangles a piece,
    # and ten of those eleven are on the underside of a trough that stands 0.12
    # off the floor -- nobody will ever see them. Four full hoops doubled the
    # model from 540 to 1068 triangles to decorate a shadow. The TOP EDGE is the
    # silhouette, so the clamps go on the top edge and nowhere else: eight
    # boxes, 96 triangles, and the same four notches in the outline.
    #
    # 0.065 and not 0.07 in the radial size: at 0.07 the clamp's outer face
    # lands on the shell's own 0.53 top plane and the two overlap, which is a
    # coincident pair -- the exact defect the alternating stave lengths above
    # exist to remove.
    for sy in (-1.5, -0.5, 0.5, 1.5):
        yy = sy * (L / 4.0)
        for a in (math.radians(90), math.radians(270)):
            # 0.13, not 0.14, in the tangential size. rot=(0,a,0) at a = 90 maps
            # the box's X onto Z, so the tangential number is what decides the
            # clamp's TOP -- at 0.14 it lands on the shell's own 0.53 plane and
            # 48 pairs appear. This is the axis-swap that makes the ring idiom
            # so easy to get wrong twice.
            P.append(box("clamp", (0.13, 0.09, 0.065),
                         (math.sin(a)*(R + 0.035), yy, ZC + math.cos(a)*(R + 0.035)),
                         "hazard", rot=(0, a, 0)))
    # Nogi: PIONOWE i dokladnie 0 .. legh. Pochylona noga unosi wlasna stope nad
    # podloge, a finish() liczy wysokosc jako max minus min -- pierwsza wersja
    # tych nog zrobila z 0.53 -> 0.5511 i po cichu rozjechala wiersz danych.
    legh = ZC - R + 0.02
    for sy in (-1.5, -0.5, 0.5, 1.5):
        yy = sy * (L / 4.0)
        for sx in (-1, 1):
            P.append(box("leg", (0.08, 0.10, legh), (sx*0.28, yy, legh/2), "dark"))
        # 0.60, not 0.64: at 0.64 the tie's ends land on the legs' own outer
        # faces at +-0.32 and every leg/tie pair ties there.
        P.append(box("tie", (0.60, 0.06, 0.06), (0, yy, legh*0.42), "dark"))
    return finish(P, "chute", merge=0.001)

def b_bridge():
    P = []
    L, W = 3.00, 0.99
    P.append(box("deck", (W, L, 0.10), (0, 0, 0.95), "steel"))
    for i in range(7):
        # Sunk 0.01 INTO the deck rather than laid on it. The deck's top face
        # and the planks' undersides were both at y = 1.00 across 1.79 m^2 --
        # the biggest coincident cluster in the model, and older than this pass.
        P.append(box("plank%d" % i, (W-0.06, 0.30, 0.04), (0, -L/2+0.32+i*0.44, 1.01), "dark"))
    for sx in (-1, 1):
        # White handrails, for the same reason as the stair nosings: a bridge is
        # something you WALK ON. It was previously orange-railed, which put it
        # in the machinery class beside the slide -- and a slide is a chute for
        # ducks, not a walkway. Now the bridge is the pale flat one and the
        # slide is the orange tilted one, which is a difference you can read at
        # 10 m from the silhouette and the colour independently.
        P.append(box("rail", (0.06, L, 0.07), (sx*(W/2-0.03), 0, 1.42), "white"))
        P.append(box("rail2", (0.05, L, 0.05), (sx*(W/2-0.03), 0, 1.20), "white"))
        for i in range(5):
            P.append(box("post%d" % i, (0.07, 0.07, 0.50), (sx*(W/2-0.03), -L/2+0.30+i*0.65, 1.20), "steel"))
        # A TRUSS UNDER THE DECK, not four posts at the corners.
        #
        # The bridge's problem was never its top half -- the white rails read
        # cleanly and separate it from the slide exactly as intended. It was the
        # bottom: 0.95 m of nothing between four thin legs, so from any angle
        # except dead side-on the piece looked like a plank hovering. Three
        # metres is the longest span in the catalog and the one thing a player
        # should be able to see about it is that it is HELD UP.
        #
        # Six diagonals per side, alternating, plus the two legs. That is 12 new
        # boxes for 144 triangles, on a model that had 312 -- and it buys a
        # zig-zag of light and shadow along the whole span instead of a void.
        for sy in (-1, 1):
            P.append(box("leg", (0.11, 0.11, 0.95), (sx*(W/2-0.10), sy*(L/2-0.22), 0.475), "steel"))
        for i in range(6):
            yy = -L/2 + 0.44 + i*0.42
            # Alternating section, because at 0.42 m spacing a 0.62 m diagonal
            # overlaps its neighbours and every pair would share both flanks.
            P.append(box("diag%d" % i, (0.05 - (0.006 if i % 2 else 0.0), 0.62, 0.05),
                         (sx*(W/2-0.05), yy, 0.53), "steel_d",
                         rot=(math.radians(46 if i % 2 else -46), 0, 0)))
        P.append(box("chord", (0.06, L-0.30, 0.06), (sx*(W/2-0.05), 0, 0.21), "steel_d"))
    return finish(P, "bridge")

def b_pillar():
    P = []
    P.append(cyl("shaft", 0.20, 2.20, (0, 0, 1.20), "concrete", verts=10))
    P.append(box("base", (0.56, 0.56, 0.20), (0, 0, 0.10), "steel_d"))
    P.append(box("cap", (0.50, 0.50, 0.16), (0, 0, 2.38), "steel_d"))
    P.append(cyl("band", 0.23, 0.10, (0, 0, 0.55), "hazard", verts=10))
    return finish(P, "pillar")


# ========================================================== PRZEDMIOTY
def _crate(w, d, h, t, post, name, nx=4, nz=3, frame="steel_d", slat="wood_lt", floor="wood"):
    """Skrzynia z ATAZUROWYMI bokami - siatka prostokatnych dziur miedzy listwami.

    STEEL-FRAMED by default, and that is a separation fix, not a restyle. `box`
    and `crate_wood` were the same object: identical 1.00 x 1.00 footprint, 5 cm
    apart in height (one backbuffer pixel at 10 m), and drawing on exactly the
    same two palette entries -- wood and wood_lt -- so 100% of their colour
    overlapped. Two storage rows the player has to tell apart in a hotbar and on
    the floor had nothing to tell apart BY.

    They are different objects in fiction, so they are now different objects in
    material: this one is a steel-framed open crate (cool grey posts and rails,
    pale slats between them), and crate_wood is solid warm planks all through.
    Cool-vs-warm and open-vs-solid are both readable at 22 px per metre, and
    neither touches the bounding box -- both heights are hard-coded in
    src/data/tools.js as footprint[1] and the cavity contract below depends on
    them.

    The three colour arguments exist so the family can still produce an all-wood
    crate if one is ever wanted, without a second copy of this function.
    """
    # Zadne dwie bryly nie moga miec sciany w TEJ SAMEJ plaszczyznie - to jest z-fighting.
    # Listwy poziome sa cienesze od pionowych i schowane w nich, dno jest wezsze od scian,
    # a slupki narozne wystaja na zewnatrz o 12 mm.
    P = []
    barw = 0.055
    th = t * 0.55                                   # listwa pozioma: cieniej niz pionowa
    # The corner posts are left as the ONLY part touching z=0 -- they are what
    # sets minY and the h+0.05 height the cavity note depends on. The floor and
    # both wall grids lift a few millimetres off it, because four parts sharing
    # the ground plane was 30 of this family's tied pairs on its own. The
    # cavity() call below is NOT touched, so the published interior is byte
    # identical to what src/data/tools.js already holds.
    P.append(box("bot", (w - 2*t, d - 2*t, t - 0.003), (0, 0, 0.003 + (t - 0.003)/2), floor))
    for sx in (-1, 1):
        X = sx*(w/2 - t/2)
        for j in range(nx + 1):
            yy = -d/2 + t + j*(d - 2*t)/nx
            P.append(box("vx", (t, barw, h - 0.004), (X, yy, 0.004 + (h - 0.004)/2), frame))
        for k in range(nz + 1):
            zz = t + k*(h - t)/nz
            # 6 mm short: the slat run used to end exactly on the outer face of
            # the perpendicular grid's end upright, frame against slat.
            P.append(box("hx", (th, d - 2*t + barw - 0.006, barw), (X, 0, zz), slat))
    for sy in (-1, 1):
        Y = sy*(d/2 - t/2)
        for j in range(nx + 1):
            xx = -w/2 + t + j*(w - 2*t)/nx
            # 2 mm shorter again than the vx grid, so the two wall grids do not
            # share a top or a bottom cap where they meet at the corners.
            P.append(box("vy", (barw, t, h - 0.008), (xx, Y, 0.006 + (h - 0.008)/2), frame))
        for k in range(nz + 1):
            zz = t + k*(h - t)/nz
            # ...and the same 1.5 mm on the slat courses, which cross the hx
            # courses at all four corners at identical heights.
            P.append(box("hy", (w - 2*t + barw - 0.006, th, barw), (0, Y, zz + 0.0015), slat))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("p", (post, post, h + 0.05),
                         (sx*(w/2 - post/2 + 0.012), sy*(d/2 - post/2 + 0.012), (h + 0.05)/2), frame))
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
    """Otwarty od gory ORAZ z BOCZNYM WLOTEM na wysokosci tasmy.

    THE SIDE INTAKE. Until now the only way in was over the rim: containers
    capture through the MOUTH of their cavity, which sits on top, so a duck
    arriving horizontally off a belt just bumped the wall and there was no way
    to run a machine's output into storage. The -Y end wall is now a doorway.

    THE SILL HEIGHT IS MEASURED, NOT CHOSEN. What a belt actually presents:
      * flat `conveyor`     -- slat tops at z 0.585 (belt slab 0.485..0.555,
                               slats 0.545..0.585)
      * `conveyor_slope`    -- belt band 1.192 m down to 0.474 m over its run
    A duck is 0.20 x 0.386 x 0.146 and arrives with belt momentum, so the sill
    has to sit CLEAR BELOW the lowest of those or the duck catches the lip:
      sill 0.34  ->  0.245 m under a flat conveyor, 0.134 m under the slope's
                     low end. Both are more than the duck's smallest dimension.
      head 1.24  ->  0.655 m of headroom over a flat conveyor.
    The slope's HIGH end (1.192, duck crown at 1.578) does NOT clear the lintel;
    that end is the slope's input, not its discharge.

    THE BOUNDING BOX IS UNTOUCHED. The end wall is cut into a sill, a lintel and
    two jambs that keep the exact same outer planes, and the hazard surround
    sits at y -2.24, inboard of rimA at -2.245. So x still spans 2.29 and y
    still spans 4.49, the snap factors are the same, and cavity() below emits
    the identical half/offset that src/data/tools.js hard-codes.
    """
    P = []
    W, D, H, T = 2.20, 4.40, 1.90, 0.10
    AW, ASILL, AHEAD = 1.00, 0.34, 1.24     # aperture: half-width, sill, head
    P.append(box("floor", (W, D, T), (0, 0, T/2), "steel_d"))
    for sx in (-1, 1):
        P.append(box("wx", (T, D, H), (sx*(W/2-T/2), 0, H/2), "rust"))
    # +Y end: solid. -Y end: sill + lintel + two jambs around the doorway.
    P.append(box("wy", (W-2*T, T, H), (0, (D/2-T/2), H/2), "rust"))
    # 1.96 wide, not 2.00: at 2.00 the three pieces' end faces land on x = +-1.00,
    # which is exactly the inner face of each long wall -- 0.38 m^2 of coincident
    # rust-on-rust that check-coplanar counts four times over. The 0.02 they give
    # up sits behind the corner posts.
    ey, EW = -(D/2-T/2), 1.96
    P.append(box("sill", (EW, T, ASILL), (0, ey, ASILL/2), "rust"))
    P.append(box("lintel", (EW, T, H-AHEAD), (0, ey, (AHEAD+H)/2), "rust"))
    # Jambs are 0.09 deep (not T) and run 0.30..1.28, i.e. they OVERLAP the sill
    # and the lintel instead of butting them. Butting produced 0.5 m^2 of
    # coincident faces at z 0.34 / 1.24 and at y -2.20 / -2.10; the aperture is
    # still exactly 0.34 .. 1.24 because the sill top and the lintel soffit are
    # what define it.
    jw = (EW - AW)/2
    for sx in (-1, 1):
        P.append(box("jamb", (jw, 0.09, 0.98), (sx*(AW+jw)/2, ey, 0.79), "rust"))
    # Hazard surround. The mouth is the one thing on this model that is not a
    # plain rusty box, and it is what keeps the container apart from box /
    # crate_wood / box_big at 10 m: a 22 x 20 px black hole in a lit frame.
    # NO backing plate behind the mouth. A dark quad plugging the doorway would
    # make the opening read correctly and be a lie: the sim is about to send
    # ducks through it. The hole is a hole.
    fy, ft = -2.215, 0.05
    # The bands sit BELOW the sill and ABOVE the lintel, not across them. Placed
    # inside the opening they were 0.07 m of hazard trim spanning the full width
    # at z 0.355 and 1.185 -- which would have quietly cut the clear height from
    # 0.90 to 0.73 and put a lip exactly where a duck arrives. A frame that eats
    # the aperture it is framing is the same bug as no aperture.
    P.append(box("athr", (AW+0.16, ft, 0.07), (0, fy, ASILL - 0.050), "hazard"))
    P.append(box("ahead", (AW+0.16, ft, 0.07), (0, fy, AHEAD + 0.050), "hazard"))
    for sx in (-1, 1):
        P.append(box("ajamb", (0.08, 0.045, 0.86), (sx*0.55, -2.21, 0.79), "hazard"))
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
        # Staves overlap so the pail has no vertical slit in it, and they are all
        # spun about Z -- so every neighbouring pair shared a top cap at H and a
        # bottom cap at 0, which is 292 of the model's 708 triangles tied in the
        # depth buffer. alt() takes 3 mm off the odd ones. Geometry elsewhere is
        # untouched to the millimetre: cavity() below is a contract for
        # src/data/tools.js, and the even staves still set minZ, maxZ and both
        # horizontal extremes.
        P.append(box("w%d" % i, (wid, TH, H - alt(i)), (math.sin(a)*rm, math.cos(a)*rm, H/2),
                     "steel_d" if i % 4 == 0 else "blue", rot=(0, 0, -a)))
    P.append(cyl("bot", R-TH, FLOOR, (0, 0, FLOOR/2), "steel_d", verts=N))
    # Obrecze: gorna schowana tuz pod krawedzia, dolna na wysokosci dna - obie
    # WEWNATRZ promienia sciany, zeby bbox zostal kadzia i niczym wiecej.
    ring_xy("rim", R-0.03, N, 0.15, 0.045, 0.05, H-0.03, "hazard", P, sep=0.0015)
    ring_xy("hoop", R-0.03, N, 0.15, 0.04, 0.035, FLOOR+0.03, "steel", P, sep=0.0015)
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
    """Odkurzacz - kanister STOJACY z niska rurka. Sylwetka: "|_".

    SILHOUETTE, NOT DETAIL. vacuum and leaf_blower share a bounding box to the
    tenth of a millimetre -- both rows hard-code 0.25 x ~0.729 x 1.00 in
    src/data/tools.js and FOOTPRINT pins the two horizontal axes -- so the only
    thing that can tell them apart is WHERE THE MASS SITS INSIDE THAT BOX. They
    used to spend it the same way: a horizontal barrel at mid height with a
    grip on top, measured 0.0 px apart at 10 m.

    They now spend it in opposite corners:

      * vacuum  -- one tall canister filling the BACK of the box floor-to-roof,
        and a wand that runs forward at ANKLE height. Front half is empty above
        0.20 m.
      * leaf_blower -- a long thin barrel held HIGH near the roof running the
        whole depth, carried on one slim strut at the back. Front half is empty
        BELOW 0.40 m.

    At 22 px/m that is roughly 9 px of vertical displacement across the front
    half of the outline, and a 10 px wide block vs a 2 px strut at the back.
    Neither difference is trim; both survive at play distance.

    Height is 0.7275 EXACTLY (src/data/tools.js line for `vacuum`), so the
    topmost part is an axis-aligned box whose top face is placed at H by
    construction rather than by whatever a rotated grip happened to reach."""
    H = 0.7275
    P = []
    # --- the canister: one upright block at the back, floor to roof ----------
    P.append(box("skirt", (0.23, 0.46, 0.07), (0, 0.26, 0.035), "steel_d"))
    P.append(box("tank",  (0.25, 0.44, 0.49), (0, 0.26, 0.315), "blue"))
    P.append(box("belt",  (0.255, 0.40, 0.05), (0, 0.26, 0.20), "hazard"))
    P.append(box("lid",   (0.25, 0.46, 0.08), (0, 0.25, 0.60), "steel"))
    # Top face lands on H by construction -- see docstring.
    P.append(box("motor", (0.19, 0.30, 0.175), (0, 0.23, H - 0.0875), "dark"))
    P.append(box("vent",  (0.20, 0.05, 0.11), (0, 0.06, 0.615), "steel_d"))
    # --- the wand: everything forward of the tank stays under 0.20 m ---------
    P.append(cyl("wand", 0.05, 0.40, (0, -0.16, 0.115), "steel_d", verts=8,
                 rot=(math.radians(90), 0, 0)))
    P.append(box("elbow", (0.10, 0.10, 0.13), (0, -0.355, 0.095), "dark"))
    P.append(box("head",  (0.25, 0.15, 0.08), (0, -0.445, 0.04), "dark"))
    P.append(box("lip",   (0.25, 0.04, 0.03), (0, -0.505, 0.015), "hazard"))
    P.append(cyl("hose", 0.055, 0.22, (0, 0.02, 0.145), "rubber", verts=8,
                 rot=(math.radians(72), 0, 0)))
    P.append(box("trig",  (0.06, 0.09, 0.06), (0, -0.10, 0.175), "hazard"))
    return finish(P, "vacuum")


# ============================================================== SWIAT
def b_tube():
    """Masywna rura - przez wylot musi przejsc kontener 2,2 x 4,4 m.

    THE WORST Z-FIGHT IN THE CATALOG, and by a distance: 792 coplanar-overlap
    pairs out of 1296 triangles, 61%, on the one prop a player looks UP at every
    time they buy something. Five rings and an 18-slab shell, every one of them
    built from overlapping boxes that all agreed on a top face and a bottom
    face. The shell's own feet and the plinth shared z = 0 across 2.5 m^2.
    Nothing in the shape was wrong; the idiom was.

    Fixes, in order of how many pairs each removes:
      * ring_xy gained `sep` (the cure ring_yz has had since the crank), so
        alternate segments of the mouth, the three bands and the plinth are
        6 mm shorter and no neighbouring pair shares a plane.
      * The shell's 18 slabs alternate BOTH ends by 12 mm, which kills the two
        biggest clusters (the 144-pair and 54-pair ties at z = 0).
      * The three hazard bands moved off a shared radius onto three different
        ones, so a band can no longer tie with the shell it is strapped to.

    And one thing that is not a bug fix. THE MOUTH IS CASTELLATED: alternate
    segments now stop 0.11 m short of the rim, so the opening reads as a ring of
    teeth against the dark sky instead of as a flat dark disc. That is the only
    part of this model with any pixels on it -- the pipe hangs out of an unlit
    ceiling and src/render/props.js fades the far end away entirely -- so it is
    the only place a change can be seen at all.

    CONTRACT: config.tube.mouthY is 6.33 and is the local height the purchase
    drop is computed from. The mouth ring's EVEN segments still top out at
    exactly H + 0.13 = 6.33; only the odd ones are recessed, so the model's
    maximum, and the rim the drop is aimed at, are unchanged. The shell's own
    18 slabs are also unchanged in radius, so a 2.2 x 4.4 m container still has
    clearance through the throat."""
    P = []
    N, R, H = 18, 1.70, 6.20
    for i in range(N):                      # plaszcz z segmentow, srodek pusty
        a = math.radians(i*360.0/N)
        seg = 2*math.pi*R/N * 1.35
        # Alternating slab ends: even slabs run 0.000 .. 6.200, odd ones
        # 0.012 .. 6.188. The shell is continuous either way -- the bands and
        # the plinth cover the step -- and no two neighbours share a plane.
        z0 = 0.012 if i % 2 else 0.0
        z1 = H - (0.012 if i % 2 else 0.0)
        P.append(box("sh%d" % i, (seg, 0.16, z1 - z0), (math.sin(a)*R, math.cos(a)*R, (z0 + z1)/2),
                     "steel_d", rot=(0, 0, -a)))
    # Castellated mouth: even segments to the 6.33 rim, odd ones recessed.
    for i in range(N):
        a = math.radians(i*360.0/N)
        # even: 6.070 .. 6.330 (the rim config.tube.mouthY names)
        # odd:  6.080 .. 6.220 (recessed 0.11, and not sharing the 6.070 floor)
        odd = i % 2
        z0 = 6.08 if odd else H - 0.13
        z1 = 6.22 if odd else H + 0.13
        P.append(box("mouth%d" % i, (2*math.pi*R/N*1.40, 0.46, z1 - z0),
                     (math.sin(a)*R, math.cos(a)*R, (z0 + z1)/2),
                     "dark", rot=(0, 0, -a)))
    # Three bands on three DIFFERENT radii, so none of them can tie with the
    # shell or with each other.
    for k, z in enumerate((0.90, 2.60, 4.30)):
        RB = R + 0.055 + k*0.006
        ring_xy("band%d" % k, RB, N, 2*math.pi*RB/N*1.40, 0.14, 0.16, z, "hazard", P, sep=0.005)
    # 0.118, not 0.110: at 0.110 the plinth's underside sat on z = 0 with the
    # shell's, which was the 144-pair steel_d/concrete cluster. Lifted 8 mm it
    # overlaps the shell instead of sharing its floor, and the shell alone owns
    # the model's minimum.
    ring_xy("plinth", R + 0.22, N, 2*math.pi*(R+0.22)/N*1.40, 0.50, 0.22, 0.118, "concrete", P,
            sep=0.006)
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
        # 0.25, not 0.26. The upper arm's bottom cap sat at exactly 1.115 and
        # the forearm's top cap at exactly 1.115 -- 50 triangle pairs tied in
        # the depth buffer, and across a MATERIAL boundary (shirt against skin,
        # teal_lt/skin on the vendor and hazard/skin on the avatar), which is the
        # kind that flickers as a colour change rather than as noise. Both caps
        # are buried inside the elbow ball, so pulling the forearm 5 mm short of
        # the joint centre is invisible and breaks the shared plane. Same edit on
        # the shin below, for the same tie at the knee.
        P.append(cyl("armL", 0.055, 0.25, (sx*0.268, 0, 0.980), "skin", verts=9))
        P.append(ball("hand", 0.072, (sx*0.272, -0.005, 0.855), "skin", seg=9, ring_count=6,
                      scale=(0.85, 1.15, 1.0)))
        # noga: biodro -> udo -> kolano -> lydka -> but
        P.append(ball("hip", 0.098, (sx*0.108, 0, 0.855), pants, seg=10, ring_count=7))
        P.append(cyl("legU", 0.078, 0.36, (sx*0.112, 0, 0.675), pants, verts=9))
        P.append(ball("knee", 0.080, (sx*0.114, 0, 0.495), pants, seg=9, ring_count=6))
        P.append(cyl("legL", 0.066, 0.33, (sx*0.114, 0, 0.320), pants, verts=9))
        P.append(box("boot", (0.155, 0.245, 0.115), (sx*0.114, -0.030, 0.0575), boots))
        P.append(ball("ank", 0.070, (sx*0.114, 0.010, 0.135), boots, seg=9, ring_count=6))
    if extra: extra(P)
    return finish(P, name, merge=0.0008)

def b_vendor():
    """Sprzedawca - SYLWETKA inna niz gracza, nie tylko inny kolor.

    THE SHOPKEEPER MUST NOT BE SHAPED LIKE A PLAYER. b_vendor and b_avatar both
    came out of _humanoid with the same rig, the same bounding box and the same
    outline; the only difference was which palette entries went where. At the
    game's real resolution a player 10 m away is about 40 px tall and reads as a
    silhouette and two or three colour blocks -- so "same shape, different
    shirt" means the one character in the game who is NOT a player was
    indistinguishable from every player in it, including in a four-person room
    where three of the figures near the booth are your friends.

    Colour cannot fix that, because colour is what avatars vary between
    THEMSELVES. The outline has to differ, so the vendor gets three additions
    that change what he is at a glance and are legible as blocks:

      * a wide flat-brimmed hat -- the single strongest silhouette cue there is,
        because it breaks the head-on-shoulders profile every avatar shares
      * a full apron that squares off the torso, where an avatar's torso tapers
      * a till and a stack of goods at hip height, so even the lower half reads
        as "person behind a counter"

    Everything is additive: _humanoid is untouched, so the avatar and its rig
    (which src/render/avatars.js drives by named part) cannot be affected.
    Nothing here has a data row -- the vendor is scenery placed by
    src/render/props.js -- so growing the bounding box costs nothing.
    """
    def ex(P):
        # Apron: wider and longer than the old one, and squared at the hem, so
        # the torso block is a rectangle rather than the avatar's tapered vest.
        P.append(box("apron", (0.52, 0.018, 0.62), (0, -0.145, 1.00), "white"))
        P.append(box("apronTie", (0.54, 0.02, 0.06), (0, -0.145, 1.27), "teal"))
        # The hat. It was a 0.52 brim under a 0.31 x 0.16 crown -- brim only 1.7x
        # the crown's width and 5.7x its height, which at 10 m (0.028 m of brim
        # is 0.6 px, below the point where a horizontal line exists at all) read
        # as a stovepipe with a rim, not as a wide-brimmed hat.
        #
        # The ratio is now inverted: brim 0.72 across and 0.05 thick against a
        # crown 0.30 across and 0.085 tall. 0.72 m is 16 px at play distance
        # against a 0.44 m / 10 px shoulder span, and the crown is a low bump
        # rather than a tower, so the head reads as a disc with a lump on it --
        # which is the one thing no avatar's head-on-shoulders profile does.
        P.append(cyl("brim", 0.36, 0.05, (0, -0.005, 1.845), "dark", verts=14))
        P.append(cyl("brimlip", 0.335, 0.075, (0, -0.005, 1.865), "dark", verts=14))
        P.append(cyl("crownH", 0.152, 0.085, (0, -0.005, 1.925), "dark", verts=12))
        P.append(cyl("hatband", 0.160, 0.038, (0, -0.005, 1.898), "teal_lt", verts=12))
        # Till and goods at the counter, which give the lower half a shape of
        # its own. They sit in front of him, where the booth counter is.
        # The till's keypad sinks into its top and the goods stand clear of the
        # apron's back plane -- at -0.20 the crates' rear faces landed within
        # 1 mm of it, which check-coplanar flags and a camera eventually finds.
        P.append(box("till", (0.26, 0.20, 0.16), (0.30, -0.22, 1.05), "steel_d"))
        P.append(box("tillKey", (0.20, 0.13, 0.02), (0.30, -0.22, 1.128), "white"))
        for k in range(3):
            P.append(box("goods%d" % k, (0.13, 0.13, 0.09),
                         (-0.30, -0.245, 0.96 + k*0.10), "duck" if k == 1 else "wood"))
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
    """Latarnia uliczna - dlugi WYSIEGNIK z plaska oprawa. Scenografia, nie wiersz.

    lamp and lamp_post were the same drawing at two scales: dark puck, steel_d
    pole, hazard CONE, white disc. 3.15 m against 2.17 m is real, but a player
    reading an outline reads the top, and both tops were the same cone.

    They are now two different fittings:
      * lamp      -- a 1.05 m cantilever boom with a FLAT SLAB luminaire hanging
        off the end and a stay under it. The top of the outline is a horizontal
        bar offset from the pole, so the whole thing reads as an "L".
      * lamp_post -- a straight pole with a SQUARE LANTERN box and a flat cap.
        No boom, no cone, everything on the axis.

    A 1.05 m offset is 23 px at 10 m, so the two silhouettes do not even
    overlap. lamp has no data row (it is scenery placed by src/render/props.js
    and measures GRID-FAIL both before and after), so its bounding box is free."""
    P = []
    P.append(cyl("base", 0.28, 0.16, (0, 0, 0.08), "dark", verts=10))
    P.append(cyl("pole", 0.085, 2.98, (0, 0, 1.63), "steel_d", verts=8))
    P.append(box("band", (0.19, 0.19, 0.10), (0, 0, 0.90), "hazard"))
    # The boom, and the stay that makes it read as a boom rather than a bar.
    P.append(box("arm", (0.11, 1.05, 0.11), (0, -0.50, 3.06), "steel_d"))
    P.append(box("stay", (0.08, 0.72, 0.08), (0, -0.34, 2.86), "steel_d",
                 rot=(math.radians(-24), 0, 0)))
    # Flat slab luminaire: a long shallow box, NOT a cone.
    P.append(box("head", (0.34, 0.66, 0.11), (0, -0.86, 2.97), "hazard"))
    P.append(box("lens", (0.28, 0.58, 0.045), (0, -0.86, 2.895), "white"))
    P.append(box("hood", (0.36, 0.20, 0.07), (0, -0.60, 3.05), "steel_d"))
    return finish(P, "lamp")

def b_pit_rim():
    """The kerb ring round the pit. LOADED EVERY SESSION AND NEVER DRAWN:
    src/config.js sets `pitRender.showRim = 0` and src/render/props.js only
    builds the mesh `if (pr.showRim ...)`, so this GLB is fetched, parsed and
    kept resident purely so that a config flag can turn it back on.

    It is still referenced from src/ (the manifest row in src/data/index.js, the
    slot in src/main.js, the branch in props.js), so it is NOT mine to delete --
    reported instead. What is mine is what it costs while it waits, and what it
    would look like on the day someone flips the flag. Both were bad:

      * 960 triangles for a decorative kerb. The ring is 3.2 m across, which is
        70 px at play distance; 32 segments put a corner every 2 px, well past
        the point where a circle stops getting rounder. 16 reads identically.
      * 672 of those 960 triangles were in coplanar-overlap pairs -- the worst
        ratio of anything in the set. Two causes, both fixed here: the two
        ring_xy courses had no `sep`, and the dashes sat INSIDE the stripe with
        their underside 0.5 mm off its underside, which is a depth tie across
        the whole band. The dashes now sit ON the stripe.
    """
    P = []
    R, N = 1.60, 16
    # Segments have to overlap or the ring has gaps in it; one and a bit arc
    # lengths is the same proportion the 32-segment version used.
    seclen = 2*math.pi*R/N * 1.09
    ring_xy("kerb", R, N, seclen, 0.30, 0.22, 0.11, "concrete", P, sep=0.0015)
    ring_xy("stripe", R, N, seclen, 0.32, 0.05, 0.245, "hazard", P, sep=0.0015)
    for i in range(0, N, 2):
        a = math.radians(i*360.0/N)
        # Sitting ON the hazard band (its top is 0.27), not buried in it.
        P.append(box("dash%d" % i, (0.20, 0.34, 0.045), (math.sin(a)*R, math.cos(a)*R, 0.2925),
                     "dark", rot=(0, 0, -a)))
    return finish(P, "pit_rim")


# ============================================================== GRACZ
def b_avatar():
    def ex(P):
        # +-0.138, not +-0.132. The torso block's faces are at +-0.125 and the
        # vest is 0.016 thick, so its inner face landed at +-0.124 -- 1 mm INSIDE
        # the shirt, over 0.143 m^2, the largest overlapping tie anywhere in the
        # set and on the one model that is on screen for every player in the room
        # at all times. 0.138 puts the vest 5 mm clear and reads identically: the
        # panel moves 6 mm, which is a seventh of a pixel at play distance.
        P.append(box("vestF", (0.42, 0.016, 0.34), (0, -0.138, 1.17), "orange"))
        P.append(box("vestB", (0.42, 0.016, 0.34), (0,  0.138, 1.17), "orange"))
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
    # The four moving belt surfaces. Each is the CLEATS of the piece named
    # before the suffix and nothing else, authored in that piece's own frame
    # with origin="raw", following the gamble_box / gamble_box_lid pattern:
    # a part that moves independently cannot be inside a joined mesh. Each
    # builder's docstring states its axis, period, phase source and range --
    # those are the numbers the renderer needs and they are not discoverable by
    # measuring, which is why they are written down rather than detected.
    ("conveyor_belt", b_conveyor_belt, "Automatyzacja", "Tasmociag prosty - RUCHOME zebra."),
    ("conveyor_corner_belt", b_conveyor_corner_belt, "Automatyzacja", "Zakret - RUCHOME zebra."),
    ("conveyor_slope_belt", b_conveyor_slope_belt, "Automatyzacja", "Pochylnia - RUCHOME zebra."),
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
    """Duck Hive. H 1.23, footprint 1.00 x 1.00.

    Blob number two in the critic's silhouette pass, and for the same reason as
    the condenser: a stack of boxes with a cone on top is one closed outline. It
    now stands on four legs with 0.19 m of daylight under the bottom super, and
    the supers step OUT as they rise instead of in, so the top edge is a stair
    rather than a taper. The flight board that used to hang off the front is the
    chute's sill.

    Outlet moves from 0.26 to mouth_z(1.23) = 0.554: the middle super, which is
    where the entrance of a real hive is anyway."""
    H, W, D = 1.23, 1.00, 1.00
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("foot", (0.13, 0.13, 0.05), (sx*0.36, sy*0.36, 0.025), "steel_d"))
            P.append(box("leg", (0.08, 0.08, 0.17), (sx*0.36, sy*0.36, 0.10), "dark"))
    P.append(box("stand", (0.90, 0.90, 0.09), (0, 0, 0.225), "dark"))
    # Three supers, each WIDER than the one below: an outline that steps outward
    # cannot be confused with a cone, and this used to be a cone.
    zs = [(0.74, 0.24, 0.39), (0.82, 0.24, 0.62), (0.90, 0.22, 0.845)]
    for i, (w, h, z) in enumerate(zs):
        P.append(box("sup%d" % i, (w, w, h), (0, 0, z), "wood" if i % 2 == 0 else "wood_lt"))
        P.append(box("lip%d" % i, (w + 0.055, w + 0.055, 0.04), (0, 0, z + h/2 - 0.025), "wood_lt"))
    chute(P, H, D, w=0.40, h=0.24, deep=0.20, frame="hazard", jamb="wood_lt")
    P.append(box("roof", (1.00, 1.00, 0.07), (0, 0, 0.995), "steel_d"))
    P.append(cone("cap", 0.46, 0.09, 0.22, (0, 0, 1.12), "hazard", verts=8))
    for sx in (-1, 1):                     # strapping down the flanks
        P.append(box("strap", (0.05, 0.86, 0.05), (sx*0.455, 0, 0.62), "hazard"))
    return finish(P, "hive")

def b_incubator_double():
    """Double Incubator. H 1.30, footprint 1.50 x 1.00.

    This one was wrong in a way no amount of care about the individual doors
    could fix. It had TWO outlets, at x = -0.34 and x = +0.34, and mouthOf() has
    no lateral term at all: both ducks of every emission spawned on the
    CENTRELINE, in the 0.68 m of solid teal panel between them.

    So the machine gets ONE wide opening, 0.86 m across, centred on x = 0 where
    the ducks actually come from, at mouth_z(1.30) = 0.585. The two chambers
    survive as what they always were visually -- two lit glass fronts -- and they
    now sit ABOVE a shared delivery mouth that both of them feed. A player sees
    two doors and one hand-over, which is exactly what the machine does."""
    H, W, D = 1.30, 1.50, 1.00
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.11, 0.11, 0.15), (sx*0.62, sy*0.38, 0.085), "dark"))
            P.append(box("foot", (0.16, 0.16, 0.04), (sx*0.62, sy*0.38, 0.02), "steel_d"))
    P.append(box("base", (1.44, 0.90, 0.13), (0, 0, 0.220), "dark"))
    P.append(box("body", (1.36, 0.84, 0.56), (0, 0, 0.60), "teal"))
    # ONE mouth, on the centreline, wide enough to read as both doors' outlet.
    chute(P, H, D, w=0.86, h=0.28, deep=0.24, jamb="steel_d")
    for sx in (-1, 1):                     # the two chambers, above the mouth
        P.append(box("glass", (0.54, 0.05, 0.34), (sx*0.35, -0.415, 1.02), "glass"))
        P.append(box("frame", (0.62, 0.035, 0.42), (sx*0.35, -0.442, 1.025), "steel_d"))
        P.append(cyl("lamp", 0.055, 0.08, (sx*0.35, -0.44, 1.22), "red", verts=8,
                     rot=(math.radians(90), 0, 0)))
        for i in range(3):
            P.append(box("egg%d" % i, (0.09, 0.09, 0.12), (sx*0.35 - 0.15 + i*0.15, -0.22, 0.98), "white"))
    P.append(box("split", (0.10, 0.82, 0.44), (0, 0, 1.035), "steel_d"))
    P.append(box("upper", (1.30, 0.80, 0.40), (0, 0.06, 1.03), "teal"))
    P.append(box("hood", (1.50, 0.90, 0.13), (0, 0, 1.235), "teal_lt"))
    P.append(box("hoodlip", (1.42, 0.86, 0.04), (0, 0, 1.155), "dark"))
    for i in range(3):
        P.append(box("vent%d" % i, (1.14, 0.05, 0.05), (0, 0.43, 0.52 + i*0.16), "dark"))
    return finish(P, "incubator_double")

def b_press_belt():
    """Belt Press. H 1.50, footprint 1.00 x 2.00.

    The second machine in the set with NO OUTLET GEOMETRY AT ALL. Its belt ran
    the full length at 0.535 and its five ducks per cycle spawned at
    mouth_z(1.50) = 0.675, 14 cm above the belt and 28 cm past the end of it, out
    of clear air.

    The deck rises to 0.70 and ends in a discharge head at 0.675, so the ducks
    come off the belt exactly where the sim puts them -- which is the whole point
    of a machine whose row says it "rolls them off the end". The stamping gantry
    stays astride the belt, and the two metres of open frame under the deck are
    the reason this model already had a decent outline.

    THE RAM IS A SEPARATE MODEL (press_belt_ram.glb); see b_press_belt_ram."""
    H, W, D = 1.50, 1.00, 2.00
    P = []
    L, BW = 1.80, 0.72
    DECK = 0.70
    P.append(box("belt", (BW, L, 0.07), (0, 0.06, DECK), "dark"))
    for i in range(6):
        P.append(box("slat%d" % i, (BW - 0.05, 0.09, 0.04), (0, -0.78 + i*0.29, DECK + 0.045), "steel_d"))
    for sx in (-1, 1):
        P.append(box("side", (0.06, L, 0.16), (sx*(BW/2 + 0.03), 0.06, DECK + 0.03), "hazard"))
        for sy in (-1, 1):                 # open legs: 0.60 m of daylight under
            P.append(box("leg", (0.09, 0.09, 0.62), (sx*(BW/2 - 0.04), sy*0.74 + 0.06, 0.31), "steel"))
            P.append(box("foot", (0.15, 0.15, 0.045), (sx*(BW/2 - 0.04), sy*0.74 + 0.06, 0.0225), "dark"))
    for sx in (-1, 1):                     # longitudinal tie, low down
        P.append(box("tie", (0.05, 1.56, 0.05), (sx*(BW/2 - 0.04), 0.06, 0.22), "dark"))
    P.append(cyl("roll2", 0.10, BW, (0, 0.96, DECK), "steel", verts=10, rot=(0, math.radians(90), 0)))
    # Discharge head at the front, at the spawn height.
    P.append(box("head", (BW + 0.10, 0.26, 0.30), (0, -0.86, 0.66), "steel_d"))
    chute(P, H, D, w=0.44, h=0.26, deep=0.22, jamb="steel")
    # The gantry, astride the belt
    for sx in (-1, 1):
        P.append(box("post", (0.12, 0.16, 0.62), (sx*0.42, 0.16, 1.09), "steel"))
    P.append(box("crown", (1.00, 0.42, 0.18), (0, 0.16, 1.41), "hazard"))
    P.append(box("crownlip", (0.92, 0.48, 0.05), (0, 0.16, 1.305), "dark"))
    for i in range(5):
        P.append(box("die%d" % i, (0.08, 0.08, 0.05), (-0.24 + i*0.12, 0.16, 0.775), "steel_d"))
    P.append(cyl("gauge", 0.08, 0.05, (0, -0.06, 1.41), "white", verts=9, rot=(math.radians(90), 0, 0)))
    return finish(P, "press_belt")

def b_feeder_vibe():
    """Vibratory Feeder. H 1.2602, footprint 1.00 x 1.50.

    The nearest miss in the set: the discharge tongue already sat at 0.572 and
    the simulation spawns at mouth_z(1.2602) = 0.567, so this machine was 5 mm
    out where the Duckomat was 460. But the tongue stopped 66 mm SHORT of the
    footprint's front face, so the duck still appeared in a gap rather than off
    the lip. The tongue now runs out to the face and carries a proper mouth.

    Everything about the trough is kept, including the T() helper that maps
    along-trough coordinates through the same 9 degree rotation as the plate --
    that is what stopped the ribs cutting through the tray the first time."""
    H, W, D = 1.2602, 1.00, 1.50
    P = []
    ang = math.radians(9)
    ZC, LEN, WID = 0.66, 1.30, 0.80
    ca, sa = math.cos(ang), math.sin(ang)

    def T(s, up):
        return (s*ca - up*sa, ZC + s*sa + up*ca)

    y, z = T(0, 0)
    P.append(box("tray", (WID, LEN, 0.05), (0, y, z), "steel", rot=(ang, 0, 0)))
    for sx in (-1, 1):
        y, z = T(0, 0.105)
        P.append(box("side", (0.05, LEN, 0.20), (sx*(WID/2 - 0.025), y, z), "hazard", rot=(ang, 0, 0)))
    for i in range(5):
        y, z = T(-0.48 + i*0.24, 0.045)
        P.append(box("rib%d" % i, (WID - 0.12, 0.05, 0.04), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    y, z = T(LEN/2 - 0.03, 0.12)
    P.append(box("backw", (WID, 0.05, 0.28), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    # The discharge tongue, running FORWARD to the face instead of stopping short
    P.append(box("tongue", (WID - 0.06, 0.16, 0.04), (0, -0.71, 0.585), "hazard"))
    chute(P, H, D, w=0.40, h=0.24, deep=0.18, jamb="steel_d")
    for sx in (-1, 1):
        for s in (-0.44, 0.44):
            yb, zb = T(s, -0.03)
            P.append(cyl("spr", 0.045, zb - 0.16, (sx*0.30, yb, (zb + 0.16)/2), "steel", verts=8))
            P.append(box("pad", (0.13, 0.13, 0.05), (sx*0.30, yb, 0.165), "dark"))
    # Legs, not a slab: the springs need somewhere to stand and the outline needs
    # a gap under it. 0.145 m of daylight, ~3 px at 10 m.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.12, 0.12, 0.145), (sx*0.36, sy*0.52, 0.0775), "dark"))
            P.append(box("foot", (0.18, 0.18, 0.04), (sx*0.36, sy*0.52, 0.02), "steel_d"))
    P.append(box("base", (0.86, 1.20, 0.14), (0, 0, 0.215), "dark"))
    P.append(cyl("motor", 0.13, 0.24, (0, 0.42, 0.42), "orange", verts=10,
                 rot=(0, math.radians(90), 0)))
    P.append(cyl("motorc", 0.09, 0.06, (0.16, 0.42, 0.42), "dark", verts=8,
                 rot=(0, math.radians(90), 0)))
    # THE FEED HOPPER. It owns the height contract (1.2602 exactly) and it is the
    # reason this machine is not another low slab: an open funnel on two legs over
    # the closed end, with 0.30 m of sky between its underside and the trough.
    # That gap is the silhouette -- a bin floating above a tray reads as a feeder,
    # a solid wedge reads as a bench, and the first version of this model was a
    # bench with a lampshade for exactly that reason.
    HH = 1.2602
    for i in range(8):
        a = math.radians(i*45)
        P.append(box("hop%d" % i, (0.30, 0.05, 0.34), (math.sin(a)*0.25, 0.44 + math.cos(a)*0.25,
                                                       HH - 0.2111), "steel_d",
                     rot=(math.radians(20)*math.cos(a), math.radians(-20)*math.sin(a), -a)))
    ring_xy("hoplip", 0.30, 8, 2*math.pi*0.30/8*1.45, 0.10, 0.055, HH - 0.0275, "hazard", P, sep=0.002)
    for sx in (-1, 1):                     # the two legs the hopper stands on
        P.append(box("hopleg", (0.06, 0.06, 0.34), (sx*0.24, 0.44, 0.90), "steel"))
    return finish(P, "feeder_vibe")

def b_slot_machine():
    """Duck Slots. H 1.52, footprint 0.75 x 0.75.

    Payout tray moves from 0.32 to mouth_z(1.52) = 0.684 -- and on a slot machine
    that is not a compromise, it is where the tray belongs: directly under the
    reels, at the height a hand reaches. The cabinet also loses its flat foot and
    gains a raked lower front, so the outline leans.

    THE REELS ARE A SEPARATE MODEL (slot_reels.glb). Origin, axis and travel are
    in b_slot_reels."""
    H, W, D = 1.52, 0.75, 0.75
    P = []
    P.append(box("plinth", (0.70, 0.66, 0.12), (0, 0, 0.06), "dark"))
    P.append(box("cab", (0.62, 0.56, 1.14), (0, 0.02, 0.70), "red"))
    P.append(box("rake", (0.62, 0.16, 0.30), (0, -0.24, 0.36), "red", rot=(math.radians(24), 0, 0)))
    chute(P, H, D, w=0.38, h=0.24, deep=0.20, jamb="steel_d")
    # Reel window, ABOVE the tray. The reels themselves are the separate model;
    # this is the bezel they turn inside, and the recess they sit in.
    P.append(box("recess", (0.50, 0.10, 0.32), (0, -0.235, 1.02), "black"))
    P.append(box("bezel", (0.58, 0.035, 0.40), (0, -0.295, 1.02), "steel_d"))
    for i in range(3):
        P.append(box("btn%d" % i, (0.08, 0.06, 0.05), (-0.15 + i*0.15, -0.30, 0.84), "hazard"))
    P.append(box("marq", (0.68, 0.46, 0.26), (0, -0.02, 1.39), "hazard"))
    P.append(box("marqf", (0.54, 0.05, 0.16), (0, -0.25, 1.39), "white"))
    P.append(box("marqlip", (0.62, 0.50, 0.04), (0, -0.02, 1.275), "dark"))
    P.append(cyl("pivot", 0.05, 0.09, (0.32, -0.02, 1.10), "steel_d", verts=8, rot=(0, math.radians(90), 0)))
    P.append(cyl("lever", 0.03, 0.32, (0.40, -0.02, 1.23), "steel", verts=7, rot=(0, math.radians(30), 0)))
    P.append(ball("knob", 0.065, (0.48, -0.02, 1.36), "hazard", seg=8, ring_count=5))
    return finish(P, "slot_machine")

def b_factory():
    """Duck Factory. H 2.61, footprint 2.50 x 2.00.

    One of the four the critic said already reads -- the sawtooth roof and the
    two chimneys give it a top edge nothing else in the game has -- so the hall,
    the roof and the stacks are kept as they were. The fault was the gate: its
    soffit was at 0.82 and the simulation spawns at mouth_z(2.61) = 1.174, so ten
    ducks every eight seconds came out of the wall 22 cm above the doorway.

    The gate grows to span that height and gains a DISCHARGE BELT at 1.174 that
    runs out of the opening to the footprint's face -- which is both where the
    ducks appear and the only honest way to explain why they appear that far off
    the ground."""
    P = []
    W, D, H = 2.30, 1.72, 1.50
    ZM = 0.45 * 2.61                       # 1.1745
    P.append(box("hall", (W, D, H - 0.04), (0, 0.10, H/2 + 0.02), "steel"))
    P.append(box("plinth", (W + 0.12, D + 0.10, 0.16), (0, 0.10, 0.08), "dark"))
    for i in range(4):
        x = -0.86 + i*0.575
        P.append(box("saw%d" % i, (0.56, D, 0.06), (x, 0.10, H + 0.20), "steel_d",
                     rot=(0, math.radians(-26), 0)))
        P.append(box("sawg%d" % i, (0.05, D - 0.10, 0.24), (x + 0.26, 0.10, H + 0.14), "glass"))
    P.append(box("eave", (W + 0.10, D + 0.08, 0.06), (0, 0.10, H + 0.015), "hazard"))
    for i, x in enumerate((-0.62, 0.58)):
        P.append(cyl("chim%d" % i, 0.15, 0.90, (x, 0.64, H + 0.60), "concrete", verts=10))
        P.append(cyl("chimc%d" % i, 0.19, 0.10, (x, 0.64, H + 1.06), "dark", verts=10))
        P.append(cyl("chimb%d" % i, 0.17, 0.09, (x, 0.64, H + 0.34), "hazard", verts=10))
    # THE GATE, tall enough to contain the spawn height, with the belt in it.
    P.append(box("gate", (0.94, 0.16, 1.14), (0, -D/2 + 0.035, 0.70), "black"))
    P.append(box("gatef", (1.08, 0.05, 1.26), (0, -D/2 - 0.030, 0.70), "hazard"))
    P.append(box("bcase", (0.86, 0.44, 0.30), (0, -D/2 - 0.16, ZM - 0.10), "dark"))
    for i in range(3):
        P.append(box("bsl%d" % i, (0.78, 0.07, 0.035), (0, -D/2 - 0.06 - i*0.13, ZM - 0.24), "steel_d"))
    for sx in (-1, 1):                     # legs under the discharge belt
        P.append(box("bleg", (0.07, 0.07, ZM - 0.26), (sx*0.36, -D/2 - 0.28, (ZM - 0.26)/2), "steel"))
    chute(P, 2.61, 2.00, w=0.56, h=0.34, deep=0.24, yf=-1.02, jamb="steel")
    for sx in (-1, 1):
        for i in range(4):
            P.append(box("win", (0.34, 0.05, 0.30), (-0.78 + i*0.52, 0.10 + sx*(D/2 + 0.005), 1.02), "glass"))
    for i in range(4):
        P.append(box("stripe%d" % i, (0.16, 0.05, 0.30), (-1.05 + i*0.70, -D/2 + 0.100, 0.20), "hazard"))
    P.append(box("sign", (1.06, 0.07, 0.22), (0, -D/2 + 0.045, 1.88), "hazard"))
    return finish(P, "factory")

def b_geyser():
    """Duck Geyser. H 1.0043 EXACTLY (src/data/machines.js), footprint 1.50 x 1.50.

    The most physically absurd of the seventeen. Its only opening faced STRAIGHT
    UP, and the simulation ejects sideways along local +Z -- so thirty ducks an
    eruption, every forty-five seconds, were fired through a solid rock wall.

    The vertical throat stays, because it is the whole silhouette of the thing
    and because an eruption ought to have a crown. What it gains is a BREACH: a
    fissure blown out of the front of the cone at mouth_z(1.0043) = 0.452, ringed
    in blast collar, with a steel spout carrying it out to the footprint's face.
    Now the machine has the hole its ducks actually leave through.

    NOTE ON THE HEIGHT, kept from the previous pass because it is still true: the
    boulders dip to z = -0.0193 and finish() lifts the mesh to minz = 0, so a
    spire authored 1.0043 tall would export at 1.0236. The spires stop at 0.96
    and the collar ring keeps owning the height."""
    P = []
    N, RT, RB, ZT = 12, 0.30, 0.66, 0.86
    slant = math.hypot(RB - RT, ZT)
    tilt = math.atan2(RB - RT, ZT)
    rm = (RT + RB)/2
    for i in range(N):
        a = math.radians(i*360.0/N)
        P.append(box("cone%d" % i, (2*math.pi*rm/N*1.35, 0.10, slant),
                     (math.sin(a)*rm, math.cos(a)*rm, ZT/2), "rust", rot=(-tilt, 0, -a)))
    ring_xy("throat", RT, N, 2*math.pi*RT/N*1.45, 0.14, 0.10, ZT, "steel_d", P, sep=0.0025)
    ring_xy("collar", RT + 0.10, 8, 2*math.pi*(RT+0.10)/8*1.45, 0.12, 0.07, ZT + 0.09, "hazard", P, sep=0.0025)
    ring_xy("plinth", RB + 0.05, 8, 2*math.pi*(RB+0.05)/8*1.40, 0.24, 0.14, 0.07, "concrete", P, sep=0.0025)
    for i, (ad, hh) in enumerate(((28, 0.96), (150, 0.74), (262, 0.56))):
        a = math.radians(ad)
        P.append(box("spire%d" % i, (0.20 - i*0.02, 0.20 - i*0.02, hh - 0.02),
                     (math.sin(a)*0.55, math.cos(a)*0.55, (0.02 + hh)/2), "concrete"))
        P.append(box("spiretip%d" % i, (0.13 - i*0.015, 0.13 - i*0.015, 0.10),
                     (math.sin(a)*0.55, math.cos(a)*0.55, hh - 0.09), "rust"))
    for i in range(4):
        a = math.radians(i*90 + 32)
        P.append(ball("rock%d" % i, 0.15, (math.sin(a)*0.66, math.cos(a)*0.66, 0.10), "concrete",
                      seg=6, ring_count=4, scale=(1.0, 0.85, 0.55)))
    for i in range(3):
        a = math.radians(i*120 + 40)
        P.append(cyl("feed%d" % i, 0.07, 0.42, (math.sin(a)*0.52, math.cos(a)*0.52, 0.30), "steel_d",
                     verts=8, rot=(math.radians(58)*math.cos(a), math.radians(-58)*math.sin(a), 0)))
    # THE BREACH. The spout runs from inside the cone out past the boulders, so
    # it -- not a rock -- is the model's frontmost geometry and the footprint snap
    # lands its lip on the face. yf is passed explicitly because this builder's
    # raw depth is set by the boulder ring, not by D.
    ZM = 0.45 * 1.0043
    P.append(cyl("spout", 0.20, 0.52, (0, -0.55, ZM), "steel_d", verts=10,
                 rot=(math.radians(90), 0, 0)))
    chute(P, 1.0043, 1.50, w=0.34, h=0.28, deep=0.20, yf=-0.82, jamb="steel")
    return finish(P, "geyser", merge=0.001)

def b_pipe_endless():
    """Endless Pipe. H 1.4194, footprint 1.00 x 1.00.

    Another of the four that already read -- a loop of pipe is a hole by
    construction -- so the loop, the column and the plinth are untouched. The
    outlet spur was at 0.50 and the simulation spawns at mouth_z(1.4194) = 0.639,
    so the spur rises 14 cm to meet it and keeps its flare, which is the part a
    player watches the stream come out of."""
    H, W, D = 1.4194, 1.00, 1.00
    P = []
    R, N = 0.40, 16
    ZC = 0.92
    seg = 2*math.pi*R/N*1.40
    for i in range(N):
        a = math.radians(i*360.0/N)
        P.append(box("loop%d" % i, (seg, 0.20, 0.19),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "steel_d", rot=(0, a, 0)))
    for i in range(0, N, 4):
        a = math.radians(i*360.0/N)
        P.append(box("band%d" % i, (seg*0.9, 0.25, 0.06),
                     (math.sin(a)*R, 0, ZC + math.cos(a)*R), "hazard", rot=(0, a, 0)))
    # The spur, at the height the sim ejects from.
    ZM = mouth_z(H)
    NM = 10
    for i in range(NM):
        a = math.radians(i*360.0/NM)
        P.append(box("mouth%d" % i, (2*math.pi*0.19/NM*1.5, 0.32, 0.05),
                     (math.sin(a)*0.19, -0.33, ZM + math.cos(a)*0.19), "steel", rot=(0, a, 0)))
    for i in range(NM):
        a = math.radians(i*360.0/NM)
        P.append(box("mlip%d" % i, (2*math.pi*0.24/NM*1.5, 0.08, 0.09),
                     (math.sin(a)*0.24, -0.46, ZM + math.cos(a)*0.24), "hazard", rot=(0, a, 0)))
    P.append(box("column", (0.26, 0.26, 0.42), (0, 0.02, 0.31), "steel"))
    P.append(box("plinth", (0.86, 0.86, 0.14), (0, 0, 0.07), "dark"))
    P.append(box("hazbase", (0.92, 0.92, 0.05), (0, 0, 0.155), "hazard"))
    return finish(P, "pipe_endless", merge=0.001)

# ================================================== FAZA 1 - GRUPA 2
# Producenci, ktorzy sa czysta danina: producer_auto bez zadnej zmiany w kodzie.
# Roznia ich tylko sekundy i wagi rzadkosci, wiec ROZNICA MUSI BYC W SYLWETCE.
# Trzy ostatnie (drukarka, zlota prasa, reaktor) losuja wylacznie wysokie tiery
# i dlatego chodza w zlocie i turkusie, a nie w stali.

def b_machine_slow():
    """Slow Automat. H 1.315, footprint 1.00 x 1.00.

    Its flywheel is the whole story of the machine and it stays. What goes is the
    0.44 x 0.26 glass panel -- at 10 m that is a 9 x 6 px dark rectangle that
    reads as a SCREEN, and a screen is the one thing this machine has not got --
    and the flat-bottomed box it was painted on. The outlet moves from 0.22 to
    mouth_z(1.315) = 0.592, which is where the simulation has always put the
    duck; the old hatch was 37 cm below it."""
    H, W, D = 1.315, 1.00, 1.00
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("foot", (0.16, 0.16, 0.05), (sx*0.38, sy*0.38, 0.025), "steel_d"))
            P.append(box("leg", (0.10, 0.10, 0.20), (sx*0.38, sy*0.38, 0.115), "dark"))
    P.append(box("base", (0.96, 0.96, 0.14), (0, 0, 0.29), "dark"))
    P.append(box("body", (0.86, 0.86, 0.60), (0, 0, 0.65), "steel"))
    chute(P, H, D)                        # aperture centre z = 0.592
    P.append(box("shoulder", (0.92, 0.92, 0.10), (0, 0, 0.99), "dark"))
    # The stack is OFF-CENTRE and tall enough to break the top edge: at 10 m the
    # difference between this and every other 1 m squat producer is a 3 px pip
    # sticking out of one corner of the outline.
    P.append(cyl("stack", 0.10, 0.30, (-0.28, 0.26, 1.16), "steel_d", verts=8))
    P.append(cyl("stackc", 0.14, 0.06, (-0.28, 0.26, 1.285), "dark", verts=8))
    P.append(box("top", (0.60, 0.60, 0.10), (0.10, -0.06, 1.075), "steel_d"))
    # Flywheel: unchanged in intent, moved 20 mm further out so nothing it passes
    # shares a plane with it, and given a visible connecting rod down to the bed.
    P.append(cyl("fly", 0.30, 0.07, (0.50, 0.06, 0.66), "hazard", verts=14,
                 rot=(0, math.radians(90), 0)))
    P.append(cyl("flyhub", 0.09, 0.17, (0.50, 0.06, 0.66), "dark", verts=9,
                 rot=(0, math.radians(90), 0)))
    for i in range(3):
        P.append(box("spoke%d" % i, (0.05, 0.50, 0.04), (0.495, 0.06, 0.66), "steel_d",
                     rot=(math.radians(i*60), 0, math.radians(90))))
    P.append(cyl("rodarm", 0.04, 0.36, (0.455, -0.14, 0.50), "rust", verts=7,
                 rot=(math.radians(40), 0, 0)))
    for i in range(3):
        P.append(box("vent%d" % i, (0.62, 0.05, 0.05), (0, 0.435, 0.50 + i*0.15), "dark"))
    return finish(P, "machine_slow")

def b_condenser():
    """Condensation Tank. H 1.60, footprint 1.00 x 1.00.

    The critic's silhouette pass put this in the featureless-blob column, and the
    render agrees: a 20 x 32 px capsule with a rounded top, indistinguishable
    from the hive next to it. A tank IS a capsule, so the fix cannot be on the
    tank -- it has to be around it. Two condenser columns now stand clear of the
    shell on stub arms with 60 mm of daylight behind them, and the whole vessel
    sits on a three-legged skirt with 0.20 m of background under it. That turns
    one closed curve into an outline with four holes in it.

    Outlet moves from 0.18 to mouth_z(1.60) = 0.720 -- the sight glass height,
    which is also where the drain valve now points."""
    H, W, D = 1.60, 1.00, 1.00
    P = []
    for i in range(3):
        a = math.radians(i*120 + 30)
        P.append(box("leg%d" % i, (0.09, 0.09, 0.22), (math.sin(a)*0.34, math.cos(a)*0.34, 0.12), "dark"))
        P.append(box("pad%d" % i, (0.15, 0.15, 0.045), (math.sin(a)*0.34, math.cos(a)*0.34, 0.0225), "steel_d"))
    P.append(cyl("skirt", 0.38, 0.16, (0, 0, 0.30), "dark", verts=12))
    P.append(cyl("tank", 0.34, 1.00, (0, 0, 0.86), "teal", verts=12))
    P.append(cone("dome", 0.34, 0.13, 0.24, (0, 0, 1.48), "teal_lt", verts=12))
    for z in (0.52, 0.96, 1.30):
        P.append(cyl("band", 0.365, 0.055, (0, 0, z), "steel_d", verts=12))
    chute(P, H, D, deep=0.22)             # aperture centre z = 0.720
    # Sight glass ABOVE the mouth, small: it is an instrument, not a screen.
    P.append(box("sight", (0.09, 0.05, 0.26), (0, -0.345, 1.06), "glass"))
    P.append(box("level", (0.07, 0.04, 0.10), (0, -0.352, 0.99), "blue"))
    P.append(cyl("hand", 0.10, 0.04, (0.24, -0.30, 0.92), "red", verts=10,
                 rot=(math.radians(90), 0, 0)))
    # THE TWO COLUMNS, standing off the shell on stubs. This is the negative
    # space: 0.06 m of gap either side, ~1.3 px at 10 m of visible daylight, but
    # the OUTLINE gains two vertical bars where it had one smooth curve.
    for sx in (-1, 1):
        P.append(cyl("col", 0.065, 1.02, (sx*0.455, 0.16, 0.86), "steel_d", verts=8))
        P.append(cyl("colc", 0.085, 0.07, (sx*0.455, 0.16, 1.40), "hazard", verts=8))
        for z in (0.56, 1.14):
            P.append(box("stub", (0.10, 0.06, 0.06), (sx*0.395, 0.16, z), "steel"))
    P.append(box("gauge", (0.13, 0.05, 0.13), (0, -0.35, 1.34), "white"))
    return finish(P, "condenser")

def b_duckomat():
    """Duckomat. H 1.78, footprint 1.00 x 0.75.

    The worst outlet in the game: the delivery bin sat at 0.34 and the simulation
    dropped the duck at mouth_z(1.78) = 0.801, FORTY-SIX CENTIMETRES above it. A
    player watching this machine saw a duck materialise beside a closed cabinet,
    half a metre over the tray it was supposed to have rolled into.

    The collection hatch moves up to 0.801, which is where a vending machine's
    hatch belongs anyway -- chest height, not ankle height -- and the stock
    shelves move above it. The cabinet also gets a canopy that oversails the
    front by 0.09 m and legs under it, so its outline is no longer a plain
    upright slab: at 10 m it is 20 x 36 px, and every one of those px used to be
    the same rectangle."""
    H, W, D = 1.78, 1.00, 0.75
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("leg", (0.10, 0.10, 0.17), (sx*0.40, sy*0.27, 0.095), "dark"))
            P.append(box("foot", (0.15, 0.15, 0.045), (sx*0.40, sy*0.27, 0.0225), "steel_d"))
    P.append(box("plinth", (0.98, 0.68, 0.13), (0, 0, 0.245), "dark"))
    P.append(box("cab", (0.92, 0.60, 1.28), (0, 0.02, 0.95), "red"))
    chute(P, H, D, w=0.44, h=0.30, deep=0.22, jamb="steel_d")
    # Stock behind glass, ABOVE the hatch. The glass is 0.62 x 0.62 now instead
    # of 0.62 x 1.10: it is a window with product in it, not a black slab.
    P.append(box("glass", (0.60, 0.05, 0.58), (-0.10, -0.30, 1.28), "glass"))
    P.append(box("frame", (0.68, 0.035, 0.66), (-0.10, -0.325, 1.28), "steel_d"))
    for i in range(2):
        P.append(box("shelf%d" % i, (0.56, 0.30, 0.03), (-0.10, -0.15, 1.09 + i*0.28), "steel_d"))
        for j in range(3):
            P.append(box("stock%d%d" % (i, j), (0.10, 0.10, 0.12),
                         (-0.32 + j*0.22, -0.15, 1.16 + i*0.28), "hazard"))
    P.append(box("keys", (0.15, 0.05, 0.26), (0.30, -0.32, 1.30), "dark"))
    for i in range(4):
        P.append(box("key%d" % i, (0.04, 0.03, 0.04), (0.26 + (i % 2)*0.08, -0.35, 1.36 - (i//2)*0.08), "white"))
    P.append(box("slot", (0.11, 0.04, 0.03), (0.30, -0.335, 1.10), "black"))
    # Canopy: oversails the front, so the top of the outline is a lid rather than
    # the same flat edge the press, the slot machine and the gold press all have.
    P.append(box("head", (1.00, 0.66, 0.15), (0, -0.04, 1.705), "hazard"))
    P.append(box("headlip", (0.94, 0.70, 0.05), (0, -0.03, 1.615), "dark"))
    P.append(box("logo", (0.56, 0.05, 0.09), (0, -0.36, 1.705), "white"))
    return finish(P, "duckomat")

def b_hatchery():
    """Hatchery. H 0.855, footprint 1.25 x 1.00.

    The only outlet in the set the critic could not fault -- 1.5 cm out -- so the
    job here is the other half: at 10 m this is a 26 x 19 px lozenge, the flattest
    thing in the catalog, and its own row sells it as "low enough to sit under a
    belt". Low is the point, so the silhouette has to earn its keep sideways
    instead of upward: the cloche is now an open A-frame with a real gap between
    its glazing bars, and the bed is carried on end frames with daylight beneath.

    The mouth is pinned to mouth_z(0.855) = 0.385 by construction rather than by
    coincidence."""
    H, W, D = 0.855, 1.25, 1.00
    P = []
    for sx in (-1, 1):                     # end frames, open between them
        P.append(box("endf", (0.10, 0.86, 0.20), (sx*0.555, 0.02, 0.10), "dark"))
        P.append(box("skid", (0.16, 0.94, 0.045), (sx*0.555, 0.02, 0.0225), "steel_d"))
    P.append(box("bed", (1.14, 0.80, 0.13), (0, 0.02, 0.255), "steel"))
    P.append(box("pad", (0.96, 0.66, 0.045), (0, 0.04, 0.335), "orange"))
    chute(P, H, D, w=0.42, h=0.24, deep=0.20, jamb="steel_d")
    for i in range(4):                     # eggs on the plate
        P.append(ball("egg%d" % i, 0.070, (-0.27 + i*0.18, 0.12, 0.395), "white",
                      seg=8, ring_count=5, scale=(1.0, 1.0, 1.25)))
    # OPEN cloche: two glazing bars a side with sky between them, not a shell.
    for sx in (-1, 1):
        for i, yy in enumerate((-0.14, 0.30)):
            P.append(box("bar", (0.05, 0.07, 0.40), (sx*0.44, yy, 0.60), "glass",
                         rot=(0, math.radians(sx*17), 0)))
    P.append(box("paneb", (0.94, 0.05, 0.40), (0, 0.40, 0.60), "glass",
                 rot=(math.radians(-14), 0, 0)))
    P.append(box("ridge", (1.02, 0.74, 0.05), (0, 0.04, 0.805), "teal"))
    P.append(box("rlip", (1.10, 0.82, 0.035), (0, 0.04, 0.8375), "hazard"))
    P.append(cyl("heat", 0.045, 0.84, (0, 0.32, 0.72), "red", verts=8, rot=(0, math.radians(90), 0)))
    P.append(box("panel", (0.18, 0.06, 0.10), (0.42, -0.44, 0.30), "hazard"))
    return finish(P, "hatchery")

def b_printer3d():
    """Duck Printer. H 1.285, footprint 1.00 x 1.00.

    One of the four models the critic said already reads, and it reads for the
    stated reason: it is an OPEN PORTAL, so its outline has a hole through the
    middle. Nothing structural changes. What changes is the outlet, which sat at
    0.16 while the simulation spawned at mouth_z(1.285) = 0.578 -- 42 cm up, and
    on this machine that put the duck level with the print bed rather than with
    the hatch under it.

    So the bed rises to meet the number: the printed duck now leaves through a
    hatch in the front apron directly below the nozzle, at 0.578, and the bed
    sits at 0.72 where the head can reach it."""
    H, W, D = 1.285, 1.00, 1.00
    P = []
    P.append(box("base", (1.00, 0.94, 0.17), (0, 0, 0.085), "dark"))
    P.append(box("hazb", (0.94, 0.88, 0.045), (0, 0, 0.1875), "hazard"))
    P.append(box("apron", (0.86, 0.72, 0.50), (0, 0.06, 0.45), "steel_d"))
    chute(P, H, D, w=0.38, h=0.26, deep=0.22, jamb="steel")
    P.append(box("bed", (0.62, 0.62, 0.04), (0, 0.02, 0.72), "teal_lt"))
    P.append(box("bedr", (0.68, 0.68, 0.03), (0, 0.02, 0.695), "steel_d"))
    for sx in (-1, 1):                     # portal, open right through
        P.append(box("colf", (0.07, 0.07, 0.56), (sx*0.42, -0.42, 0.97), "steel"))
        P.append(box("colb", (0.07, 0.07, 0.56), (sx*0.42, 0.42, 0.97), "steel"))
        P.append(box("beamy", (0.06, 0.90, 0.06), (sx*0.42, 0, 1.22), "steel_d"))
    P.append(box("beamx", (0.90, 0.09, 0.09), (0, 0.10, 1.24), "hazard"))
    P.append(box("beamf", (0.90, 0.06, 0.06), (0, -0.42, 1.215), "steel_d"))
    P.append(box("carriage", (0.22, 0.16, 0.13), (0.06, 0.10, 1.155), "orange"))
    P.append(cone("nozzle", 0.065, 0.02, 0.12, (0.06, 0.10, 1.035), "steel_d", verts=8))
    P.append(box("post", (0.05, 0.05, 0.24), (0.06, 0.10, 0.86), "duck"))
    P.append(cyl("spool", 0.15, 0.05, (0.30, 0.46, 1.00), "duck", verts=12, rot=(math.radians(90), 0, 0)))
    P.append(cyl("spoolh", 0.05, 0.10, (0.30, 0.46, 1.00), "dark", verts=8, rot=(math.radians(90), 0, 0)))
    P.append(box("skinb", (0.80, 0.04, 0.50), (0, 0.415, 0.98), "glass"))
    P.append(box("panel", (0.22, 0.05, 0.10), (-0.24, -0.445, 0.90), "teal"))
    return finish(P, "printer3d")

def b_press_gold():
    """Gold Press. H 1.645 EXACTLY (src/data/machines.js hard-codes it),
    footprint 1.00 x 0.75.

    The stepped tower stays: it is what stops this reading as the plain press
    with different paint, and the critic's silhouette pass agreed it works. The
    defect is the outlet, which sat at 0.22 while the simulation spawned at
    mouth_z(1.645) = 0.740 -- 38 cm apart, so the gold ducks appeared level with
    the machine's waist and the hatch below them never opened on anything.

    The recess, the ram and the anvil all move to that height, which puts the
    working face where a player standing in front of it is already looking, and
    the mouth is the anvil's own outfeed.

    THE RAM IS A SEPARATE MODEL (press_gold_ram.glb); see b_press_gold_ram."""
    H, W, D = 1.645, 1.00, 0.75
    P = []
    P.append(box("plinth", (0.98, 0.72, 0.13), (0, 0, 0.065), "dark"))
    P.append(box("bed", (0.90, 0.64, 0.14), (0, 0, 0.18), "steel_d"))
    P.append(box("body", (0.84, 0.58, 0.81), (0, 0, 0.625), "dark"))
    P.append(box("shoulder", (0.94, 0.66, 0.17), (0, 0, 1.085), "dark"))
    P.append(box("step2", (0.76, 0.54, 0.18), (0, 0, 1.23), "duck"))
    P.append(box("step3", (0.56, 0.42, 0.18), (0, 0, 1.38), "dark"))
    P.append(box("cap", (0.38, 0.30, H - 1.44), (0, 0, (1.44 + H)/2), "duck"))
    # The working face, sunk into the tower AT the spawn height.
    P.append(box("recess", (0.62, 0.11, 0.60), (0, -0.305, 0.94), "black"))
    P.append(box("anvil", (0.54, 0.17, 0.08), (0, -0.325, 0.905), "duck"))
    chute(P, H, D, w=0.36, h=0.24, deep=0.18, frame="duck", jamb="duck")
    for sx in (-1, 1):                     # gold inlays on the tower edges
        P.append(box("inlay", (0.05, 0.60, 0.80), (sx*0.415, 0, 0.64), "duck"))
    P.append(cyl("gauge", 0.09, 0.05, (0, -0.345, 1.30), "white", verts=10,
                 rot=(math.radians(90), 0, 0)))
    return finish(P, "press_gold")

def b_reactor():
    """Rarity Reactor. H 1.53, footprint 1.50 x 1.50.

    Outlet moves from 0.24 to mouth_z(1.53) = 0.689, which happens to be the core
    height -- so the machine now hands the duck out of the glowing part rather
    than out of a box below it, and the six cooling rods get a gap cut in the
    front pair for it to pass through. The rod cage was already the best thing
    about this model's outline and it is left alone."""
    H, W, D = 1.53, 1.50, 1.50
    P = []
    N = 10
    P.append(cyl("vessel", 0.42, 1.10, (0, 0, 0.72), "teal", verts=N))
    P.append(cone("dome", 0.42, 0.16, 0.26, (0, 0, 1.40), "teal_lt", verts=N))
    P.append(cyl("skirt", 0.52, 0.20, (0, 0, 0.10), "dark", verts=N))
    P.append(cyl("core", 0.20, 0.60, (0, 0, 0.72), "duck", verts=8))
    for i in range(4):
        a = math.radians(i*90 + 45)
        P.append(box("slit%d" % i, (0.14, 0.06, 0.50), (math.sin(a)*0.42, math.cos(a)*0.42, 0.72),
                     "duck", rot=(0, 0, -a)))
    for z in (0.34, 1.02):
        ring_xy("band", 0.45, 8, 2*math.pi*0.45/8*1.45, 0.10, 0.07, z, "hazard", P, sep=0.0025)
    # Rods, with the front pair pulled aside so the mouth has a clear run out.
    for i in range(6):
        a = math.radians(i*60 + 30)
        P.append(cyl("rod%d" % i, 0.055, 1.30, (math.sin(a)*0.62, math.cos(a)*0.62, 0.68), "steel", verts=6))
        P.append(cyl("rodc%d" % i, 0.075, 0.09, (math.sin(a)*0.62, math.cos(a)*0.62, 1.36), "hazard", verts=6))
    ring_xy("plinth", 0.66, 8, 2*math.pi*0.66/8*1.40, 0.22, 0.12, 0.06, "concrete", P, sep=0.0025)
    P.append(box("duct", (0.46, 0.30, 0.34), (0, -0.60, 0.689), "dark"))
    chute(P, H, D, w=0.34, h=0.26, deep=0.20)
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
    # Steel bed, not teal. Teal is the vendor's colour and the slide is not a
    # shop; a bright teal chute in the middle of the plate was one of the things
    # competing with the actual objective for the eye.
    P.append(box("bed", (0.84, L, 0.06), (0, y, z), "steel", rot=(ang, 0, 0)))
    for sx in (-1, 1):
        y, z = T(0, 0.13)
        P.append(box("side", (0.06, L, 0.26), (sx*0.42, y, z), "hazard", rot=(ang, 0, 0)))
    for i in range(6):                      # przetloczenia dna
        y, z = T(-1.20 + i*0.48, 0.035)
        P.append(box("rib%d" % i, (0.74, 0.05, 0.02), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    # A-FRAMES, not single pins on the centreline.
    #
    # THE BED, ITS ANGLE, ITS LENGTH AND ITS HEIGHT ARE FROZEN: src/data/
    # buildings.js `slide` carries slope.rise 0.706 / run 2.90 and a
    # collider.surface of half [0.4667, 0.06, 1.4917] at -13.7 degrees, all
    # measured off this mesh, and the row is not mine to edit. So every literal
    # above this line is untouched and the change is entirely in the legs.
    #
    # Four single 0.09 posts standing on the model's centreline is the worst
    # possible support for a 3 m object: from the side they hide behind each
    # other into one smear, and from the front they are a single 2 px line under
    # a 22 px trough, so the slide read as a chute lying on the floor. Splayed
    # pairs put two diagonals and a triangle of daylight under every station,
    # and they get WIDER as they get taller, which is what makes the descent
    # readable from the front as well as the flank.
    # The legs stay EXACTLY floor-to-bed, spanning 0 .. zb with no tilt, and
    # that is not laziness -- it is the height contract. finish() reports
    # max_z - min_z, so a leg tilted by even 8 degrees lifts its own foot 3 mm
    # off the floor, the model's minimum becomes 3 mm and its stated height
    # drops from the 1.4546 that src/data/buildings.js `slide` was measured
    # against. The splay is done with POSITION, and the diagonal the eye wants
    # is a separate brace between the pair.
    for i, s in enumerate((-1.20, -0.30, 0.60, 1.32)):   # nogi malejace ku przodowi
        yb, zb = T(s, -0.03)
        spl = 0.10 + 0.20 * (zb / 1.30)     # splay grows with the leg's height
        for sx in (-1, 1):
            P.append(box("leg%d%d" % (i, sx), (0.075, 0.075, zb), (sx*spl, yb, zb/2), "steel"))
        P.append(box("vee%d" % i, (2*spl + 0.08, 0.055, 0.055), (0, yb, zb*0.30), "steel_d",
                     rot=(0, math.radians(9), 0)))
        P.append(box("tie%d" % i, (2*spl + 0.08, 0.055, 0.055), (0, yb, zb*0.68), "steel_d"))
    y, z = T(-L/2 - 0.05, 0.03)             # jezyk zjazdu przy podlodze
    P.append(box("lip", (0.80, 0.18, 0.04), (0, y, z), "hazard", rot=(ang, 0, 0)))
    y, z = T(L/2 - 0.02, 0.16)              # sciana na szczycie
    P.append(box("back", (0.84, 0.05, 0.34), (0, y, z), "steel_d", rot=(ang, 0, 0)))
    return finish(P, "slide")

def b_fan_strong():
    """Wiatrak mocny - KWADRATOWA obudowa kanalowa na plozie, nie tarcza na slupie.

    fan, fan_strong and fan_handheld were one shape at three scales: a round
    cage with a hub in it, on a pole, on a round base. 1.25 x 1.63 against
    1.50 x 1.88 is five pixels of difference at 10 m in each direction, on an
    outline the eye has already learnt -- so the eye reads "fan" and stops.

    So the family is now three CLASSES rather than three sizes:
      * fan          -- round cage on a tall thin pole, weight at the top.
        (unchanged; it is the reference the other two are read against)
      * fan_strong   -- a SQUARE ducted housing sitting on a low sled. The
        outline is a rectangle standing on the floor; there is no pole and no
        circle anywhere in it.
      * fan_handheld -- a small head on a stem over a wide flat plate, cage
        deleted so it cannot read as a miniature of either.

    A 1.44 m square against a 1.16 m circle on a 0.18 m stick is not a size
    difference; the void either side of fan's pole is about 12 px wide and
    fan_strong simply does not have it.

    Height is 1.8811 EXACTLY (src/data/buildings.js `fan_strong`), owned by the
    hazard cap, an axis-aligned box placed at H by construction."""
    H = 1.8811
    ZC = 1.00                               # rotor axis, centred in the duct
    P = []
    P.append(box("tread", (1.48, 0.98, 0.05), (0, 0.06, 0.025), "dark"))
    P.append(box("sled", (1.44, 0.92, 0.19), (0, 0.05, 0.135), "steel_d"))
    # The duct: four slabs making a square frame, 1.44 across. Every slab is a
    # different size on every axis on purpose -- butting them flush is what
    # tools/check-coplanar.py exists to catch, and a 1.44 x 1.60 pair of
    # coincident faces is the biggest z-fight the catalog could contain.
    for sx in (-1, 1):
        P.append(box("jamb", (0.14, 0.44, 1.60), (sx*0.65, 0.02, ZC), "steel"))
    # Sill and lintel are LOUVRED now, not slabs: five fins each, with air
    # between them. Same outline, but the two 1.24 x 0.40 blanks that used to
    # cap the duct top and bottom are 10 px of solid steel each at 10 m, and
    # they were the only closed part of a machine whose entire selling point is
    # that it moves air. Holes read; surface detail does not.
    for sz in (-1, 1):
        P.append(box("rail%d" % sz, (1.24, 0.40, 0.055), (0, 0.035, ZC + sz*0.775), "steel"))
        for i in range(5):
            # Alternating span. Five fins stacked 30 mm apart overlap each other
            # in projection once they are tilted, so a shared pair of end faces
            # at x = +-0.59 is 48 coplanar pairs -- the whole of this model's
            # regression when the louvres went in. 12 mm of alternation is
            # 0.26 px at play distance and removes all 48.
            P.append(box("fin%d%d" % (sz, i), (1.18 - (0.012 if i % 2 else 0.0), 0.34, 0.035),
                         (0, 0.035, ZC + sz*(0.670 + i*0.030)), "steel_d",
                         rot=(math.radians(18 if sz > 0 else -18), 0, 0)))
    P.append(box("cap", (1.50, 0.52, H - 1.76), (0, 0.02, (1.76 + H)/2), "hazard"))
    # Rotor inside the square opening (z 0.36 .. 1.64, so r <= 0.64).
    P.append(cyl("hub", 0.19, 0.26, (0, 0, ZC), "orange", verts=10, rot=(math.radians(90), 0, 0)))
    for i in range(5):
        a = math.radians(i*72 + 18)
        P.append(box("blade%d" % i, (0.22, 0.06, 0.52),
                     (math.sin(a)*0.32, 0, ZC + math.cos(a)*0.32), "hazard",
                     rot=(math.radians(24), a, 0)))
    # THE MOTOR IS A CYLINDER, AND THAT IS A SAFETY PROPERTY, NOT A STYLE ONE.
    #
    # src/render/rotor.js groups congruent parts by (triangle count, surface
    # area within 0.2%) and then asks whether a group is a ring about the blow
    # axis. The old motor was a 0.24 m CUBE: 12 triangles, area 0.290, against a
    # blade's 12 triangles and area 0.295. Twelve equals twelve and 1.7% is not
    # much of a margin -- the file's own comment records that at the previous
    # 2% tolerance the motor joined the five blades, the six of them were not
    # evenly spaced, the group was rejected and the fan span its CAGE.
    #
    # A tolerance is a number somebody can retune. A triangle count is not: an
    # 8-gon cylinder bakes 28 triangles and a box bakes 12, so this motor can
    # never enter the blades' bucket whatever anyone does to AREA_TOLERANCE.
    # The area margin is kept wide as a second, independent line of defence --
    # measured on the exported mesh by tools/check-rotor.py, reported with this
    # pass, not guessed from these literals (finish() rescales x and y).
    P.append(cyl("motor", 0.155, 0.30, (0, 0.34, ZC), "steel_d", verts=8,
                 rot=(math.radians(90), 0, 0)))
    # Corner gussets: they square the outline off further and stop the frame
    # reading as an arch.
    for sx in (-1, 1):
        for sz in (-1, 1):
            P.append(box("gus", (0.20, 0.36, 0.20), (sx*0.55, 0.045, ZC + sz*0.62), "steel_d"))
    return finish(P, "fan_strong")

def b_fan_vertical():
    """Wiatrak pionowy - dmucha W GORE. Otwarty kosz, nie stolik.

    Three fixes, all of them about the same thing -- this piece had no hole in
    it below the grille, so at 10 m it was a 22 px slab on a 22 px slab and read
    as a little table rather than as a machine pointing at the sky.

    1. THE SOLID DISC BASE IS GONE. A 0.84 m plate plus a 0.84 m hazard square
       stacked on it was the widest, flattest, most closed thing in the model.
       It is now a three-armed foot: same three struts, carried down to three
       separate pads, with floor visible between them.
    2. THE OUTLET FLARES. The grille sits on a cone that opens upward, so the
       outline says "up" from the side as well as from above -- which is the one
       fact that distinguishes this fan from the other two and was previously
       carried only by four little bars you cannot resolve at play distance.
    3. THE CAGE RING NO LONGER Z-FIGHTS. ring_xy stacked 14 overlapping boxes
       at one height, so all 28 of their top and bottom faces sat in two shared
       planes: 64 coplanar-overlap pairs. `sep` alternates the section height.

    Height is 0.895 (src/data/buildings.js `fan_vertical`), owned by the four
    outlet bars at z 0.88 + 0.015. Nothing else reaches it.

    ROTOR SAFETY: the axis here is local +Y (blow.pitchDegrees 90), so the rotor
    plane is the FLOOR plane. Congruent groups in it are the 4 blades at radius
    0.22, the 3 struts at 0.36 and the ring's two 7-part groups at 0.40, and
    detectRotor takes the closest -- the blades. The outlet bars are four
    PARALLEL bars in a row, not a ring: their radii from their own centroid are
    0.27, 0.09, 0.09, 0.27, so rotorFit rejects them on RADIUS_TOLERANCE before
    it ever gets to spacing. That is why they were not made radial."""
    P = []
    # Trojnozna stopa: trzy ramiona zamiast talerza, podloga widoczna miedzy nimi.
    for i in range(3):
        a = math.radians(i*120)
        sx_, sy_ = math.sin(a), math.cos(a)
        P.append(box("arm%d" % i, (0.13, 0.46, 0.07), (sx_*0.21, sy_*0.21, 0.035), "dark",
                     rot=(0, 0, -a)))
        P.append(box("pad%d" % i, (0.22, 0.12, 0.05), (sx_*0.42, sy_*0.42, 0.025), "hazard",
                     rot=(0, 0, -a)))
        P.append(box("strut%d" % i, (0.07, 0.07, 0.70), (sx_*0.36, sy_*0.36, 0.37), "steel"))
    P.append(cyl("stem", 0.12, 0.66, (0, 0, 0.35), "steel_d", verts=8))
    ring_xy("ring", 0.40, 14, 0.20, 0.11, 0.11, 0.72, "steel", P, sep=0.006)
    P.append(cyl("hub", 0.15, 0.20, (0, 0, 0.72), "orange", verts=10))
    for i in range(4):                      # lopatki w plaszczyznie POZIOMEJ
        a = math.radians(i*90 + 20)
        P.append(box("blade%d" % i, (0.16, 0.34, 0.05),
                     (math.sin(a)*0.22, math.cos(a)*0.22, 0.72), "hazard",
                     rot=(math.radians(26), 0, -a)))
    # Wylot ROZSZERZAJACY SIE ku gorze - stozek, nie plaski krazek.
    # HAZARD, not steel_d. The outlet is the one part of this fan that says
    # which way it blows, and a grey cone on a grey stem said it to nobody at
    # 22 px -- the first version of this rework came out reading as a dark H.
    # Powered orange is the palette's word for "this moves air", and putting it
    # on the widest, highest, most sky-facing surface is the only way a 0.895 m
    # object gets a colour statement at all.
    P.append(cone("flare", 0.34, 0.46, 0.13, (0, 0, 0.825), "hazard", verts=14))
    for i in range(4):                      # krata wylotu - widac, ze dmucha w gore
        P.append(box("bar%d" % i, (0.78, 0.05, 0.03), (0, -0.27 + i*0.18, 0.88), "hazard"))
    return finish(P, "fan_vertical", merge=0.001)

def b_vibe_floor():
    """Wibrator podlogowy - tasmociag o ZEROWEJ wysokosci. Plaski collider.

    The hardest model in the set to make read, and the reason is arithmetic: at
    10 m the whole piece is 44 x 22 px and only 3 px TALL. There is no
    silhouette to win with, so this one has to be won on plan-view shape and
    value contrast, which are the only two channels a 3 px object has.

    What changed:
      * Height owned by two things that are 0.1412 m tall and axis-aligned -- the
        side kerbs and the two end drums -- rather than by an 8-gon motor's
        outermost vertex, which is a number nobody could predict and which meant
        the model's stated height was luck.
      * The plate now runs the FULL 2.00 m and the kerbs the full 1.00, so every
        extreme is a flat face and finish()'s snap factor is exactly 1.0 on both
        axes. That is what lets vibe_floor_belt share this frame with
        origin="raw".
      * The ribs moved out into vibe_floor_belt and now TRAVEL. On a piece this
        flat, motion is the only channel with any pixels in it at all, and the
        row already carries the speed that drives it.
      * Alternating hazard and steel ribs, so the travel is legible as movement
        rather than as shimmer: a two-value pattern moving past a fixed kerb.

    Height 0.1412 EXACTLY (src/data/buildings.js `vibe_floor`, collider half[1]
    0.0706). The rib tops are that same 0.1412, so ducks ride ON the ribs."""
    L, W, H = 2.00, 0.90, 0.1412
    P = []
    # 84 triangles, so a shared plane here costs a bigger FRACTION of the model
    # than anywhere else in the set -- a first pass had the plate, both kerbs,
    # both drums and both shoes all standing on z = 0 and all agreeing on
    # x = +-0.45 and z = +-1.00, which is 64 pairs out of 84 triangles, 76%.
    # Ownership: the plate owns z = 0 and x = +-0.45, the kerbs own x = +-0.50
    # and z = +-1.00 and y = 0.1412, and the drums stop short of all of them.
    P.append(box("plate", (W, L, 0.07), (0, 0, 0.035), "steel_d"))
    for sx in (-1, 1):                      # krawezniki - kaczka je przejezdza
        # 0.001 .. 0.1412: the kerbs, and only the kerbs, own the stated height.
        P.append(box("edge", (0.044, L, H - 0.001), (sx*0.478, 0, 0.001 + (H - 0.001)/2), "hazard"))
    for sy in (-1, 1):                      # bebny koncowe - miedzy nimi biegna zebra
        P.append(box("drum", (0.88, 0.095, H - 0.006), (0, sy*0.9475, 0.002 + (H - 0.006)/2), "orange"))
        P.append(box("shoe", (0.84, 0.16, 0.055), (0, sy*0.82, 0.004 + 0.0275), "dark"))
    return finish(P, "vibe_floor")


def b_vibe_floor_belt():
    """The MOVING half of `vibe_floor`: eight ribs, alternating hazard/steel.

    HOW IT MOVES (same contract as conveyor_belt):
      travel axis  local +Z.
      period       0.22 m.
      phase        (distance travelled) mod 0.22, distance being the integral of
                   the row's belt.speed (1.0 m/s -- this is the slow one).
      range        ribs sit at z = -0.88 + k*0.22 for k = 0..7, spanning
                   -0.88 .. +0.66; a phase in [0, 0.22) keeps the leading rib
                   at or under +0.88, which is where the end drum starts.
    Rib tops are at 0.1412, which is collider.half[1] * 2 on the row: the duck
    rides on the ribs, and the ribs are the part that moves.

    origin="raw", and here it is exactly safe: b_vibe_floor's plate and kerbs
    are axis-aligned at +-1.00 and +-0.50, so its snap factor is 1.0 on both
    axes and these coordinates survive unscaled."""
    H = 0.1412
    P = []
    for k in range(8):
        P.append(box("rib%d" % k, (0.80, 0.09, 0.085), (0, -0.88 + k*0.22, H - 0.0425),
                     "hazard" if k % 2 else "steel"))
    return finish(P, "vibe_floor_belt", origin="raw")

def b_platform():
    """Podest - plaski poziom 2x2 na czterech nogach. Kaczki po nim chodza.

    THE DECK IS AN OPEN GRATING NOW, not a plate with bars laid on top of it.

    That fixes the worst z-fight in my set by area: the deck's top face at
    y 0.600 and the grating bars' bottom faces at the same y 0.600 were 28
    coplanar-overlap pairs covering 2.08 m^2 -- a depth tie the size of the
    whole platform, on a surface the player stands on and looks straight down
    at. Sinking the bars into the deck would have fixed the tie and kept a
    closed slab; opening the deck fixes it AND buys the silhouette something.

    Nine bars with 6 cm of air between them means you see the floor through the
    deck. At 10 m that is a 44 px square of stripes rather than a 44 px square
    of flat grey, which is what separates a platform from the ice slab and the
    roof -- the other two 2 x 2 flat things in the catalog.

    TWO CONTRACTS, both exact by construction:
      deck top     0.60 -- src/data/buildings.js `platform` puts its physics
                   surface there (collider.surface offsetY 0.235 on a box whose
                   centre is at 0.315). The bar tops are that 0.60.
      height       0.63 -- owned by the four corner posts, which now stand
                   3 cm proud of the deck as bollards. Previously the height was
                   owned by the grating, so opening it up would have changed the
                   model's stated size; a post that means to be the tallest
                   thing is a better owner than a texture detail that happens
                   to be."""
    P = []
    # Rama pokladu: cztery belki obwodowe, srodek OTWARTY.
    # Deck plane 0.60 is shared by the two X-beams and the nine bars, so those
    # two families must not OVERLAP in plan or their top faces are a depth tie:
    # the bars stop at +-0.83 and the beams' inner faces are at 0.84. The
    # Y-beams duck 5 mm under the plane instead, which is the same trick where
    # a gap would have shown.
    for sx in (-1, 1):
        # beamX owns the 0.60 deck plane and beamY ducks 5 mm under it; beamY is
        # also 0.12 wide against beamX's 0.13, so the two cannot share a flank
        # where they cross at the corners either.
        P.append(box("beamX", (1.94, 0.13, 0.13), (0, sx*0.900, 0.535), "steel"))
        P.append(box("beamY", (0.12, 1.92, 0.12), (sx*0.900, 0, 0.535), "steel"))
    for i in range(9):                      # kraty pokladu - z przeswitem
        P.append(box("gr%d" % i, (1.66, 0.14, 0.09), (0, -0.76 + i*0.19, 0.555), "steel_d"))
    for i in range(3):                      # belki nosne pod krata
        P.append(box("joist%d" % i, (0.10, 1.70, 0.11), (-0.60 + i*0.60, 0, 0.50), "steel"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            # The feet alone touch z = 0; the legs start 0.02 above them.
            P.append(box("leg", (0.12, 0.12, 0.53), (sx*0.84, sy*0.84, 0.285), "steel"))
            P.append(box("foot", (0.20, 0.20, 0.05), (sx*0.84, sy*0.84, 0.025), "dark"))
            # Bollard: 3 cm proud of the deck, and the owner of the 0.63 height.
            # Its underside is at 0.48, clear of the beams' 0.47.
            P.append(box("boll", (0.14, 0.14, 0.15), (sx*0.84, sy*0.84, 0.555), "hazard"))
        P.append(box("braceX", (1.72, 0.07, 0.07), (0, sx*0.84, 0.20), "steel_d"))
        P.append(box("braceY", (0.065, 1.72, 0.065), (sx*0.84, 0, 0.205), "steel_d"))
    # noseY owns x = +-1.00 and nose owns z = +-1.00, so the two do not meet on
    # a plane at the corners; and both sit 5 mm under the deck so neither can
    # tie with beamX's 0.60.
    for sx in (-1, 1):
        P.append(box("nose", (1.90, 0.06, 0.055), (0, sx*0.97, 0.5660), "hazard"))
        P.append(box("noseY", (0.06, 1.94, 0.050), (sx*0.97, 0, 0.5700), "hazard"))
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
    #
    # THE STEPS ARE NO LONGER NESTED SOLIDS, and that is a z-fighting fix worth
    # 91 of this model's 123 coplanar-overlap pairs -- the most of anything in
    # the transport set except the tube.
    #
    # Four boxes all standing on z = 0 and all 0.94 wide share three planes
    # exactly: the floor, and both flanks. Every pair of them therefore overlaps
    # in three places at gap zero, and the biggest single cluster was 5.18 m^2
    # of coincident UNDERSIDE. It never flickered in a screenshot because the
    # inner faces are hidden -- until a camera gets low, or the sun moves, or
    # somebody turns on a shadow pass, and then the whole staircase strobes.
    #
    # Now each step is a SLAB that spans only its own rise, dropping 0.01 into
    # the step below so the two solids overlap instead of touching, and each is
    # 3 mm narrower than the one in front so no two flanks share a plane. The
    # object is still solid to the ground -- which is the fact that separates it
    # from the conveyor and must not be given up -- and still a cuboid's worth
    # of honest volume for the collider.
    P = []
    N, RISE, RUN = 4, 0.15, 0.45
    BACK, W = 1.00, 0.94
    for i in range(N):
        yf = -0.98 + i*RUN                  # czolo stopnia
        d = BACK - yf
        h = (i + 1)*RISE
        z0 = max(0.0, i*RISE - 0.01)        # 0 dla pierwszego, inaczej zachodzi
        # d shrinks by 3 mm a step as well as W: all four steps ran back to
        # y = +1.00 and shared that plane too, which was the last 9 pairs.
        P.append(box("step%d" % i, (W - i*0.003, d - i*0.003, h - z0),
                     (0, yf + (d - i*0.003)/2, (z0 + h)/2), "steel"))
        # WHITE nosings, not hazard. Stairs and a conveyor were the same object
        # at play distance: both a steel deck banded with the same yellow, and
        # from 10 m the only difference was whether the bands ran across or
        # along. White is the palette's "you walk on this"; hazard-orange is
        # "this is powered". Four white treads now read as a stair from any
        # angle, and nothing that moves is white.
        P.append(box("nose%d" % i, (W + 0.04, 0.07, 0.035), (0, yf + 0.02, h - 0.015), "white"))
        P.append(box("riser%d" % i, (W + 0.02, 0.035, RISE - 0.05), (0, yf, h - RISE/2 - 0.02), "steel_d"))
    for sx in (-1, 1):                      # krawezniki boczne, TYLKO przy podstawie
        # 0.028 at 0.486, so the inner face is 0.472 and NOT on step 0's own
        # 0.470 flank -- an opposite-facing tie over 0.198 m^2 otherwise.
        P.append(box("skirt", (0.028, 2.00, 0.10), (sx*0.486, 0, 0.05), "steel_d"))
    # The foot plate and the skirts now run to +-1.00, so BOTH horizontal
    # extents are set by flat axis-aligned faces and finish()'s snap factor is
    # exactly 1.0. It used to be 1.0101 in y (the model measured 1.98 and was
    # stretched to 2.00), which quietly moved the nosing line that
    # src/data/buildings.js measures its -17.0 degree surface pitch off.
    # 0.02 deep, and that is deliberate: any deeper and its underside would
    # overlap step 0's underside in plan, which is a coincident pair at z = 0 --
    # exactly the defect this rewrite exists to remove.
    P.append(box("foot", (1.00, 0.02, 0.04), (0, -0.99, 0.02), "dark"))
    return finish(P, "stairs")

def b_roof():
    """Dach - zadaszenie 2x2 na dwoch slupach. Kaczki pod nim, deszczu i tak nie ma."""
    P = []
    # Butting a part's underside onto another part's top face at EXACTLY the same
    # height is the single commonest tie in this file, and on the canopy it was
    # also the biggest: 2.17 m^2 of steel_d against steel where the corrugation
    # sat on the sheet -- a whole roof of flicker, seen from below, which is the
    # only side of a canopy anyone looks at. Everything that stacks here now
    # overlaps its neighbour by a few millimetres instead of meeting it exactly.
    # The CORRUGATION is left exactly where it was, because its top face is the
    # top of the model and footprint[1] = 1.805 in src/data/buildings.js is a
    # contract. The sheet under it is thinned by 4 mm instead, which moves an
    # interior face and nothing else.
    P.append(box("sheet", (1.94, 1.94, 0.066), (0, 0, 1.718), "steel_d"))
    for i in range(8):                      # blacha trapezowa
        P.append(box("corr%d" % i, (0.14, 1.94, 0.05), (-0.84 + i*0.24, 0, 1.78), "steel"))
    P.append(box("edge", (2.00, 2.00, 0.05), (0, 0, 1.665), "hazard"))
    for sx in (-1, 1):
        # 0.008 off the floor and 4 mm past the beam: the post used to share its
        # underside with the base plate and its top with the beam at once.
        P.append(box("post", (0.13, 0.13, 1.656), (sx*0.82, 0.82, 0.836), "steel"))
        P.append(box("base", (0.24, 0.24, 0.06), (sx*0.82, 0.82, 0.03), "dark"))
        P.append(box("brace", (0.30, 0.30, 0.06), (sx*0.70, 0.70, 1.52), "steel_d",
                     rot=(0, 0, math.radians(45))))
    P.append(box("beam", (1.80, 0.10, 0.12), (0, 0.82, 1.60), "steel_d"))
    P.append(box("gutter", (1.98, 0.10, 0.09), (0, -0.94, 1.63), "hazard"))
    return finish(P, "roof")

def b_ice_slide():
    """Slizg lodowy - plyta o niemal zerowym tarciu. collider.friction w wierszu.

    WORST COINCIDENT-FACE RATIO IN THE GAME: 152 of 180 triangles, 84%. Not the
    ring idiom -- this one is flat slabs. The slab, both edge rails and all four
    studs were each authored from z=0 upwards, so SEVEN parts shared the ground
    plane, and the rails and studs additionally shared the outer faces at
    +-1.00. Every one of those is a depth tie between two different materials
    (glass/teal, teal/hazard), which is the kind that flickers as a visible
    colour change rather than as noise.

    The studs alone now touch z=0 and reach the full 0.15, so they are the only
    part defining either end of the height and nothing else has to. Everything
    else is lifted 4 mm (0.09 px at play distance) and the studs are pulled 4 mm
    inside the rails' outer face. No triangle is added or removed.

    REPORTED, NOT FIXED: at 0.15 m this piece is 3 px tall at 10 m. That is
    below the height at which any silhouette change could be read, so ice_slide
    can only ever be told from the other floor pieces by COLOUR. Its height is
    `footprint[1]` and `collider.half[1]` in src/data/buildings.js, which is not
    mine to edit -- see the report."""
    P = []
    # Four different floors and four different ceilings, so no two parts share
    # either. The studs keep 0.000 and 0.150 because they are what the height
    # contract is measured on.
    P.append(box("slab", (1.94, 1.94, 0.087), (0, 0, 0.003 + 0.087/2), "glass"))
    P.append(box("sheen", (1.80, 1.80, 0.03), (0, 0, 0.10), "teal_lt"))
    for i in range(5):                      # rysy na lodzie, plytkie i nieregularne
        P.append(box("crack%d" % i, (1.60 - i*0.18, 0.03, 0.012), (0.05*i, -0.62 + i*0.31, 0.117),
                     "white", rot=(0, 0, math.radians(-9 + i*5))))
    for sx in (-1, 1):                      # obramowanie - bez niego plyta znika na betonie
        # The two rails cross at the corners, so they must not agree on a floor,
        # a ceiling or an outer face. edgeY is shortened to 1.84 so it butts
        # BETWEEN the edgeX pair instead of crossing through their end caps at
        # x = +-1.00, which is where the last of the teal/teal ties lived.
        P.append(box("edgeX", (2.00, 0.08, 0.125), (0, sx*0.96, 0.005 + 0.125/2), "teal"))
        P.append(box("edgeY", (0.08, 1.84, 0.121), (sx*0.96, 0, 0.007 + 0.121/2), "teal"))
        for sy in (-1, 1):
            # The only parts touching z=0 and the only parts reaching 0.15.
            P.append(box("stud", (0.16, 0.16, 0.15), (sx*(0.92 - 0.004), sy*(0.92 - 0.004), 0.075), "hazard"))
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
    """Latarenka - prosty slupek z KWADRATOWA latarnia. Patrz b_lamp.

    The cone shade is gone: it was the one shape lamp_post shared with the tall
    scenery lamp, and it was the shape at the top of the outline, which is the
    part that gets read. A square lantern with a flat cap is a different class
    of object, and everything stays on the pole axis so there is no boom to
    confuse with lamp's.

    Height is 2.17 EXACTLY (src/data/buildings.js `lamp_post`); the cap is an
    axis-aligned box placed at H by construction."""
    H = 2.17
    P = []
    P.append(cyl("base", 0.24, 0.13, (0, 0, 0.065), "dark", verts=10))
    P.append(cyl("pole", 0.06, 1.66, (0, 0, 0.93), "steel_d", verts=8))
    P.append(box("band", (0.14, 0.14, 0.08), (0, 0, 0.42), "hazard"))
    # The lantern: a square box, wider than the pole by 4x, so it is a block on
    # a stick rather than a taper.
    P.append(box("collar", (0.16, 0.16, 0.08), (0, 0, 1.795), "steel_d"))
    P.append(box("lantern", (0.30, 0.30, 0.26), (0, 0, 1.955), "white"))
    for sx in (-1, 1):                      # narozniki latarni - zeby czytala sie jako skrzynka
        for sy in (-1, 1):
            P.append(box("mull", (0.045, 0.045, 0.27), (sx*0.135, sy*0.135, 1.955), "steel_d"))
    P.append(box("cap", (0.38, 0.38, H - 2.06), (0, 0, (2.06 + H)/2), "hazard"))
    return finish(P, "lamp_post")

def b_sign_dir():
    """Znak kierunkowy - DWIE szerokie strzalki w przeciwne strony na slupku.

    The blades were 0.52 x 0.24 and 0.44 x 0.18 on a 0.09 m post: 11 px by 5 px
    at 10 m, and both pointed the SAME way, so the sign was a pole with a small
    smudge near the top -- which is also what a lamp_post is. The blades now run
    the full 0.72 m the footprint allows (16 px), are 0.34 and 0.26 deep, and
    point in OPPOSITE directions, which turns the top of the outline into a
    fingerpost zig-zag no pole in the game can imitate.

    Height is 1.38 EXACTLY (src/data/buildings.js `sign_dir`); the top blade's
    backing plate is an axis-aligned box placed at H by construction."""
    H = 1.38
    P = []
    P.append(box("foot", (0.34, 0.22, 0.09), (0, 0, 0.045), "dark"))
    P.append(cyl("post", 0.05, 1.24, (0, 0, 0.66), "steel", verts=8))
    # Upper blade: points +X, and owns the exported height.
    P.append(box("edge", (0.64, 0.03, 0.34), (0.02, 0.02, H - 0.17), "dark"))
    P.append(box("plate", (0.60, 0.05, 0.30), (0.02, 0, H - 0.17), "hazard"))
    P.append(box("head", (0.20, 0.06, 0.20), (0.32, 0, H - 0.17), "hazard", rot=(0, 0, math.radians(45))))
    for i in range(3):                      # kreski "napisu"
        P.append(box("txt%d" % i, (0.11, 0.03, 0.055), (-0.16 + i*0.15, -0.035, H - 0.17), "dark"))
    # Lower blade: points -X. Opposite direction is the whole fingerpost read.
    P.append(box("edge2", (0.56, 0.03, 0.26), (-0.02, 0.02, 0.80), "dark"))
    P.append(box("plate2", (0.52, 0.05, 0.22), (-0.02, 0, 0.80), "white"))
    P.append(box("head2", (0.17, 0.05, 0.17), (-0.26, 0, 0.80), "white", rot=(0, 0, math.radians(45))))
    return finish(P, "sign_dir")

def b_bumper():
    """Odbijacz - gumowy grzyb, ktory odrzuca kaczki. collider.restitution."""
    P = []
    P.append(cyl("plinth", 0.46, 0.10, (0, 0, 0.05), "dark", verts=12))
    # 0.176, not 0.18: the skirt's underside sat exactly on the plinth's top at
    # 0.100 -- 0.56 m^2 of dark against hazard, the widest tie on the piece.
    P.append(cyl("skirt", 0.42, 0.16, (0, 0, 0.176), "hazard", verts=12))
    P.append(cyl("body", 0.36, 0.40, (0, 0, 0.44), "rubber", verts=12))
    P.append(cone("cap", 0.40, 0.20, 0.20, (0, 0, 0.72), "red", verts=12))
    P.append(cyl("top", 0.20, 0.07, (0, 0, 0.85), "white", verts=10))
    for i in range(6):                      # gumowe zebra - czyta sie sprezyscie
        a = math.radians(i*60)
        P.append(box("rib%d" % i, (0.09, 0.07, 0.36), (math.sin(a)*0.37, math.cos(a)*0.37, 0.44),
                     "red", rot=(0, 0, -a)))
    ring_xy("ring", 0.44, 12, 0.24, 0.09, 0.05, 0.27, "white", P, sep=0.0015)
    return finish(P, "bumper", merge=0.001)

def b_trampoline():
    """Trampolina - wyrzuca kaczki w GORE. blow.pitchDegrees + duza sila."""
    P = []
    R, N = 0.66, 12
    P.append(cyl("mat", R, 0.05, (0, 0, 0.44), "dark", verts=N))
    P.append(cyl("matt", R - 0.06, 0.02, (0, 0, 0.475), "teal", verts=N))
    ring_xy("frame", R + 0.06, N, 2*math.pi*(R+0.06)/N*1.45, 0.13, 0.10, 0.46, "hazard", P, sep=0.0015)
    for i in range(N):                      # sprezyny promieniowe
        a = math.radians(i*360.0/N + 15)
        # The springs do not overlap each other, but they all sit at the same z
        # with the same height, so each one ties with the frame ring above it.
        P.append(box("spr%d" % i, (0.05, 0.14, 0.05 - alt(i)), (math.sin(a)*(R + 0.02), math.cos(a)*(R + 0.02), 0.46),
                     "steel", rot=(0, 0, -a)))
    for i in range(6):                      # nogi
        a = math.radians(i*60 + 30)
        P.append(box("leg%d" % i, (0.07, 0.07, 0.46), (math.sin(a)*(R + 0.02), math.cos(a)*(R + 0.02), 0.23),
                     "steel_d", rot=(math.radians(-7)*math.cos(a), math.radians(7)*math.sin(a), 0)))
    ring_xy("footring", R + 0.08, 8, 2*math.pi*(R+0.08)/8*1.40, 0.14, 0.05, 0.025, "dark", P, sep=0.0015)
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
    """Worek - miekki, przewiazany u gory. Wnetrze 0.62 x 0.62, kaczka ma 0.18.

    THE ONE STORAGE ROW THAT DECLARED NO CAVITY. Every other container calls
    cavity() so finish() can push the real inner box through the same centring
    and grid-snap scale as the mesh; this one did not, so the numbers in
    src/data/tools.js were DERIVED by hand from these literals instead of
    measured out of the export. cavity() below closes that -- see the note on it
    for what the measured box disagrees with the hand-derived one about."""
    P = []
    N = 10
    BANDS = ((0.30, 0.16, 0.32), (0.34, 0.44, 0.28), (0.26, 0.66, 0.20))
    WALL = 0.03
    for i in range(N):                      # scianka z segmentow, lekko baryklowata
        a = math.radians(i*360.0/N)
        for j, (r, z, h) in enumerate(BANDS):
            # Spun about Z, overlapping, so each band shared a top and a bottom
            # cap across all ten segments: 284 of 588 triangles were tied in the
            # depth buffer, the worst ratio in the item tab after the pit rim.
            P.append(box("w%d%d" % (i, j), (2*math.pi*r/N*1.45, WALL, h - alt(i)),
                         (math.sin(a)*r, math.cos(a)*r, z), "wood_lt", rot=(0, 0, -a)))
    P.append(cyl("bot", 0.29, 0.04, (0, 0, 0.02), "wood", verts=N))
    ring_xy("tie", 0.22, N, 2*math.pi*0.22/N*1.5, 0.07, 0.09, 0.80, "rust", P, sep=0.0015)
    # The cavity, measured rather than derived. Floor is the top of `bot`
    # (0.04); the ceiling is the underside of the tie ring (0.80 - 0.09/2).
    # The horizontal limit is the NARROWEST band over that span, which is the
    # neck at r 0.26, inner radius 0.26 - WALL/2 = 0.245 -- and the lattice is
    # rectangular while the sack is round, so it is the square INSCRIBED in that
    # radius, the same rule the bucket's cavity uses.
    neck = min(r for r, _z, _h in BANDS) - WALL/2
    ins = neck / math.sqrt(2.0)
    cavity("sack", (-ins, ins), (-ins, ins), (0.04, 0.80 - 0.045))
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
    """Wywrotka - koryto na dwoch kolach, przechyla sie do przodu.

    The whole barrow, chassis and trough joined, which is what the shop icon and
    the hotbar want and what src/data/tools.js measures its footprint against.
    The parts come from _dumper_parts() so that this model and the two animated
    halves below cannot drift: one copy of every literal, three exports."""
    return finish(_dumper_parts(False) + _dumper_parts(True), "dumper", merge=0.001)


# ================================================== THE TIPPER, IN TWO PIECES
# The Tipper's data row already says `tipToEmpty: true`, and until now that was
# a sentence in a JSON file with nothing on screen behind it: the trough, the
# one part whose whole job is to rotate, was welded into the same mesh as the
# wheels. These two builders split it, following the gambling box's precedent --
# a SEPARATE model with a stated hinge -- rather than the rotor.js route, which
# only handles rotationally symmetric congruent groups (fans).
#
# THE SCALE PROBLEM, AND WHY THESE TWO ARE NOT ORDINARY BUILDERS.
# finish() ends by scaling X and Y so the exported bounding box hits FOOTPRINT
# exactly, and the factors it computes depend on the bounding box of WHATEVER
# PART LIST IT IS GIVEN. Build the chassis on its own and it gets its own,
# different factors -- the body would come out a different width from the trough
# that is supposed to sit in it, and both would differ from `dumper`. So both
# builders below take the part list through the transform b_dumper's list gets,
# measured off that list and stated here once:
DUMPER_FX, DUMPER_FY = 1.1682242417983177, 0.9722222479773164
DUMPER_CX, DUMPER_CY, DUMPER_MINZ = 0.0, -0.07999998331069946, 0.0
# The hinge, in the builder's own coordinates: the axis of the `pivot` cylinder
# that b_dumper already draws across the frame at (0, 0.30, 0.46), spun 90 deg
# about Y so it lies along X. It was always the tipping axis; nothing rotated
# about it.
DUMPER_HINGE = (0.0, 0.30, 0.46)


def _dumper_parts(trough):
    """The Tipper's part list, split. `trough` picks which half you get, so the
    two halves cannot drift apart: there is one copy of every literal."""
    P = []
    tw, td, th, t = 1.02, 1.24, 0.44, 0.05
    ring = 0.05
    if trough:
        P.append(box("bot", (tw, td, t), (0, 0.06, 0.52), "blue"))
        for sx in (-1, 1):
            P.append(box("sx", (t, td, th), (sx*(tw/2), 0.06, 0.52 + th/2), "blue"))
        P.append(box("back", (tw, t, th), (0, 0.06 + td/2, 0.52 + th/2), "blue"))
        P.append(box("front", (tw, t, th*0.55), (0, 0.06 - td/2, 0.52 + th*0.28), "blue"))
        # The four rim bars used to sit flush with the wall they cap -- same
        # outer plane, hazard against blue -- which is 95 of the Tipper's 408
        # tied pairs and ALL of them, since the chassis has none. Each bar is
        # nudged 4 mm inboard of its wall, and the side bars 3 mm DOWN (never up:
        # the rim's top face is the model's 0.985 height contract).
        P.append(box("rimF", (tw + 0.05, ring, ring), (0, 0.06 - (td/2 - 0.004), 0.52 + th), "hazard"))
        P.append(box("rimB", (tw + 0.05, ring, ring), (0, 0.06 + (td/2 - 0.004), 0.52 + th), "hazard"))
        for sx in (-1, 1):
            P.append(box("rimS", (ring, td, ring), (sx*(tw/2 - 0.004), 0.06, 0.52 + th - 0.003), "hazard"))
    else:
        for sx in (-1, 1):
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
        P.append(cyl("pivot", 0.05, 0.94, (0, 0.30, 0.46), "hazard", verts=8,
                     rot=(0, math.radians(90), 0)))
    return P


def _as_dumper(o, origin_at_hinge):
    """Put an already-joined half through b_dumper's own finish() transform.

    origin_at_hinge=False reproduces `dumper`'s origin exactly (bbox-centred in
    XY, floor at z=0), so the chassis is a drop-in for the whole model.
    origin_at_hinge=True puts (0,0,0) on the tipping axis, which is the contract
    the renderer needs: rotate the mesh about its own X axis and it swings the
    way the real trough would, with no offset to work out."""
    hx = (DUMPER_HINGE[0] - DUMPER_CX) * DUMPER_FX
    hy = (DUMPER_HINGE[1] - DUMPER_CY) * DUMPER_FY
    hz = DUMPER_HINGE[2] - DUMPER_MINZ
    for v in o.data.vertices:
        x = (v.co.x - DUMPER_CX) * DUMPER_FX
        y = (v.co.y - DUMPER_CY) * DUMPER_FY
        z = v.co.z - DUMPER_MINZ
        if origin_at_hinge:
            x -= hx; y -= hy; z -= hz
        v.co.x, v.co.y, v.co.z = x, y, z
    o.data.update()
    return o


def b_dumper_body():
    """The Tipper without its trough. Same origin and same scale as `dumper`, so
    the renderer can swap one for the other and change nothing else."""
    o, tris = finish(_dumper_parts(False), "dumper_body", merge=0.001, origin="raw")
    return _as_dumper(o, False), tris


def b_dumper_trough():
    """The Tipper's trough alone, ORIGIN ON THE TIPPING AXIS.

    Hinge, travel and driver are written out in full in the report; the short
    version is: origin (0,0,0) is the axis, the axis is the model's +X, and
    positive rotation about it drops the front lip and raises the back, which is
    the direction a barrow actually empties."""
    o, tris = finish(_dumper_parts(True), "dumper_trough", merge=0.001, origin="raw")
    return _as_dumper(o, True), tris

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
    # A RUSTED STEEL drum, not a blue one, and that is the whole fix.
    #
    # This and vacuum_station were the same object: both blue tanks with a steel
    # cap and an orange panel, both about 1.25 m tall, i.e. one backbuffer pixel
    # apart in height at 10 m and using an IDENTICAL set of six palette entries.
    # No amount of detail separates two things that agree on silhouette class
    # and colour at 22 px per metre.
    #
    # Height is untouched on purpose: src/data/tools.js hard-codes it as
    # footprint[1] = 1.2332, and moving a model out from under its data row is
    # how a placeable ends up floating. So the separation is carried entirely by
    # material and by internal proportion -- the drum is shorter and the motor
    # stack taller within the same total, so the profile is bottom-heavy where
    # the station is a single tall column.
    #
    # Blue now belongs to the vacuum FAMILY THE PLAYER CARRIES (vacuum,
    # vacuum_station); rust-and-orange belongs to this one. Two families, two
    # readings, same total height.
    P = []
    # Each stage sinks ~1 cm into the one below rather than sitting flush on it.
    # Flush is a coplanar pair, and tools/check-coplanar.py counts those for a
    # reason: two faces at the same depth are a z-fight waiting for a camera
    # angle. Verified with that tool -- these three joins produce none.
    P.append(cyl("drum", 0.35, 0.56, (0, 0, 0.41), "rust", verts=12))
    P.append(cyl("lid", 0.36, 0.14, (0, 0, 0.75), "steel_d", verts=12))
    P.append(cyl("motor", 0.26, 0.30, (0, 0, 0.96), "dark", verts=10))
    P.append(cyl("cap2", 0.14, 0.09, (0, 0, 1.19), "hazard", verts=8))
    P.append(cyl("stack", 0.09, 0.14, (0, 0, 1.12), "steel_d", verts=8))
    for z in (0.22, 0.58):
        P.append(cyl("band", 0.36, 0.05, (0, 0, z), "hazard", verts=12))
    for sx in (-1, 1):                      # zatrzaski -- follow the lowered lid
        P.append(box("clip", (0.07, 0.05, 0.16), (sx*0.34, 0, 0.72), "steel"))
    P.append(cone("intake", 0.13, 0.06, 0.20, (0, -0.36, 0.50), "steel_d", verts=9,
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
    """Dmuchawa do liesci - dluga rura WYSOKO, na jednym slupku. Sylwetka "Γ".

    The other half of the vacuum/leaf_blower separation; the full argument is in
    b_vacuum's docstring. Short version: the two share a bounding box exactly,
    so the barrel is pushed UP against the roof and everything under it in the
    front two thirds is deleted -- the old skid rail and its two struts ran the
    whole length at floor level, which is precisely where the vacuum's wand now
    lives. One strut at the back carries the engine; the front of the outline is
    a bar in the air with clear sky under it.

    Height is 0.7291 EXACTLY (src/data/tools.js `leaf_blower`), set by the carry
    handle, an axis-aligned box placed at H by construction."""
    H = 0.7291
    ZT = 0.50                               # barrel axis, high in the box
    P = []
    P.append(cyl("tube", 0.09, 0.57, (0, -0.165, ZT), "orange", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(cone("muzzle", 0.09, 0.055, 0.17, (0, -0.515, ZT), "dark", verts=9,
                  rot=(math.radians(90), 0, 0)))
    P.append(cyl("ring", 0.105, 0.05, (0, -0.44, ZT), "hazard", verts=10, rot=(math.radians(90), 0, 0)))
    P.append(box("engine", (0.24, 0.30, 0.24), (0, 0.25, ZT), "orange"))
    for i in range(4):                      # zebra chlodzenia
        P.append(box("fin%d" % i, (0.25, 0.03, 0.15), (0, 0.13 + i*0.06, ZT), "steel_d"))
    P.append(cyl("fuel", 0.072, 0.13, (0, 0.352, 0.595), "white", verts=9,
                 rot=(0, 0, math.radians(20))))
    # Carry handle along the top -- reinforces "long bar in the air" and is the
    # part that owns the exported height.
    P.append(box("bar", (0.08, 0.42, 0.045), (0, 0.06, H - 0.0225), "dark"))
    P.append(box("post", (0.06, 0.06, 0.13), (0, -0.14, 0.65), "dark"))
    P.append(box("trig", (0.06, 0.09, 0.05), (0, -0.06, 0.635), "hazard"))
    # ONE strut, at the back. The front two thirds of the footprint carry no
    # geometry below 0.41 m at all -- that void is the whole tell against the
    # vacuum, which fills exactly that band with its wand.
    P.append(box("strut", (0.10, 0.13, 0.40), (0, 0.29, 0.22), "steel_d"))
    P.append(box("foot", (0.17, 0.28, 0.05), (0, 0.26, 0.025), "dark"))
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
            # Coil spun about Z: every segment of a course shares its top and
            # bottom cap with both neighbours.
            P.append(box("c%d%d" % (j, i), (2*math.pi*R/NC*1.5, 0.05, 0.05 - alt(i, phases=5)),
                         (math.sin(a)*R, math.cos(a)*R, z), "wood", rot=(0, 0, -a)))
    # Petla w plaszczyznie XZ. Jasniejszy sznur niz zwoj - dwa tony jednej liny
    # rozdzielaja te dwie bryly bez wprowadzania obcego koloru do palety.
    ring_xz("loop", 0.19, NL, 2*math.pi*0.19/NL*1.55, 0.05, 0.05, 0.33, "wood_lt", P, sep=0.0015)
    P.append(box("knot", (0.09, 0.09, 0.09), (0, 0, 0.135), "rust"))
    P.append(box("grip", (0.055, 0.055, 0.13), (0, 0, 0.175), "rust"))
    return finish(P, "lasso", merge=0.001)

def b_fire_hose():
    """Waz strazacki - zwoj w BEBNIE miedzy dwoma tarczami. Tryb sweep.

    It was a bare red coil on a thin plate: a squat torus, which at 0.57 m tall
    is 12 px of outline and reads as a tyre -- the same reading as bumper and as
    the trampoline's rim. A coil needs a REEL around it to be a hose.

    Two upright steel cheeks now bracket the coil, floor to full height, so the
    outline is a flat-topped H with red filling the middle rather than a round
    lump. The cheeks are 0.57 m tall and 0.62 apart: 12 x 14 px of hard vertical
    edge, which nothing round in the catalog has.

    Height is 0.5662 EXACTLY (src/data/tools.js `fire_hose`); the cheeks run
    from the floor to H, so minY and height are both exact by construction."""
    H = 0.5662
    P = []
    N = 14
    for j, (R, z, col) in enumerate(((0.28, 0.10, "red"), (0.28, 0.23, "red"), (0.20, 0.36, "red"))):
        for i in range(N):
            a = math.radians(i*360.0/N + j*8)
            # Three courses of coil, each spun about Z, each sharing a top and a
            # bottom cap all the way round: 252 of 684 triangles.
            P.append(box("c%d%d" % (j, i), (2*math.pi*R/N*1.5, 0.11, 0.12 - alt(i, phases=7)),
                         (math.sin(a)*R, math.cos(a)*R, z), col, rot=(0, 0, -a)))
    # The reel cheeks: the whole point of the change.
    for sx in (-1, 1):
        P.append(box("cheek", (0.055, 0.62, H), (sx*0.31, 0, H/2), "steel"))
        P.append(box("chevr", (0.065, 0.44, 0.07), (sx*0.31, 0.02, 0.46), "hazard"))
    P.append(box("axle", (0.64, 0.08, 0.08), (0, 0.02, 0.235), "steel_d"))
    P.append(box("floor", (0.60, 0.56, 0.05), (0, 0, 0.035), "steel_d"))
    P.append(cyl("nozzle", 0.06, 0.24, (0.10, -0.33, 0.30), "hazard", verts=9,
                 rot=(math.radians(88), 0, 0)))
    P.append(cone("tip", 0.06, 0.028, 0.13, (0.10, -0.48, 0.295), "steel_d", verts=9,
                  rot=(math.radians(88), 0, 0)))
    P.append(cyl("collar", 0.075, 0.05, (0.10, -0.28, 0.30), "steel", verts=9,
                 rot=(math.radians(88), 0, 0)))
    P.append(box("lever", (0.05, 0.14, 0.04), (0.17, -0.24, 0.34), "dark", rot=(math.radians(16), 0, 0)))
    return finish(P, "fire_hose", merge=0.001)

def b_fan_handheld():
    """Wentylator reczny - glowica na trzonku nad SZEROKA plyta. Bez klatki.

    Third of the three fans (see b_fan_strong for the family argument). The cage
    ring is gone: a small ring around a small hub is exactly what fan looks like
    at 10 m, so keeping it made this a fan seen from further away rather than a
    different object. What is left is a stem with a wide flat plate at its foot
    -- a T standing on a bar, 11 px wide, no circle in the outline at all.

    The grip was `teal`, which the palette reserves for commerce (the vendor
    booth). It is a hand tool, so it goes to `rubber`.

    Height is 0.825 EXACTLY (src/data/tools.js `fan_handheld`); the head shroud
    is an axis-aligned box placed at H by construction."""
    H = 0.825
    P = []
    P.append(cyl("hub", 0.07, 0.07, (0, 0, 0.63), "orange", verts=9, rot=(math.radians(90), 0, 0)))
    for i in range(3):                      # three blades, not four -- and no cage
        a = math.radians(i*120 + 30)
        P.append(box("blade%d" % i, (0.09, 0.03, 0.18), (math.sin(a)*0.105, 0, 0.63 + math.cos(a)*0.105),
                     "hazard", rot=(math.radians(22), a, 0)))
    P.append(box("shroud", (0.26, 0.09, 0.055), (0, 0.03, H - 0.0275), "dark"))
    P.append(box("neck", (0.09, 0.07, 0.16), (0, 0.03, 0.44), "dark"))
    P.append(box("grip", (0.10, 0.09, 0.32), (0, 0.03, 0.23), "rubber"))
    P.append(box("switch", (0.05, 0.03, 0.06), (0, -0.02, 0.28), "hazard"))
    # The wide plate is the tell: 0.50 m of floor under a 0.10 m stem.
    P.append(box("plate", (0.50, 0.24, 0.045), (0, 0.02, 0.0225), "dark"))
    P.append(box("kick", (0.44, 0.05, 0.055), (0, -0.08, 0.0275), "hazard"))
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
        # The horseshoe is spun about Y, so its segments keep their +-Y faces
        # parallel and at the same two offsets -- the ring_xz case, and 118 of
        # this model's 180 triangles were in it. The magnet is a benchmark for
        # the whole set (an open two-colour shape beating a detailed closed one),
        # so the fix has to be the one that changes no silhouette: 3 mm off the
        # thickness of every other segment, on the axis facing the camera.
        P.append(box("arc%d" % i, (2*math.pi*R/N*1.4, TH - alt(i, phases=3), TH),
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
    """Auto-Cranker. Clamps on the workbench hub and turns the wheel for you.

    Re-cut for the wheel's new plane. The wheel used to turn about the model's
    local X, so the bot's clamp ring lay in the YZ plane and its motor stuck out
    sideways; the wheel now turns about local Z and FACES the player, so the ring
    lies in the XZ plane and the motor points at the player down local -Z with
    the drive arm reaching out to the handle at the 45 degree station.

    ORIGIN (0,0,0) is the MOUNT POINT -- the wheel hub -- not the centre of the
    bounding box, which is why this builder passes origin="raw" to finish(). Code
    that attaches it needs to know one point, not an outline.

    sep=0.006 on the clamp ring, not the 0.003 used elsewhere: at 0.003 the walls
    separate but the BEVEL CHAMFERS (0.012) of neighbouring segments land 1.2 mm
    apart, which is inside the tolerance check-coplanar.py tests. This part rides
    on the wheel, so it turns right in front of the player's eyes and there is no
    margin here for "nearly"."""
    P = []
    # Clamp ring in the XZ plane -- the wheel's plane. ring_xz lays segments out
    # with rotation (0, a, 0), which is the same construction the new rim uses.
    NC, RC = 8, 0.115
    for i in range(NC):
        a = math.radians(i * 360.0 / NC)
        odd = i % 2
        rr = RC + (0.006 if odd else 0.0)
        P.append(box("collar%d" % i, (2*math.pi*RC/NC*1.5, 0.13 - (0.012 if odd else 0.0), 0.055),
                     (math.sin(a)*rr, 0.0, math.cos(a)*rr), "steel_d", rot=(0, a, 0)))
    for sx in (-1, 1):                       # clamp bolts: it visibly grips
        P.append(box("bolt", (0.05, 0.05, 0.13), (sx*0.150, 0.0, 0.045), "orange"))
    # Motor, lying on the axis and sticking out towards the player.
    P.append(cyl("motor", 0.105, 0.17, (0, -0.195, 0), "teal", verts=10,
                 rot=(math.radians(90), 0, 0)))
    P.append(cyl("motorcap", 0.075, 0.05, (0, -0.295, 0), "dark", verts=10,
                 rot=(math.radians(90), 0, 0)))
    for i in range(3):                       # cooling fins
        P.append(box("fin%d" % i, (0.22, 0.02, 0.22), (0, -0.145 - i*0.05, 0), "teal_lt"))
    P.append(box("led", (0.04, 0.04, 0.05), (0.10, -0.258, 0), "hazard"))
    # Drive arm, out along the wheel's 45 degree station to the handle.
    KA = math.radians(45)
    P.append(box("arm", (0.075, 0.055, 0.20),
                 (math.sin(KA)*0.105, -0.105, math.cos(KA)*0.105), "steel", rot=(0, KA, 0)))
    P.append(box("wrist", (0.10, 0.075, 0.07),
                 (math.sin(KA)*0.205, -0.105, math.cos(KA)*0.205), "steel_d", rot=(0, KA, 0)))
    for sy in (-1, 1):                       # fork closing round the grip
        P.append(box("fork", (0.09, 0.035, 0.06),
                     (math.sin(KA)*0.245, -0.145 + sy*0.055, math.cos(KA)*0.245), "hazard",
                     rot=(0, KA, 0)))
    return finish(P, "crank_bot", bevel=0.012, merge=0.0008, origin="raw")

def b_press_gold_ram():
    """The Gold Press's moving half.

    ORIGIN (0,0,0) is the ram's TOP CENTRE. Mount it on `press_gold` at
    model-local (0, 1.240, -0.335) -- centred laterally, at the top of the sunken
    working recess, 0.335 forward of centre so it sits in the recess rather than
    behind it -- with identity rotation.

    AXIS: the model's local -Y, straight down. TRAVEL: 0 (rest, head face at
    1.240 - 0.370 = 0.870) to -0.075 (struck, head face at 0.795, flat on the
    anvil, whose top is 0.905 + half its 0.08 = 0.945 -- no, the anvil top is
    0.945, so the head meets it at -0.075 measured from rest). Range 0 .. -0.075.

    STATE: produce.secondsPerDuck (6.0 s). Same drive as the plain press but
    shorter and slower -- this machine is meant to look expensive, so ease down
    over 0.30 s, hold 0.10 s, ease back over 0.45 s, duck released on the hold."""
    P = []
    P.append(cyl("shaft", 0.085, 0.26, (0, 0, -0.13), "duck", verts=10))
    P.append(cyl("collar", 0.12, 0.06, (0, 0, -0.035), "dark", verts=10))
    P.append(box("head", (0.44, 0.15, 0.13), (0, 0, -0.305), "duck"))
    P.append(box("headlip", (0.49, 0.19, 0.035), (0, 0, -0.250), "dark"))
    return finish(P, "press_gold_ram", origin="raw")


def b_press_belt_ram():
    """The Belt Press's moving half -- the one that stamps five at a time.

    ORIGIN (0,0,0) is the ram's TOP CENTRE. Mount it on `press_belt` at
    model-local (0, 1.305, -0.160) -- under the crown, over the belt -- with
    identity rotation. (Local -Z 0.160 because the gantry straddles the belt
    0.16 m behind the model's centre.)

    AXIS: the model's local -Y. TRAVEL: 0 (rest, punch faces at 1.305 - 0.465 =
    0.840) to -0.040 (struck, punch faces at 0.800, exactly on the five dies on
    the belt, whose tops are 0.775 + half their 0.05). Range 0 .. -0.040.

    STATE: produce.secondsPerDuck (10.0 s), five ducks per cycle. The natural
    read is one stroke per CYCLE, not per duck: ease down 0.20 s, hold 0.08 s,
    ease back 0.35 s, and release all five on the hold so the batch and the blow
    are the same event."""
    P = []
    P.append(cyl("shaft", 0.11, 0.30, (0, 0, -0.15), "steel_d", verts=10))
    P.append(cyl("collar", 0.145, 0.06, (0, 0, -0.045), "dark", verts=10))
    P.append(box("head", (0.62, 0.34, 0.14), (0, 0, -0.35), "orange"))
    P.append(box("headlip", (0.68, 0.40, 0.04), (0, 0, -0.285), "dark"))
    for i in range(5):                      # five punches, one per duck
        P.append(box("punch%d" % i, (0.07, 0.07, 0.05), (-0.24 + i*0.12, 0, -0.440), "steel_d"))
    return finish(P, "press_belt_ram", origin="raw")


def b_slot_reels():
    """Duck Slots' three reels.

    ORIGIN (0,0,0) is the CENTRE OF THE MIDDLE REEL, on its own axle. Mount on
    `slot_machine` at model-local (0, 1.020, -0.195) -- the centre of the reel
    recess -- with identity rotation.

    AXIS: the model's local X, for all three. They are three separate cylinders
    on one axle line at x = -0.155, 0 and +0.155, so a renderer that wants them
    to stop one after another has to split this model into three or spin the
    whole thing as one; if it spins as one, that is still better than the
    painted-on reels it replaces.

    TRAVEL: unbounded rotation about local X. Suggested drive -- on each
    emission, spin all three up to ~25 rad/s, then stop them at 0.15 s intervals
    on a multiple of 60 degrees (six symbols a reel), the last one landing as the
    ducks leave the tray. produce.count is [1,10] on this row, so the number of
    ducks is already a roll; the reels should show that roll, not precede it."""
    P = []
    for i, x in enumerate((-0.155, 0.0, 0.155)):
        P.append(cyl("reel%d" % i, 0.145, 0.13, (x, 0, 0), "white", verts=12,
                     rot=(0, math.radians(90), 0)))
        P.append(cyl("hubr%d" % i, 0.048, 0.15, (x, 0, 0), "dark", verts=8,
                     rot=(0, math.radians(90), 0)))
        # Symbols on the rim: six flats a reel, so a stopped reel reads as having
        # landed on something and a spinning one flickers.
        for k in range(6):
            a = math.radians(k * 60.0)
            P.append(box("sym%d%d" % (i, k), (0.10, 0.055, 0.045),
                         (x, math.sin(a)*0.128, math.cos(a)*0.128),
                         "duck" if k % 2 == 0 else "teal", rot=(-a, 0, 0)))
    return finish(P, "slot_reels", origin="raw")


BUILDERS += [
    ("crank_bot", b_crank_bot, "Maszyny", "Automat nakrecajacy kolo warsztatu."),
    ("crank_wheel", b_crank_wheel, "Maszyny", "Kolo warsztatu - czesc ruchoma."),
    ("press_ram", b_press_ram, "Maszyny", "Prasa - stempel, czesc ruchoma."),
    ("press_gold_ram", b_press_gold_ram, "Maszyny", "Zlota prasa - stempel."),
    ("press_belt_ram", b_press_belt_ram, "Maszyny", "Prasa tasmowa - stempel."),
    ("slot_reels", b_slot_reels, "Maszyny", "Duck Slots - bebny, czesc ruchoma."),
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
    ("vibe_floor_belt", b_vibe_floor_belt, "Budowle", "Wibrator podlogowy - RUCHOME zebra."),
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
    ("dumper_body", b_dumper_body, "Przedmioty", "Wywrotka - podwozie bez koryta."),
    ("dumper_trough", b_dumper_trough, "Przedmioty", "Wywrotka - koryto, zawias w origin."),
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
