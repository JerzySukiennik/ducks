// Footsteps, timed off the distance the player actually covered.
//
// A timer would be wrong in both directions: walking into a wall at full input
// would keep making footstep noises, and a sprint would sound like a walk. So
// the horizontal distance travelled is accumulated and a step is emitted every
// strideMeters -- sprinting shortens the stride, which is what makes a sprint
// audibly faster without a second sample.
//
// The landing is the other half of the same job. A jump's landing plays
// jump_land, and the footstep that would otherwise fire on the same frame is
// suppressed for landingSilenceMs so the two do not turn into mud.

export function createSteps({ sfx, config, clock }) {
  // Simulated seconds, like the rest of the audio layer. The landing silence
  // window has to be measured on the same clock the voice limiter uses, or a
  // debugStep run and a played minute disagree about what a step is.
  const now = typeof clock === 'function' ? clock : () => 0;
  const S = config.audio.steps;
  const sprintFactor = config.player.sprintMultiplier;

  let travelled = 0;
  let stepped = 0;
  let landings = 0;
  let lastGrounded = true;
  let airborneMeters = 0;
  let silenceUntil = 0;
  let last = null;

  // state: { position, grounded, speed } -- position is the capsule, not the
  // eye, so a look around does not walk.
  function update(dt, state) {
    if (!state || !state.position) return 0;
    const p = state.position;
    const grounded = !!state.grounded;
    let fired = 0;

    if (last) {
      const dx = p.x - last.x;
      const dz = p.z - last.z;
      const moved = Math.hypot(dx, dz);
      const speed = dt > 0 ? moved / dt : 0;

      if (!grounded) {
        airborneMeters += moved;
      } else if (!lastGrounded) {
        // Touchdown. Loud enough to be worth its own clip and its own silence
        // window; the height is not tracked, only that the player was in the
        // air at all.
        sfx.play('jump_land', { gain: 1 });
        landings++;
        fired++;
        airborneMeters = 0;
        travelled = 0;
        silenceUntil = now() + S.landingSilenceMs;
      } else if (speed >= S.minSpeed) {
        travelled += moved;
        const stride = speed > config.player.walkSpeed * (1 + (sprintFactor - 1) * 0.5)
          ? S.strideMeters * S.sprintStrideScale
          : S.strideMeters;
        const t = now();
        while (travelled >= stride) {
          travelled -= stride;
          if (t >= silenceUntil) {
            sfx.play('footstep', { gain: 1 });
            stepped++;
            fired++;
          }
        }
      } else {
        // Standing still bleeds the accumulator away rather than banking it, so
        // stopping and starting does not fire an instant step.
        travelled = Math.max(0, travelled - moved);
      }
    }

    lastGrounded = grounded;
    last = { x: p.x, y: p.y, z: p.z };
    return fired;
  }

  return {
    update,
    state: () => ({
      steps: stepped,
      landings,
      accumulatedMeters: Math.round(travelled * 1000) / 1000,
      strideMeters: S.strideMeters,
      grounded: lastGrounded,
      airborneMeters: Math.round(airborneMeters * 1000) / 1000,
    }),
    reset() {
      travelled = 0; stepped = 0; landings = 0; last = null; lastGrounded = true;
      return true;
    },
  };
}

export default createSteps;
