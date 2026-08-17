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
    // THE TRUCK STANDS ON FOUR BALLS, one per wheel, and that is the single
    // most important line in this file.
    //
    // It used to stand on one flat-bottomed box spanning the whole chassis, and
    // a flat box with a vertical face at ground level catches on EVERYTHING: a
    // kerb, a ramp's lip, the edge of a conveyor, the lip of its own garage
    // pad. The truck would simply stop dead with the throttle wide open, at no
    // particular place, which from the driver's seat reads as the vehicle
    // randomly seizing up. Measured in that state: full throttle for twelve
    // seconds, speed 0.0 the whole way.
    //
    // A ball has no vertical face to catch. It rolls over anything shallower
    // than its own radius, which is what a wheel is for, and it is also why the
    // radius here is the radius drawn on the model: 0.22, centred at 0.22, so
    // the contact point is the bottom of the tyre exactly as it looks.
    //
    // Between the wheels there is now no collider at all, and there does not
    // need to be: the load rests on the BED, which is its own body bolted on
    // top, and the cab is its own box below.
    parts: [
      // 0.16, not the tyre's own 0.22, and the difference is the bed. A ball of
      // 0.22 centred at 0.22 reaches y 0.44, and the bed's floor starts at 0.35
      // -- so the wheels were inside the bed they are supposed to carry, which
      // is two rigid bodies overlapping, which is the truck 2100 metres up.
      // The contact point is unchanged (bottom of the ball is still y 0.00, so
      // the ride height still matches the drawn tyre); only the kerb it can
      // climb shrinks from 22 cm to 16.
      { shape: 'ball', radius: 0.16, center: [0.66, 0.16, 1.10] },
      { shape: 'ball', radius: 0.16, center: [-0.66, 0.16, 1.10] },
      { shape: 'ball', radius: 0.16, center: [0.66, 0.16, -1.06] },
      { shape: 'ball', radius: 0.16, center: [-0.66, 0.16, -1.06] },
      // The cab. Its own box, so the bonnet line is real and a player can stand
      // in front of the truck without standing inside it. It clears the bed's
      // front wall (z -0.30) by 14 cm: two rigid bodies that overlap are two
      // rigid bodies the solver separates, and it does that by firing the
      // lighter one across the plate.
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
