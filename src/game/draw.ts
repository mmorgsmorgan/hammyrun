import { RULES } from "../../shared/engine.mjs";
type C = CanvasRenderingContext2D;
function ellipse(
  c: C,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}
function round(
  c: C,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}
export function hamster(
  c: C,
  x: number,
  y: number,
  scale = 1,
  t = 0,
  running = false,
) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  const bounce = running ? Math.sin(t * 0.35) * 2 : Math.sin(t * 0.035) * 1.6;
  c.translate(0, bounce);
  ellipse(c, 0, 0, 37, 7, "#31482920");
  ellipse(c, -28, -25, 8, 8, "#bd8453");
  ellipse(c, -8, -31, 33, 31, "#bc824c");
  ellipse(c, -6, -34, 31, 29, "#d5a368");
  ellipse(c, -15, -50, 18, 14, "#dfb57a");
  ellipse(c, 19, -61, 12, 13, "#b97b4b");
  ellipse(c, 19, -62, 9, 10, "#e6b782");
  ellipse(c, 20, -62, 5, 6, "#d78d87");
  ellipse(c, -4, -62, 11, 12, "#c78b55");
  ellipse(c, -4, -63, 8, 9, "#e8bc86");
  ellipse(c, -3, -63, 4, 5, "#d99089");
  ellipse(c, 12, -34, 27, 27, "#e1ae70");
  ellipse(c, 13, -25, 23, 19, "#fff0d6");
  ellipse(c, 27, -29, 13, 12, "#f7e5c7");
  ellipse(c, 26, -46, 4, 5.6, "#2d3028");
  ellipse(c, 27, -48, 1.4, 1.8, "#fff");
  ellipse(c, 36, -31, 3.5, 2.7, "#ad7265");
  ellipse(c, 22, -34, 6, 3.8, "#eab0a0");
  c.strokeStyle = "#ad805c";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(33, -26);
  c.lineTo(43, -24);
  c.moveTo(33, -23);
  c.lineTo(42, -20);
  c.stroke();
  const foot = running ? Math.sin(t * 0.55) * 6 : 0;
  ellipse(c, -16 + foot, -3, 11, 5, "#aa7249");
  ellipse(c, 16 - foot, -3, 10, 5, "#b47c51");
  ellipse(c, 6, -16, 7, 5, "#deb483");
  c.restore();
}
export function seed(c: C, x: number, y: number, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  c.rotate(0.22);
  ellipse(c, 0, 1, 10, 13, "#c59737");
  ellipse(c, 0, -1, 8.3, 11, "#f1cf68");
  c.strokeStyle = "#fff1b0";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-2, -8);
  c.quadraticCurveTo(-5, 0, -2, 5);
  c.stroke();
  c.strokeStyle = "#c19a45";
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(2, -7);
  c.lineTo(2, 6);
  c.stroke();
  c.restore();
}
function plant(c: C, x: number, y: number, s = 1, color = "#8ca663") {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = "#688451";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(-2, -19, 3, -33);
  c.stroke();
  ellipse(c, -8, -19, 10, 5, color);
  ellipse(c, 9, -28, 11, 5, color);
  c.restore();
}
function cloud(c: C, x: number, y: number, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  ellipse(c, 0, 0, 35, 13, "#ffffffa0");
  ellipse(c, -14, -9, 17, 16, "#ffffffa0");
  ellipse(c, 10, -14, 23, 19, "#ffffffa0");
  c.restore();
}
export function draw(
  c: C,
  width: number,
  height: number,
  state: any,
  mode: string,
  time: number,
) {
  const vw = Math.min(1100, (width / height) * 420),
    sx = width / vw,
    sy = height / 420;
  c.save();
  c.scale(sx, sy);
  const active = ["running", "paused", "over"].includes(mode),
    travel = active ? state.distance * 20 : 0;
  c.fillStyle = "#e7f0e9";
  c.fillRect(0, 0, vw, 420);
  ellipse(c, vw - 95, 62, 28, 28, "#f9e9a6");
  ellipse(c, vw - 95, 62, 38, 38, "#f9e9a625");
  cloud(c, 75 - ((travel * 0.07) % (vw + 100)), 78, 0.85);
  cloud(c, vw * 0.54 - ((travel * 0.025) % 100), 52, 1.2);
  cloud(c, vw * 0.87, 124, 0.65);
  // Distant grassy hills, layered behind the garden fence.
  c.fillStyle = "#d1dfc5";
  c.beginPath();
  c.moveTo(0, 268);
  c.bezierCurveTo(vw * 0.18, 108, vw * 0.25, 134, vw * 0.49, 265);
  c.bezierCurveTo(vw * 0.74, 106, vw * 0.83, 192, vw, 247);
  c.lineTo(vw, 330);
  c.lineTo(0, 330);
  c.fill();
  c.fillStyle = "#c3d4b4";
  c.beginPath();
  c.moveTo(0, 290);
  c.bezierCurveTo(vw * 0.2, 224, vw * 0.29, 196, vw * 0.48, 283);
  c.bezierCurveTo(vw * 0.66, 173, vw * 0.8, 208, vw, 275);
  c.lineTo(vw, 336);
  c.lineTo(0, 336);
  c.fill();
  const off = (travel * 0.18) % 160;
  for (let x = -160 - off; x < vw + 160; x += 160) {
    round(c, x + 60, 242, 8, 62, 3, "#9eac83");
    ellipse(c, x + 64, 231, 25, 31, "#a7bf91");
    ellipse(c, x + 45, 241, 18, 22, "#aec598");
    ellipse(c, x + 82, 242, 18, 22, "#a7bf91");
  }
  round(c, 0, 274, vw, 7, 0, "#eee9d9");
  round(c, 0, 303, vw, 6, 0, "#eae4d1");
  const fenceOff = (travel * 0.34) % 42;
  for (let x = -fenceOff; x < vw + 42; x += 42) {
    c.fillStyle = "#f5f0df";
    c.beginPath();
    c.moveTo(x, 318);
    c.lineTo(x, 262);
    c.lineTo(x + 8, 255);
    c.lineTo(x + 16, 262);
    c.lineTo(x + 16, 318);
    c.fill();
  }
  // Garden bed.
  c.fillStyle = "#91ac68";
  c.fillRect(0, 318, vw, 13);
  c.fillStyle = "#c3a781";
  c.fillRect(0, 331, vw, 89);
  c.fillStyle = "#dcc5a0";
  c.fillRect(0, 331, vw, 12);
  for (let x = -travel % 35; x < vw; x += 35) {
    round(c, x, 324, 24, 9, 4, "#9bb874");
  }
  c.strokeStyle = "#b69772";
  c.lineWidth = 2;
  for (let x = -travel % 180; x < vw + 180; x += 180) {
    c.beginPath();
    c.moveTo(x, 368);
    c.lineTo(x + 22, 368);
    c.moveTo(x + 77, 393);
    c.lineTo(x + 96, 393);
    c.moveTo(x + 133, 351);
    c.lineTo(x + 142, 351);
    c.stroke();
    ellipse(c, x + 45, 384, 2, 2, "#ae8b64");
    ellipse(c, x + 121, 378, 3, 2, "#e7d2b2");
  }
  for (let x = (-travel * 0.8) % 210; x < vw + 210; x += 210) {
    plant(c, x + 20, 324, 0.65);
    plant(c, x + 185, 323, 0.4, "#c3cf8a");
    c.fillStyle = "#7f9b60";
    c.fillRect(x + 105, 302, 2, 23);
    ellipse(c, x + 106, 299, 6, 5, "#d79791");
    ellipse(c, x + 100, 298, 4, 6, "#e4aaa0");
    ellipse(c, x + 111, 298, 4, 6, "#e6b1a4");
  }
  for (const o of active ? state.objects : []) {
    if (o.kind === "seed") seed(c, o.x, o.y, 0.85);
    else if (o.kind === "pot") pot(c, o.x, o.y);
    else rock(c, o.x, o.y);
  }
  if (active)
    hamster(c, RULES.playerX, state.y, 1.03, state.tick, mode === "running");
  else {
    hamster(c, vw * 0.23, 325, vw < 600 ? 1.35 : 1.75, time, false);
    for (let i = 0; i < 5; i++)
      seed(
        c,
        vw * 0.45 + i * 44,
        282 - Math.sin((i / 4) * Math.PI) * 29 + Math.sin(time * 0.035 + i) * 2,
        0.9,
      );
    pot(c, vw * 0.83, 326);
    plant(c, vw * 0.92, 324, 1.1);
  }
  c.restore();
}
function pot(c: C, x: number, y: number) {
  c.save();
  c.translate(x, y);
  c.fillStyle = "#b98265";
  c.beginPath();
  c.moveTo(-18, -44);
  c.lineTo(18, -44);
  c.lineTo(13, 0);
  c.lineTo(-13, 0);
  c.closePath();
  c.fill();
  round(c, -22, -52, 44, 12, 4, "#cb9778");
  round(c, -12, -39, 5, 29, 2, "#d9a585");
  plant(c, 0, -50, 0.6, "#789953");
  c.restore();
}
function rock(c: C, x: number, y: number) {
  c.fillStyle = "#9aa28b";
  c.beginPath();
  c.moveTo(x - 27, y);
  c.lineTo(x - 24, y - 19);
  c.lineTo(x - 9, y - 35);
  c.lineTo(x + 12, y - 30);
  c.lineTo(x + 25, y - 12);
  c.lineTo(x + 26, y);
  c.fill();
  c.fillStyle = "#b3baa4";
  c.beginPath();
  c.moveTo(x - 24, y - 19);
  c.lineTo(x - 9, y - 35);
  c.lineTo(x + 4, y - 27);
  c.lineTo(x - 6, y - 16);
  c.fill();
}
