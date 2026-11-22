'use strict';

// ===== 設定 =====
const W = 800;              // 論理解像度（横）
const H = 260;              // 論理解像度（縦）
const GROUND_Y = 220;       // 地面の高さ
const GRAVITY = 2400;       // px/s^2
const JUMP_VELOCITY = 720;  // px/s
const KICK_WINDOW = 0.25;   // 障害物到達まで何秒以内に押したらキックになるか
const KICK_DURATION = 0.22; // キックポーズの長さ（秒）
const START_SPEED = 360;    // px/s
const MAX_SPEED = 900;
const ACCEL = 9;            // 1秒ごとの加速量
const BEER_RATIO = 0.6;     // ビールが出る確率
const KICK_BONUS = 50;      // ビール1杯蹴るごとのボーナス

const COLOR = {
  bg: '#f7f7f7',
  ink: '#535353',
  sub: '#a0a0a0',
  beer: '#f2a81d',
  beerDark: '#c9820c',
  foam: '#ffffff',
  cola: '#3b1f14',
  colaLabel: '#d62828',
  hint: 'rgba(242, 168, 29, 0.35)',
};

// ===== キャンバス =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

// ===== ハイスコア =====
function loadHigh() {
  try { return Number(localStorage.getItem('fuji-kick-high')) || 0; } catch { return 0; }
}
function saveHigh(v) {
  try { localStorage.setItem('fuji-kick-high', String(v)); } catch { /* 無視 */ }
}

// ===== 状態 =====
const player = {
  x: 70,
  w: 34,
  h: 56,
  y: 0,       // 地面からの高さ（上が正）
  vy: 0,
  kickTimer: 0,
  runPhase: 0,
  get onGround() { return this.y <= 0; },
};

let state = 'title';   // title | playing | over
let speed = START_SPEED;
let distance = 0;
let kicks = 0;
let score = 0;
let high = loadHigh();
let obstacles = [];
let flying = [];       // 蹴られて飛んでいくビール
let particles = [];
let spawnTimer = 0;
let groundOffset = 0;
let overMessage = '';
let overTime = 0;
let clock = 0;

function reset() {
  player.y = 0;
  player.vy = 0;
  player.kickTimer = 0;
  speed = START_SPEED;
  distance = 0;
  kicks = 0;
  score = 0;
  obstacles = [];
  flying = [];
  particles = [];
  spawnTimer = 1.0;
}

function spawn() {
  const isBeer = Math.random() < BEER_RATIO;
  if (isBeer) {
    obstacles.push({ type: 'beer', x: W + 20, w: 26, h: 36 });
  } else {
    obstacles.push({ type: 'cola', x: W + 20, w: 18, h: 48 });
  }
  // 次の出現までの時間（ジャンプの滞空時間より短くならないように）
  const min = 0.75;
  const max = Math.max(1.0, 1.9 - (speed - START_SPEED) / 600);
  spawnTimer = min + Math.random() * (max - min);
}

// 自分の前にある、まだ処理されていない一番近い障害物
function nearestAhead() {
  let best = null;
  for (const o of obstacles) {
    if (o.x + o.w < player.x) continue;
    if (!best || o.x < best.x) best = o;
  }
  return best;
}

function timeToReach(o) {
  return (o.x - (player.x + player.w)) / speed;
}

function gameOver(message) {
  state = 'over';
  overMessage = message;
  overTime = clock;
  if (score > high) {
    high = score;
    saveHigh(high);
  }
}

// ===== 入力（1ボタン） =====
function press() {
  if (state === 'title') {
    reset();
    state = 'playing';
    return;
  }
  if (state === 'over') {
    if (clock - overTime < 0.6) return; // 連打で即リトライしないように
    reset();
    state = 'playing';
    return;
  }
  if (!player.onGround || player.kickTimer > 0) return;

  const target = nearestAhead();
  if (target && timeToReach(target) <= KICK_WINDOW) {
    kick(target);
  } else {
    player.vy = JUMP_VELOCITY;
  }
}

function kick(o) {
  player.kickTimer = KICK_DURATION;
  if (o.type === 'cola') {
    gameOver('コーラは蹴っちゃダメ！');
    return;
  }
  obstacles.splice(obstacles.indexOf(o), 1);
  flying.push({
    x: o.x, y: 0, w: o.w, h: o.h,
    vx: 250 + Math.random() * 150,
    vy: 650 + Math.random() * 200,
    rot: 0,
    vr: 10 + Math.random() * 6,
  });
  for (let i = 0; i < 14; i++) {
    particles.push({
      x: o.x + o.w / 2, y: o.h,
      vx: (Math.random() - 0.3) * 400,
      vy: 200 + Math.random() * 400,
      life: 0.6 + Math.random() * 0.4,
      color: Math.random() < 0.5 ? COLOR.beer : COLOR.foam,
    });
  }
  kicks++;
  score += KICK_BONUS;
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
    e.preventDefault();
    press();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  press();
});

// ===== 更新 =====
function update(dt) {
  clock += dt;
  if (state !== 'playing') {
    updateEffects(dt);
    return;
  }

  speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  const dx = speed * dt;
  distance += dx;
  score += dx / 10;
  groundOffset = (groundOffset + dx) % 40;

  // プレイヤー
  if (!player.onGround || player.vy > 0) {
    player.vy -= GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; }
  }
  if (player.kickTimer > 0) player.kickTimer -= dt;
  player.runPhase += dt * speed / 40;

  // 障害物
  spawnTimer -= dt;
  if (spawnTimer <= 0) spawn();
  for (const o of obstacles) o.x -= dx;
  obstacles = obstacles.filter((o) => o.x + o.w > -50);

  // 当たり判定
  const px1 = player.x + 6;
  const px2 = player.x + player.w - 6;
  for (const o of obstacles) {
    if (o.type === 'beer') {
      // ビールが体の真ん中まで来たのに蹴っていない → アウト
      if (o.x < player.x + player.w * 0.5) {
        if (player.onGround) {
          gameOver('ビールにつまづいた！');
        } else {
          gameOver('ビールから逃げるな！');
        }
        return;
      }
    } else {
      const overlapX = o.x < px2 && o.x + o.w > px1;
      const overlapY = player.y < o.h - 4;
      if (overlapX && overlapY) {
        gameOver('コーラにぶつかった！');
        return;
      }
    }
  }

  updateEffects(dt);
}

function updateEffects(dt) {
  const scroll = state === 'playing' ? speed * dt : 0;
  for (const f of flying) {
    f.x += f.vx * dt - scroll;
    f.vy -= GRAVITY * 0.6 * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
  }
  flying = flying.filter((f) => f.y > -100 && f.x < W + 100);
  for (const p of particles) {
    p.x += p.vx * dt - scroll;
    p.vy -= GRAVITY * 0.5 * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0 && p.y > -10);
}

// ===== 描画 =====
// ゲーム内の座標（y は地面からの高さ）を画面座標に
const sy = (y) => GROUND_Y - y;

function drawGround() {
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 0.5);
  ctx.lineTo(W, GROUND_Y + 0.5);
  ctx.stroke();
  ctx.fillStyle = COLOR.sub;
  for (let x = -groundOffset; x < W; x += 40) {
    ctx.fillRect(x + 8, GROUND_Y + 8, 6, 2);
    ctx.fillRect(x + 27, GROUND_Y + 15, 3, 2);
  }
}

function drawPlayer() {
  const x = player.x;
  const baseY = sy(player.y);
  const kicking = player.kickTimer > 0;
  ctx.strokeStyle = COLOR.ink;
  ctx.fillStyle = COLOR.ink;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  const hipX = x + 15;
  const hipY = baseY - 22;
  const neckY = baseY - 42;

  // 頭
  ctx.beginPath();
  ctx.arc(hipX + 2, baseY - 50, 8, 0, Math.PI * 2);
  ctx.fill();

  // 胴体
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(hipX + 2, neckY);
  ctx.stroke();

  // 腕
  const swing = Math.sin(player.runPhase) * 7;
  ctx.beginPath();
  ctx.moveTo(hipX + 1, neckY + 5);
  ctx.lineTo(hipX + 9 + swing, neckY + 15);
  ctx.moveTo(hipX + 1, neckY + 5);
  ctx.lineTo(hipX - 7 - swing, neckY + 15);
  ctx.stroke();

  // 脚
  ctx.beginPath();
  if (kicking) {
    // 前に蹴り出す
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX + 26, hipY + 10);
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX - 4, baseY);
  } else if (!player.onGround) {
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX + 10, hipY + 14);
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX - 8, hipY + 16);
  } else {
    const s = Math.sin(player.runPhase) * 9;
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX + s, baseY);
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX - s, baseY);
  }
  ctx.stroke();
}

function drawBeer(x, y, w, h) {
  // y は底の画面座標
  const top = y - h;
  // ジョッキ本体
  ctx.fillStyle = COLOR.beer;
  ctx.fillRect(x, top + 8, w - 6, h - 8);
  ctx.fillStyle = COLOR.beerDark;
  ctx.fillRect(x + 4, top + 12, 3, h - 16);
  // 泡
  ctx.fillStyle = COLOR.foam;
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 5, top + 7, 6, Math.PI, 0);
  ctx.arc(x + 13, top + 5, 7, Math.PI, 0);
  ctx.lineTo(x + w - 6, top + 8);
  ctx.lineTo(x, top + 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 輪郭
  ctx.strokeRect(x, top + 8, w - 6, h - 8);
  // 取っ手
  ctx.beginPath();
  ctx.moveTo(x + w - 6, top + 14);
  ctx.lineTo(x + w, top + 14);
  ctx.lineTo(x + w, top + h - 8);
  ctx.lineTo(x + w - 6, top + h - 8);
  ctx.stroke();
}

function drawCola(x, y, w, h) {
  const top = y - h;
  ctx.fillStyle = COLOR.cola;
  // 首
  ctx.fillRect(x + w / 2 - 3, top, 6, 12);
  // 胴
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 3, top + 12);
  ctx.lineTo(x, top + 22);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, top + 22);
  ctx.lineTo(x + w / 2 + 3, top + 12);
  ctx.closePath();
  ctx.fill();
  // ラベル
  ctx.fillStyle = COLOR.colaLabel;
  ctx.fillRect(x, top + 28, w, 9);
  // キャップ
  ctx.fillStyle = COLOR.colaLabel;
  ctx.fillRect(x + w / 2 - 4, top - 3, 8, 4);
}

function drawObstacles() {
  const target = state === 'playing' ? nearestAhead() : null;
  for (const o of obstacles) {
    // キックできる距離に入ったビールの足元を光らせる
    if (o === target && o.type === 'beer' && timeToReach(o) <= KICK_WINDOW) {
      ctx.fillStyle = COLOR.hint;
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, GROUND_Y, o.w, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.type === 'beer') drawBeer(o.x, GROUND_Y, o.w, o.h);
    else drawCola(o.x, GROUND_Y, o.w, o.h);
  }
  for (const f of flying) {
    ctx.save();
    ctx.translate(f.x + f.w / 2, sy(f.y) - f.h / 2);
    ctx.rotate(f.rot);
    drawBeer(-f.w / 2, f.h / 2, f.w, f.h);
    ctx.restore();
  }
  for (const p of particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillRect(p.x, sy(p.y), 4, 4);
    ctx.globalAlpha = 1;
  }
}

function pad(n) {
  return String(Math.floor(n)).padStart(5, '0');
}

function drawHud() {
  ctx.fillStyle = COLOR.ink;
  ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`HI ${pad(high)}  ${pad(score)}`, W - 16, 28);
  ctx.textAlign = 'left';
  ctx.fillText(`🍺 × ${kicks}`, 16, 28);
}

function drawCenter(lines) {
  ctx.textAlign = 'center';
  ctx.fillStyle = COLOR.ink;
  let y = 90;
  for (const [text, size, bold] of lines) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px -apple-system, "Hiragino Sans", sans-serif`;
    ctx.fillText(text, W / 2, y);
    y += size + 14;
  }
}

function draw() {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  drawGround();
  drawObstacles();
  drawPlayer();

  if (state === 'title') {
    drawCenter([
      ['FUJI-KICK', 40, true],
      ['ビールは引きつけて蹴る / コーラは早めにジャンプ', 16, false],
      ['タップ or スペースでスタート', 16, false],
    ]);
    ctx.textAlign = 'left';
  } else {
    drawHud();
    if (state === 'over') {
      drawCenter([
        ['GAME OVER', 36, true],
        [overMessage, 20, true],
        [clock - overTime >= 0.6 ? 'タップ or スペースでリトライ' : '', 16, false],
      ]);
      ctx.textAlign = 'left';
    }
  }
}

// ===== デバッグ用の自動操作（?auto） =====
const AUTO = new URLSearchParams(location.search).has('auto');
function autoPlay() {
  if (state !== 'playing') { if (state === 'title') press(); return; }
  const o = nearestAhead();
  if (!o) return;
  const t = timeToReach(o);
  if (o.type === 'beer' && t <= KICK_WINDOW * 0.5) press();
  if (o.type === 'cola' && t <= KICK_WINDOW + 0.05 && t > KICK_WINDOW) press();
}

// ===== ループ =====
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (AUTO) autoPlay();
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
