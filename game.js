'use strict';

// ===== 設定 =====
// ゲームバランスは Chrome の恐竜ゲーム（chromium/components/neterror/resources/dino_game）に合わせている。
// 本家の値（600x150 のステージ、px/フレーム @60fps）を SCALE 倍して px/秒 に直して使う。
const SCALE = 1.6;          // 本家の恐竜(47px)と藤くん(74px)の身長比
const FPS = 60;
const dino = (v) => v * SCALE * FPS;          // 本家の 速度(px/フレーム) → px/秒
const dinoAcc = (v) => v * SCALE * FPS * FPS; // 本家の 加速度(px/フレーム^2) → px/秒^2

const MAX_W = 600 * SCALE;  // 960。ステージの最大幅
let W = MAX_W;              // ステージの幅。画面が狭いと本家と同じく狭くなる（resize で決まる）
const H = 150 * SCALE;      // 240
const GROUND_Y = H - 10 * SCALE; // 本家の bottomPad 10

// 速度（本家: speed 6, maxSpeed 13, acceleration 0.001/フレーム）
const START_SPEED = dino(6);
const MAX_SPEED = dino(13);
const ACCEL = dinoAcc(0.001);

// ジャンプ（本家 trex.ts の normalJumpConfig）
const GRAVITY = dinoAcc(0.6);
const JUMP_BASE = 10;               // 初速 = 10 + 速度/10 （本家の単位）
const MIN_JUMP_HEIGHT = 30 * SCALE; // これより上がるまではボタンを離しても上昇を続ける
const MAX_JUMP_HEIGHT = 63 * SCALE; // ここまで来たら減速（本家は画面上端から30px = 地面から63px）
const DROP_VELOCITY = dino(5);      // 減速後の上昇速度

// 障害物（本家: gapCoefficient 0.6, maxGapCoefficient 1.5, maxObstacleDuplication 2, clearTime 3000ms）
const GAP_COEFFICIENT = 0.6;
const MAX_GAP_COEFFICIENT = 1.5;
const MAX_DUPLICATION = 2;
const CLEAR_TIME = 3;               // 最初の障害物が出るまでの秒数

// fuji-kick 独自
const KICK_WINDOW = 0.06;   // 障害物到達まで何秒以内に押したらキックになるか
const TRIP_OFFSET = 4;      // ビールがプレイヤー左端からこの位置(px)まで来たらつまづく
const KICK_DURATION = 0.18; // キックポーズの長さ（秒）
const KICK_LOCK = 0.08;     // キック直後、次の入力を受け付けない時間（秒）
const BEER_RATIO = 0.6;     // ビールが出る確率（残りはコーラ瓶とペットボトルが半々）
const KICK_BONUS = 50;      // ビール1杯蹴るごとのボーナス
const EFFECT_GRAVITY = 2400; // 蹴ったビールや泡の落ち方

// 障害物の種類。minGap / multipleSpeed は本家のサボテンの値（本家の単位）
const OBSTACLE_TYPES = {
  beer:   { w: 26, h: 36, minGap: 120, multipleSpeed: Infinity }, // 小サボテン相当。並びはなし
  cola:   { w: 18, h: 48, minGap: 120, multipleSpeed: 4 },        // 小サボテン相当
  bigCola: { w: 24, h: 60, minGap: 120, multipleSpeed: 7 },       // 大サボテン相当
};
const MAX_OBSTACLE_LENGTH = 3; // 最大何本並ぶか

const COLOR = {
  bg: '#f7f7f7',
  ink: '#535353',
  sub: '#a0a0a0',
  beer: '#f2a81d',
  beerDark: '#c9820c',
  foam: '#ffffff',
  cola: '#3b1f14',
  colaLabel: '#d62828',
};

// ===== キャンバス =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// 本家はスマホでは拡大縮小せず実寸（恐竜47px）で表示し、ステージの幅を画面幅に合わせて狭める。
// ここでも、藤くんが本家の恐竜より小さくならない倍率（1/SCALE）を下限にして、足りない分はステージを狭める。
const MIN_DISPLAY_SCALE = 1 / SCALE;
let displayScale = 1;
function resize() {
  const cssW = Math.min(window.innerWidth, MAX_W);
  displayScale = Math.max(MIN_DISPLAY_SCALE, cssW / MAX_W);
  W = Math.round(cssW / displayScale);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${H * displayScale}px`;
  canvas.width = Math.round(W * displayScale * dpr);
  canvas.height = Math.round(H * displayScale * dpr);
  ctx.setTransform(displayScale * dpr, 0, 0, displayScale * dpr, 0, 0);
}

// 本家と同じく、ステージが狭いときは初速を落とす（mobileSpeedCoefficient 1.2）
function startSpeed() {
  return W < MAX_W ? Math.min(START_SPEED, START_SPEED * (W / MAX_W) * 1.2) : START_SPEED;
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
  x: 50 * SCALE,
  w: 34,
  y: 0,       // 地面からの高さ（上が正）
  vy: 0,
  jumping: false,
  reachedMinHeight: false,
  kickTimer: 0,
  runPhase: 0,
  get onGround() { return !this.jumping; },
};

let state = 'title';   // title | playing | over
let speed = START_SPEED;
let distance = 0;
let kicks = 0;
let score = 0;
let high = loadHigh();
let obstacles = [];
let obstacleHistory = []; // 直近に出した種類（新しい順）
let runningTime = 0;
let flying = [];       // 蹴られて飛んでいくビール
let particles = [];
let groundOffset = 0;
let overMessage = '';
let overTime = 0;
let clock = 0;

function reset() {
  player.y = 0;
  player.vy = 0;
  player.jumping = false;
  player.kickTimer = 0;
  speed = startSpeed();
  distance = 0;
  kicks = 0;
  score = 0;
  obstacles = [];
  obstacleHistory = [];
  runningTime = 0;
  flying = [];
  particles = [];
}

// ===== 障害物の出し方（本家 horizon.ts / obstacle.ts と同じ） =====
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const dinoSpeed = () => speed / (SCALE * FPS); // 本家の単位の速度

function pickType() {
  if (Math.random() < BEER_RATIO) return 'beer';
  return Math.random() < 0.5 ? 'cola' : 'bigCola';
}

// 同じ種類が MAX_DUPLICATION 回続いていたら true
function isDuplicate(type) {
  let count = 0;
  for (const t of obstacleHistory) count = t === type ? count + 1 : 0;
  return count >= MAX_DUPLICATION;
}

function addNewObstacle() {
  let type = pickType();
  while (isDuplicate(type)) type = pickType();
  const conf = OBSTACLE_TYPES[type];
  const sd = dinoSpeed();
  let size = randInt(1, MAX_OBSTACLE_LENGTH);
  if (size > 1 && conf.multipleSpeed > sd) size = 1;
  const width = conf.w * size;
  // 本家: minGap = 幅 × 速度 + minGap × gapCoefficient、maxGap = minGap × 1.5（本家の単位で計算して拡大）
  const minGap = (width / SCALE) * sd + conf.minGap * GAP_COEFFICIENT;
  const gap = (minGap + Math.random() * (minGap * MAX_GAP_COEFFICIENT - minGap)) * SCALE;
  obstacles.push({
    type, size, x: W + conf.w, w: width, unitW: conf.w, h: conf.h, gap,
    kicked: false, followingCreated: false,
  });
  obstacleHistory.unshift(type);
  obstacleHistory.length = Math.min(obstacleHistory.length, MAX_DUPLICATION);
}

function updateSpawning() {
  if (runningTime < CLEAR_TIME) return;
  const last = obstacles.at(-1);
  if (!last) {
    addNewObstacle();
  } else if (!last.followingCreated && last.x + last.w + last.gap < W) {
    addNewObstacle();
    last.followingCreated = true;
  }
}

// 自分の前にある、まだ処理されていない一番近い障害物
function nearestAhead() {
  let best = null;
  for (const o of obstacles) {
    if (o.kicked || o.x + o.w < player.x) continue;
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
  if (!player.onGround || player.kickTimer > KICK_DURATION - KICK_LOCK) return;

  const target = nearestAhead();
  if (target && timeToReach(target) <= KICK_WINDOW) {
    kick(target);
  } else {
    startJump();
  }
}

// ボタンを離した（本家と同じく、離すとジャンプが少し低くなる）
function release() {
  endJump();
}

function startJump() {
  player.jumping = true;
  player.reachedMinHeight = false;
  player.vy = dino(JUMP_BASE + dinoSpeed() / 10);
}

function endJump() {
  if (player.jumping && player.reachedMinHeight && player.vy > DROP_VELOCITY) {
    player.vy = DROP_VELOCITY;
  }
}

function updateJump(dt) {
  if (!player.jumping) return;
  player.y += player.vy * dt;
  player.vy -= GRAVITY * dt;
  if (player.y > MIN_JUMP_HEIGHT) player.reachedMinHeight = true;
  if (player.y > MAX_JUMP_HEIGHT) endJump();
  if (player.y <= 0) {
    player.y = 0;
    player.vy = 0;
    player.jumping = false;
  }
}

function kick(o) {
  player.kickTimer = KICK_DURATION;
  if (o.type !== 'beer') {
    gameOver('コーラは蹴っちゃダメ！');
    return;
  }
  o.kicked = true;
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

const isActionKey = (e) => e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter';
window.addEventListener('keydown', (e) => {
  if (!isActionKey(e)) return;
  e.preventDefault();
  if (!e.repeat) press();
});
window.addEventListener('keyup', (e) => {
  if (isActionKey(e)) release();
});
// 本家と同じく画面のどこをタップしても反応する
window.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  press();
});
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// ===== 更新 =====
function update(dt) {
  clock += dt;
  if (state !== 'playing') {
    updateEffects(dt);
    return;
  }

  runningTime += dt;
  speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  const dx = speed * dt;
  distance += dx;
  score += dx / 10;
  groundOffset = (groundOffset + dx) % 40;

  // プレイヤー
  updateJump(dt);
  if (player.kickTimer > 0) player.kickTimer -= dt;
  player.runPhase += dt * speed / 40;

  // 障害物
  for (const o of obstacles) o.x -= dx;
  obstacles = obstacles.filter((o) => o.x + o.w > -50);
  updateSpawning();

  // 当たり判定
  const px1 = player.x + 6;
  const px2 = player.x + player.w - 6;
  for (const o of obstacles) {
    if (o.kicked) continue;
    if (o.type === 'beer') {
      // ビールが体の後ろ側まで来たのに蹴っていない → アウト
      if (o.x < player.x + TRIP_OFFSET) {
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
    f.vy -= EFFECT_GRAVITY * 0.6 * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
  }
  flying = flying.filter((f) => f.y > -100 && f.x < W + 100);
  for (const p of particles) {
    p.x += p.vx * dt - scroll;
    p.vy -= EFFECT_GRAVITY * 0.5 * dt;
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

// ===== 藤くんのドット絵 =====
// 1文字 = 1ドット。'.' は透明。右向き。
const PIXEL = 2; // 1ドットの大きさ(px)
const PALETTE = {
  H: '#1c1c1c', // 髪
  h: '#454545', // 髪のツヤ（パーマのうねり）
  S: '#eec4a0', // 肌
  s: '#d9a682', // 肌の影
  E: '#2a1a12', // 目（笑って細くなってる）
  M: '#8a3b2e', // 口
  T: '#ffffff', // 歯
  K: '#262626', // 黒パーカー
  k: '#141414', // パーカーの影（腕・ポケット・裾のリブ）
  F: '#3d3d3d', // フード（髪や服と区別できるよう少し明るく）
  f: '#0e0e0e', // フードの内側の影
  P: '#363a42', // ワイドパンツ
  W: '#c9c4bb', // スニーカー
  O: '#8c867c', // ソール
};

const BODY = [
  '.....HHHHHH',
  '...HHHHHHHHHH',
  '..HHHHHHhhHHHH',
  '.HHHhhHHHHHHHHH',
  '.HHHHHHHHHhhHHHH',
  'HHHHHHHHHHHHHHHH',
  'HHhhHHHHHHHHHHHH',
  'HHHHHHHHhhHHHHHH',
  'HHHHHHHSHHSSSHHS',
  '.HHHHHSSSSSSSSSS',
  'HHHHHsSSSEESSEES',
  '.HHHSsSSSSSSSSSS',
  '.HHHSSSSSMTTTMS',
  '.FHHHsSSSSMMMS',
  'FKKKfsSSSSSSS',
  'FKKKKfsSSSS',
  'FKKKKKfKKKKKK',
  'FKKKKKKfKKKKK',
  '.fKKKkKKKKKKK',
  '..ffKkKKKKKKK',
  '..KKKkKKKKKKK',
  '..KKKkKkkkkkK',
  '..KKKkKKKKKKK',
  '..KKKSSKKKKKK',
  '..kkkkkkkkkkk',
];

const LEGS = {
  run1: [
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '..PPPP.PPPPP',
    '..PPPP..PPPP',
    '..PPP....PPPP',
    '.PPPP....PPPP',
    '.PPP......PPPP',
    '.PPP......PPPP',
    'PPPP.......PPPP',
    'WWWW.......WWWWW',
    'OOOO.......OOOOO',
  ],
  run2: [
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '...PPPPPPPP',
    '....PPPPPPP',
    '....PPPPPP',
    '....PPPPPP',
    '....PPPPPP',
    '....PPPPPP',
    '....PPPPPP',
    '....WWWWWWW',
    '....OOOOOOO',
  ],
  jump: [
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '..PPPPPPPPPPP',
    '.PPPPPPPPPPPPP',
    'PPPPP....PPPPP',
    'PPPP......PPPP',
    'PPPP......PPPP',
    'WWWW......PPPP',
    'OOOO......PPPP',
    '..........WWWWW',
    '..........OOOOO',
  ],
  kick: [
    '...PPPPPPPPP',
    '...PPPPPPPPPPPPPPPPPWWW',
    '...PPPPPPPPPPPPPPPPPWWWO',
    '...PPPPP...........WWWWO',
    '...PPPP',
    '...PPPP',
    '...PPPP',
    '...PPPP',
    '...PPPP',
    '...PPPP',
    '..WWWWWW',
    '..OOOOOO',
  ],
};

const HEM_OVERLAP = 0; // 裾が脚に重なる行数
const SPRITE_ROWS = BODY.length - HEM_OVERLAP + 12; // 足元までの行数（走り・キック基準）

// ドット絵は 1ドット=1px の画像にしてから拡大して描く。
// 1ドットずつ fillRect すると、半端な倍率のときにドットの間に隙間（網目）が出るため。
const pixelImages = new Map();
function pixelImage(rows) {
  let img = pixelImages.get(rows);
  if (!img) {
    img = document.createElement('canvas');
    img.width = Math.max(...rows.map((r) => r.length));
    img.height = rows.length;
    const c = img.getContext('2d');
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const color = PALETTE[row[i]];
        if (!color) continue;
        c.fillStyle = color;
        c.fillRect(i, r, 1, 1);
      }
    });
    pixelImages.set(rows, img);
  }
  return img;
}

function drawPixels(c, rows, x, y) {
  const img = pixelImage(rows);
  c.imageSmoothingEnabled = false;
  c.drawImage(img, x, y, img.width * PIXEL, img.height * PIXEL);
}

function drawFuji(c, x, baseY, pose, bob = 0) {
  // 足元（最終行の下）が baseY に来るように配置。ジャンプは脚を畳むので少し上がる
  const top = baseY - SPRITE_ROWS * PIXEL;
  drawPixels(c, LEGS[pose], x, top + (BODY.length - HEM_OVERLAP) * PIXEL);
  drawPixels(c, BODY, x, top + bob); // 走りの上下動は上半身だけ（沈み込む）
}

function drawPlayer() {
  let pose;
  if (player.kickTimer > 0) pose = 'kick';
  else if (!player.onGround) pose = 'jump';
  else pose = Math.floor(player.runPhase / 2) % 2 === 0 ? 'run1' : 'run2';
  const bob = pose === 'run2' ? PIXEL : 0;
  drawFuji(ctx, player.x - 1, Math.round(sy(player.y)), pose, bob);
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

// ペットボトルのコーラ（大サボテン相当）
function drawBigCola(x, y, w, h) {
  const top = y - h;
  // キャップ
  ctx.fillStyle = COLOR.colaLabel;
  ctx.fillRect(x + w / 2 - 4, top, 8, 5);
  // 首（透明な部分）
  ctx.fillStyle = '#d9d0c7';
  ctx.fillRect(x + w / 2 - 4, top + 5, 8, 5);
  // 肩〜胴
  ctx.fillStyle = COLOR.cola;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 4, top + 10);
  ctx.lineTo(x + 1, top + 20);
  ctx.lineTo(x + 1, y - 3);
  ctx.lineTo(x + 3, y);
  ctx.lineTo(x + w - 3, y);
  ctx.lineTo(x + w - 1, y - 3);
  ctx.lineTo(x + w - 1, top + 20);
  ctx.lineTo(x + w / 2 + 4, top + 10);
  ctx.closePath();
  ctx.fill();
  // ラベル
  ctx.fillStyle = COLOR.colaLabel;
  ctx.fillRect(x + 1, top + 28, w - 2, 13);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 4, top + 33, w - 8, 2);
  // 反射
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + 4, top + 44, 2, h - 50);
}

function drawObstacles() {
  for (const o of obstacles) {
    if (o.kicked) continue;
    for (let i = 0; i < o.size; i++) {
      const x = o.x + i * o.unitW;
      if (o.type === 'beer') drawBeer(x, GROUND_Y, o.unitW, o.h);
      else if (o.type === 'cola') drawCola(x, GROUND_Y, o.unitW, o.h);
      else drawBigCola(x, GROUND_Y, o.unitW, o.h);
    }
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
  if (o.type !== 'beer' && t <= KICK_WINDOW + 0.12 && t > KICK_WINDOW) press();
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
