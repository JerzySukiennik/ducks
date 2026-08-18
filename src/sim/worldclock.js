// The day, the weather and the things that interrupt them.
//
// One module, because they are one thing: a clock that the yard looks and
// behaves differently at different points of. Splitting them would mean three
// timers that can disagree about what time it is, and the first bug would be
// rain at noon on a clear day.
//
// It DECIDES and it REPORTS. It never touches a light, a material or a duck --
// the renderer reads `sky()` every frame and the simulation reads `wind()`, and
// neither has to know that a storm is a thing. That is what keeps this file
// free of three.js in a src/sim that is not allowed to import it.
//
// THE ONE RULE THAT MATTERS: weather changes the WORLD, never the money. A
// storm that halved your income would be a punishment for playing at the wrong
// time, and the player did not choose the time. It blows ducks about, it makes
// the yard darker, it changes what you can see -- all things a factory can be
// built to survive.

function num(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[worldclock] config.${name} is missing or not a finite number`);
  }
  return v;
}

// The weather table. `wind` is metres per second of sideways push on a loose
// duck, `dark` is how much light the sky loses, `fog` multiplies the view
// distance. A clear day is all zeros, which is why it is not in the table.
// WIND IS AN ACCELERATION IN METRES PER SECOND SQUARED, and there is a floor
// under it that the first version of this table did not clear.
//
// A duck resting on concrete is held by friction worth mu * g, and in this
// game that is about 8.5 m/s^2. Anything under that number moves a resting
// duck exactly nowhere: measured, a 'storm' of 2.1 blew five ducks a total of
// 0.00 m in three seconds, which is a weather system that reports itself in
// the corner of the screen and does nothing at all.
//
// So the table is written against that floor on purpose:
//   breeze 3.0   BELOW it. A breeze genuinely does not move a duck that is
//                sitting still -- it only pushes ones already rolling or in
//                the air, which is what a breeze does.
//   rain   7.0   still under the floor for a duck at rest, over it for one on
//                a slope or a belt.
//   storm  11.0  over it, with 2.5 m/s^2 of headroom. At 14 the net was 5.5 and
//                a three-second gust moved a duck 27 m -- across the whole yard,
//                which is not weather, that is a broom.
export const WEATHER = {
  clear: { wind: 0, dark: 0, fog: 1, name: 'Clear' },
  breeze: { wind: 3.0, dark: 0.05, fog: 0.95, name: 'Breezy' },
  rain: { wind: 7.0, dark: 0.3, fog: 0.72, name: 'Rain' },
  storm: { wind: 11.0, dark: 0.5, fog: 0.5, name: 'Storm' },
  fog: { wind: 0, dark: 0.18, fog: 0.34, name: 'Fog' },
};

// What can interrupt a day. Each is a window during which one number is
// different, and each says so on screen -- an event nobody notices is a
// coin flip the game made without telling anybody.
export const EVENTS = {
  golden: { seconds: 60, name: 'Golden Minute', line: 'Every duck is one rung better.', rungBonus: 1 },
  downpour: { seconds: 75, name: 'Downpour', line: 'Ducks everywhere. Mind the wind.', weather: 'storm', spawnMul: 2.5 },
  calm: { seconds: 90, name: 'Still Air', line: 'Nothing is blowing anything anywhere.', weather: 'clear' },
};

export function createWorldClock({ config, rng }) {
  const C = {
    dayLengthSeconds: num(config.worldclock.dayLengthSeconds, 'worldclock.dayLengthSeconds'),
    startFraction: num(config.worldclock.startFraction, 'worldclock.startFraction'),
    nightFloor: num(config.worldclock.nightFloor, 'worldclock.nightFloor'),
    weatherMinSeconds: num(config.worldclock.weatherMinSeconds, 'worldclock.weatherMinSeconds'),
    weatherMaxSeconds: num(config.worldclock.weatherMaxSeconds, 'worldclock.weatherMaxSeconds'),
    eventFirstSeconds: num(config.worldclock.eventFirstSeconds, 'worldclock.eventFirstSeconds'),
    eventGapSeconds: num(config.worldclock.eventGapSeconds, 'worldclock.eventGapSeconds'),
    eventJitterSeconds: num(config.worldclock.eventJitterSeconds, 'worldclock.eventJitterSeconds'),
  };
  const random = typeof rng === 'function' ? rng : Math.random;
  const kinds = Object.keys(WEATHER);
  const eventKinds = Object.keys(EVENTS);

  let t = C.startFraction * C.dayLengthSeconds;
  let weather = 'clear';
  let weatherUntil = C.weatherMinSeconds;
  let event = null;
  let eventUntil = 0;
  let nextEventAt = C.eventFirstSeconds;
  let clock = 0;
  let events = [];

  function rollWeather() {
    // Clear is weighted heavily on purpose. Weather is seasoning: a yard that is
    // always doing something dramatic has no dramatic moments in it.
    const bag = ['clear', 'clear', 'clear', 'breeze', 'breeze', 'rain', 'fog', 'storm'];
    const pick = bag[Math.floor(random() * bag.length) % bag.length];
    if (pick === weather) return;
    weather = pick;
    events.push({ type: 'weather', weather, spec: WEATHER[weather] });
  }

  function startEvent(kind) {
    const spec = EVENTS[kind];
    if (!spec) return null;
    event = kind;
    eventUntil = clock + spec.seconds;
    if (spec.weather && spec.weather !== weather) {
      weather = spec.weather;
      weatherUntil = eventUntil + 10;
      events.push({ type: 'weather', weather, spec: WEATHER[weather] });
    }
    events.push({ type: 'eventStart', event: kind, spec });
    return kind;
  }

  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) return null;
    clock += dt;
    t = (t + dt) % C.dayLengthSeconds;

    if (clock >= weatherUntil) {
      rollWeather();
      weatherUntil = clock + C.weatherMinSeconds
        + random() * (C.weatherMaxSeconds - C.weatherMinSeconds);
    }
    if (event && clock >= eventUntil) {
      events.push({ type: 'eventEnd', event });
      event = null;
      nextEventAt = clock + C.eventGapSeconds + random() * C.eventJitterSeconds;
    } else if (!event && clock >= nextEventAt) {
      startEvent(eventKinds[Math.floor(random() * eventKinds.length) % eventKinds.length]);
    }
    return sky();
  }

  // WHERE THE SUN IS AND HOW BRIGHT IT IS, as plain numbers the renderer can
  // apply without knowing what time means. `light` is 0..1 of the configured
  // full daylight; `elevation` is 0 at the horizon and 1 overhead.
  function sky() {
    const frac = t / C.dayLengthSeconds;
    // Noon at 0.5, midnight at 0 -- so a session that starts at startFraction
    // 0.25 starts at dawn, which is what a factory day should look like.
    const elevation = Math.sin(frac * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
    const w = WEATHER[weather] || WEATHER.clear;
    const day = C.nightFloor + (1 - C.nightFloor) * elevation;
    return {
      fraction: frac,
      hour: Math.floor(frac * 24),
      minute: Math.floor((frac * 24 % 1) * 60),
      elevation,
      // The sun goes round the yard once a day. Yaw only: a sun that dipped
      // below the plate would light the underside of everything.
      sunYaw: frac * Math.PI * 2,
      light: Math.max(0, day * (1 - w.dark)),
      fog: w.fog,
      weather,
      weatherName: w.name,
      wind: w.wind,
      event,
      eventName: event ? EVENTS[event].name : null,
      eventRemaining: event ? Math.max(0, Math.round((eventUntil - clock) * 10) / 10) : 0,
    };
  }

  // What the simulation asks for: how hard the wind is blowing and which way.
  // The direction turns with the day, so a factory built to shelter from a
  // morning wind is not sheltered from an evening one.
  function wind() {
    const w = WEATHER[weather] || WEATHER.clear;
    if (!w.wind) return { x: 0, z: 0, speed: 0 };
    const a = (t / C.dayLengthSeconds) * Math.PI * 2;
    return { x: Math.cos(a) * w.wind, z: Math.sin(a) * w.wind, speed: w.wind };
  }

  // The one number an event is allowed to change about a duck: how many rungs
  // it is nudged up as it is made. Read by the producers; 0 the rest of the time.
  function rungBonus() {
    return event && EVENTS[event].rungBonus ? EVENTS[event].rungBonus : 0;
  }

  function spawnMul() {
    return event && EVENTS[event].spawnMul ? EVENTS[event].spawnMul : 1;
  }

  return {
    update,
    sky,
    wind,
    rungBonus,
    spawnMul,
    weather: () => weather,
    event: () => event,
    setWeather(w) {
      if (!WEATHER[w]) return null;
      weather = w;
      weatherUntil = clock + C.weatherMaxSeconds;
      events.push({ type: 'weather', weather, spec: WEATHER[weather] });
      return weather;
    },
    startEvent,
    setFraction(f) {
      const n = Number(f);
      if (!isFinite(n)) return null;
      t = ((n % 1) + 1) % 1 * C.dayLengthSeconds;
      return t / C.dayLengthSeconds;
    },
    consumeEvents() {
      if (!events.length) return [];
      const out = events;
      events = [];
      return out;
    },
  };
}

export default createWorldClock;
