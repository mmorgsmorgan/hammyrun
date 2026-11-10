// Fixed 60 Hz simulation shared by the browser and the score verifier.
export const RULES = Object.freeze({
  width: 1000,
  height: 420,
  ground: 326,
  playerX: 150,
  maxTicks: 18000,
  jumpVelocity: -13.8,
  gravity: 0.66,
});
export function createRun(seed) {
  return {
    seed: seed >>> 0 || 1,
    tick: 0,
    distance: 0,
    coins: 0,
    y: RULES.ground,
    vy: 0,
    jumps: 0,
    dead: false,
    objects: [],
    spawn: 95,
    nextId: 1,
  };
}
function random(s) {
  let n = s.seed;
  n ^= n << 13;
  n ^= n >>> 17;
  n ^= n << 5;
  s.seed = n >>> 0;
  return s.seed / 4294967296;
}
export function step(s, jump = false) {
  if (s.dead || s.tick >= RULES.maxTicks) return s;
  if (jump && s.jumps < 2) {
    s.vy = s.jumps ? -11.2 : RULES.jumpVelocity;
    s.jumps++;
  }
  s.tick++;
  s.vy += RULES.gravity;
  s.y += s.vy;
  if (s.y >= RULES.ground) {
    s.y = RULES.ground;
    s.vy = 0;
    s.jumps = 0;
  }
  const speed = 4.4 + Math.min(4, s.tick / 2400);
  s.distance += speed / 20;
  if (--s.spawn <= 0) {
    const kind = random(s) > 0.5 ? "pot" : "rock";
    s.objects.push({
      id: s.nextId++,
      kind,
      x: 1080,
      y: RULES.ground,
      w: kind === "pot" ? 39 : 49,
      h: kind === "pot" ? 53 : 34,
    });
    for (let i = 0; i < 5; i++)
      s.objects.push({
        id: s.nextId++,
        kind: "seed",
        x: 1010 + i * 42,
        y: RULES.ground - 84 - Math.sin((i / 4) * Math.PI) * 55,
        w: 22,
        h: 26,
      });
    s.spawn = 115 + Math.floor(random(s) * 60) - Math.floor(speed * 4);
  }
  for (const o of s.objects) {
    o.x -= speed;
    if (o.kind === "seed") {
      if (
        Math.abs(o.x - RULES.playerX) < 38 &&
        Math.abs(o.y - (s.y - 28)) < 42
      ) {
        o.taken = true;
        s.coins++;
      }
    } else if (
      Math.abs(o.x - RULES.playerX) < o.w / 2 + 21 &&
      s.y - 7 > o.y - o.h &&
      s.y - 48 < o.y
    )
      s.dead = true;
  }
  s.objects = s.objects.filter((o) => o.x > -80 && !o.taken);
  return s;
}
export function replay(seed, jumps, ticks) {
  if (
    !Number.isInteger(ticks) ||
    ticks < 1 ||
    ticks > RULES.maxTicks ||
    !Array.isArray(jumps) ||
    jumps.length > 2000
  )
    throw new Error("Invalid run transcript.");
  let previous = -1;
  for (const t of jumps) {
    if (!Number.isInteger(t) || t < 0 || t >= ticks || t <= previous)
      throw new Error("Invalid jump sequence.");
    previous = t;
  }
  const s = createRun(seed);
  let j = 0;
  for (let i = 0; i < ticks; i++) {
    if (s.dead) throw new Error("Run continued after collision.");
    step(s, jumps[j] === i);
    if (jumps[j] === i) j++;
  }
  return {
    coins: s.coins,
    distance: Math.floor(s.distance),
    ticks: s.tick,
    dead: s.dead,
  };
}
