// The tipper truck's geometry. Not a catalog row: nobody buys a truck at the
// vendor, they buy the GARAGE that makes them, so this table is looked up by
// src/sim/vehicles.js and never appears in a shop tab.
//
// EVERY NUMBER HERE WAS MEASURED OFF THE EXPORTED GLB, not copied from the
// builder's source. The three meshes are exported with origin="raw" out of one
// shared coordinate system (tools/blender-models.py, the CAR_ block), so what
// is written below is simply where their triangles are:
//
//   car_body   x -0.870..0.870   y 0.000..1.225   z -1.720..1.660
//   car_bed    x -0.725..0.725   y -0.030..0.660  z -1.920..0.000
//   car_gate   x -0.700..0.700   y  0.000..0.220  z -0.040..0.040
//
// The frame is the CHASSIS BODY's: (0, 0, 0) is the point on the plate under
// the middle of the truck, +y is up and -z is forward, which is where a player
// at yaw 0 is facing. The bed's and the gate's own origins are their HINGES,
// which is why their coordinates below are small numbers around zero and why
// the renderer needs no offset table to draw them.
//
// THE NUMBER THE WHOLE TRUCK IS BUILT AROUND: the shut tailgate's top edge is
// at 0.40 + 0.22 = 0.62 off the plate, and a conveyor's belt surface is at 0.65
// (src/data/machines.js `conveyor`: collider.half[1] * 2). Back the truck up to
// the end of a belt and a duck rolls off the belt, clears the gate by 3 cm and
// drops into the bed. Raise the side walls all you like -- the BACK of this
// truck is at belt height by construction, and that is the whole design.

export const TRUCK = {
  models: { body: 'car_body', bed: 'car_bed', gate: 'car_gate' },

  chassis: {
    // Two boxes, not one: a single box round the whole silhouette would make
    // the cab's roofline part of the thing a duck bounces off at bumper height.
    parts: [
      // The frame, the deck it carries and the WHEELS UNDER IT, from the rear
      // bumper to the front of the cab's floor: 0.00..0.40 off the plate.
      //
      // It reaches the ground on purpose. The frame's own steel starts at 0.25
      // and the first version of this box said so -- which parked the truck 25
      // centimetres into the plate, because a body rests where its lowest
      // COLLIDER stops and the wheels holding this one up are decoration. The
      // wheels are 0.44 across and the box is 0.34 deep, so the tyres still
      // stand a hair proud of it and read as the thing carrying the load.
      //
      // IT STOPS AT 0.34, ONE CENTIMETRE UNDER THE BED'S FLOOR (0.35), and that
      // centimetre is load-bearing. The bed is its own rigid body sitting on
      // top of this one, and two rigid bodies that overlap are two rigid bodies
      // the solver has to separate -- which it does, instantly, by throwing the
      // lighter one across the plate. Measured with the boxes touching at 0.40:
      // the truck left the ground at 78 m/s and was 91 m up two seconds later.
      { half: [0.70, 0.17, 1.605], center: [0, 0.17, 0.055] },
      // The cab. Its own box, so the bonnet line is real and a player can stand
      // in front of the truck without standing inside it.
      { half: [0.67, 0.4125, 0.58], center: [0, 0.8125, -1.02] },
    ],
  },

  bed: {
    // Hinge: the bed's rear bottom edge, in chassis-local metres. The bed tips
    // about this line, so the load slides BACKWARDS and out over the tailgate.
    hinge: [0, 0.38, 1.62],
    // Floor, two side walls and the front wall -- and deliberately NO back:
    // the back is the tailgate, which is its own body because it opens.
    parts: [
      { half: [0.70, 0.025, 0.96], center: [0, -0.005, -0.96] },
      { half: [0.025, 0.25, 0.96], center: [0.675, 0.27, -0.96] },
      { half: [0.025, 0.25, 0.96], center: [-0.675, 0.27, -0.96] },
      { half: [0.70, 0.32, 0.025], center: [0, 0.34, -1.8975] },
    ],
    // The load floor's top face and its extent, in CHASSIS-local metres. Read
    // by the ride test: this is the patch a passenger has to be standing on.
    floorY: 0.40,
    halfX: 0.65,
    zRange: [-0.30, 1.62],
  },

  gate: {
    // The tailgate's hinge, expressed in the BED's frame rather than the
    // chassis's, because the gate hangs off the bed and tips with it. It is
    // 0.02 above and 0.04 behind the bed's own hinge line.
    hingeInBed: [0, 0.02, 0.04],
    parts: [
      { half: [0.70, 0.11, 0.025], center: [0, 0.11, 0] },
    ],
  },

  // Where the driver sits, and where they are put down when they get out.
  // The seat is inside the cab; the exit is clear of every collider on the
  // driver's side, because a capsule spawned inside its own truck is a capsule
  // the solver fires into the sky.
  seat: [0, 1.05, -0.95],
  exit: [1.35, 1.00, -0.60],
};

export default TRUCK;
