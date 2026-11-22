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

// ===== キャラは遊ぶたびに藤くん→みおちゃん→…と交代する（次の番をブラウザに覚えておく） =====
const otherCharacter = (id) => (id === 'mio' ? 'fuji' : 'mio');
function loadNextCharacter() {
  try { return localStorage.getItem('fuji-kick-next') === 'mio' ? 'mio' : 'fuji'; } catch { return 'fuji'; }
}
function saveNextCharacter(id) {
  try { localStorage.setItem('fuji-kick-next', id); } catch { /* 無視 */ }
}

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
let characterId = loadNextCharacter(); // 今（タイトルでは次に）走るキャラ。fuji | mio
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
let groundScroll = 0;  // 地面がどれだけ流れたか（px）
let clouds = [];
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
  // ランキング（ranking.js）にスコアを渡す
  window.FujiRanking?.onGameOver({ score: Math.floor(score), kicks, duration: runningTime, character: characterId });
}

// ===== 入力（1ボタン） =====
// ゲーム開始。リトライのときは前回と別のキャラに交代する
function startGame() {
  if (state === 'over') characterId = otherCharacter(characterId);
  saveNextCharacter(otherCharacter(characterId));
  window.FujiRanking?.hide();
  reset();
  state = 'playing';
}

function press() {
  if (state === 'title') {
    startGame();
    return;
  }
  if (state === 'over') {
    if (clock - overTime < 0.6) return; // 連打で即リトライしないように
    if (window.FujiRanking?.blocksRetry()) return; // 名前の入力中など
    startGame();
    return;
  }
  if (!player.onGround || player.kickTimer > KICK_DURATION - KICK_LOCK) return;

  // みおちゃんはビールを蹴らない。いつでもジャンプ
  if (!currentCharacter().canKick) {
    startJump();
    return;
  }

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
// 名前の入力欄やボタンの操作はゲームの入力として扱わない
const isUiEvent = (e) => e.target instanceof Element && e.target.closest('.ui');
window.addEventListener('keydown', (e) => {
  if (!isActionKey(e) || isUiEvent(e)) return;
  e.preventDefault();
  if (!e.repeat) press();
});
window.addEventListener('keyup', (e) => {
  if (isActionKey(e)) release();
});
// 本家と同じく画面のどこをタップしても反応する
window.addEventListener('pointerdown', (e) => {
  if (isUiEvent(e)) return;
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
  groundScroll += dx;
  updateClouds(dt);

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
    if (o.type === 'beer' && currentCharacter().canKick) {
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
        gameOver(o.type === 'beer' ? 'ビールにぶつかった！' : 'コーラにぶつかった！');
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

// ===== 地面（本家と同じく、1区間ごとに平ら / デコボコをランダムに決めてつなげる。絵は自作） =====
const GROUND_SEGMENT_W = 600 * SCALE;
const GROUND_BUMP_PROB = 0.5;
const groundImages = new Map();

// 区間ごとに決まった乱数（何度描いても同じ形になるように）
function seededRandom(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function groundImage(index) {
  if (groundImages.has(index)) return groundImages.get(index);
  const rnd = seededRandom(index + 1);
  const img = document.createElement('canvas');
  img.width = GROUND_SEGMENT_W;
  img.height = 24;
  const c = img.getContext('2d');
  c.fillStyle = COLOR.ink;
  const LINE_Y = 6; // 地面の線の位置（画像の上から）
  // 地面の線。デコボコの区間は、ところどころ盛り上がったり凹んだりする
  const heights = new Array(GROUND_SEGMENT_W).fill(0);
  if (rnd() < GROUND_BUMP_PROB) {
    for (let x = 20 + rnd() * 60; x < GROUND_SEGMENT_W - 40; x += 50 + rnd() * 150) {
      const w = 2 * (4 + Math.floor(rnd() * 7)); // 8〜20px
      const h = rnd() < 0.75 ? -2 * (1 + Math.floor(rnd() * 2)) : 2; // 多くは盛り上がり（2〜4px）、たまに凹み
      for (let i = 0; i < w; i += 2) {
        const edge = Math.min(i, w - 2 - i);
        const v = Math.sign(h) * Math.min(Math.abs(h), edge + 2);
        heights[Math.floor(x / 2) * 2 + i] = v;
        heights[Math.floor(x / 2) * 2 + i + 1] = v;
      }
    }
  }
  for (let x = 0; x < GROUND_SEGMENT_W; x += 2) {
    c.fillRect(x, LINE_Y + heights[x], 2, 2);
    if (heights[x] < 0) c.fillRect(x, LINE_Y + heights[x], 2, -heights[x]); // 盛り上がりの中を塗る
  }
  // 線の下の小石や砂
  for (let x = rnd() * 20; x < GROUND_SEGMENT_W; x += 8 + rnd() * 30) {
    const y = LINE_Y + 5 + Math.floor(rnd() * 12);
    const w = rnd() < 0.3 ? 2 : 2 + Math.floor(rnd() * 3) * 2;
    c.fillRect(Math.floor(x), y, w, 2);
  }
  groundImages.set(index, img);
  // 画面外に流れた区間の画像は捨てる
  for (const k of groundImages.keys()) if (k < index - 2) groundImages.delete(k);
  return img;
}

function drawGround() {
  const first = Math.floor(groundScroll / GROUND_SEGMENT_W);
  for (let i = first; i * GROUND_SEGMENT_W - groundScroll < W; i++) {
    ctx.drawImage(groundImage(i), Math.round(i * GROUND_SEGMENT_W - groundScroll), GROUND_Y - 6);
  }
}

// ===== 雲（本家 cloud.ts / horizon.ts と同じ出方。絵は自作） =====
const CLOUD_SPEED = dino(1);        // 本家は速度に関係なく 1px/フレーム
const CLOUD_MIN_GAP = 100 * SCALE;
const CLOUD_MAX_GAP = 400 * SCALE;
const CLOUD_MIN_Y = 30 * SCALE;     // 画面上端から
const CLOUD_MAX_Y = 71 * SCALE;
const CLOUD_FREQUENCY = 0.5;        // 1フレームごとに新しい雲を出す確率
const MAX_CLOUDS = 6;
const CLOUD_DOT = 2.4;
const CLOUD_ROWS = [
  '..........oooooo...............',
  '........oofffffoo..............',
  '.......offffffffo..oooo........',
  '...ooooffffffffffoofffoo.......',
  '.oofffffffffffffffffffffoooo...',
  'offffffffffffffffffffffffffoo..',
  'offfffffffffffffffffffffffffo..',
  '.ooooooooooooooooooooooooooo...',
];
const CLOUD_PALETTE = { o: '#d0d0d0', f: '#ffffff' };

function addCloud() {
  clouds.push({
    x: W,
    y: CLOUD_MIN_Y + Math.random() * (CLOUD_MAX_Y - CLOUD_MIN_Y),
    gap: CLOUD_MIN_GAP + Math.random() * (CLOUD_MAX_GAP - CLOUD_MIN_GAP),
  });
}

function updateClouds(dt) {
  if (!clouds.length) { addCloud(); return; }
  for (const cl of clouds) cl.x -= CLOUD_SPEED * dt;
  clouds = clouds.filter((cl) => cl.x + CLOUD_ROWS[0].length * CLOUD_DOT > 0);
  const last = clouds.at(-1);
  const prob = 1 - Math.pow(1 - CLOUD_FREQUENCY, dt * FPS); // フレームレートが違っても本家と同じ頻度に
  if (clouds.length < MAX_CLOUDS && (!last || W - last.x > last.gap) && Math.random() < prob) addCloud();
}

function drawClouds() {
  const img = pixelImage(CLOUD_ROWS, CLOUD_PALETTE);
  ctx.imageSmoothingEnabled = false;
  for (const cl of clouds) {
    ctx.drawImage(img, Math.round(cl.x), Math.round(cl.y), img.width * CLOUD_DOT, img.height * CLOUD_DOT);
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
  E: '#2a1a12', // 目（細め）
  M: '#8a3b2e', // 口
  K: '#262626', // 黒パーカー
  k: '#141414', // パーカーの影（腕・ポケット・裾のリブ）
  F: '#3d3d3d', // フード（髪や服と区別できるよう少し明るく）
  f: '#0e0e0e', // フードの内側の影
  P: '#363a42', // ワイドパンツ
  W: '#c9c4bb', // スニーカー
  O: '#8c867c', // ソール
};

const BODY = [
  '....HH.HHH.H',
  '...HHHHHHHHHHH',
  '..HHhhHHHhhHHHH',
  '.HHhHHhHHhHHhHH',
  'HHHHHHHHHHHHhhHH',
  '.HHhhHHHhhHHHHHHH',
  'HHhHHhHHhHHHhHHH',
  'HHHHHHHHHHHHHHHHH',
  'HHHHHHHSHHSSSHHSH',
  '.HHHHHSSSSSSSSSS',
  'HHHHHsSSSEESSEES',
  '.HHHSsSSSSSSSSSS',
  'HHHHSSSSSSMMMSS',
  '.FHHHsSSSSSSSS',
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
  jump: [ // ガニ股で、左右の足の高さは揃える
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '..PPPPPPPPPPP',
    '.PPPPPPPPPPPPP',
    'PPPPP....PPPPP',
    'PPPP......PPPP',
    'PPPP......PPPP',
    'WWWW......WWWWW',
    'OOOO......OOOOO',
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

// ===== みおちゃんのドット絵 =====
// 暗めの茶色のストレート（肩まで、シースルーの前髪）、黒のノースリーブ、グレーのワイドパンツ、黒スニーカー
const MIO_PALETTE = {
  ...PALETTE,
  H: '#45291a', // 髪（暗めの茶色）
  h: '#6a4430', // 髪のツヤ
  w: '#ffffff', // 目の光
  U: '#262626', // 黒のノースリーブ
  g: '#141414', // ノースリーブの縁
  P: '#7d8088', // グレーのワイドパンツ
  W: '#1c1c1c', // 黒スニーカー
  O: '#5a5a5a', // ソール
};

const MIO_BODY = [
  '.....HHHHHH',
  '...HHHHHHHHHH',
  '..HHHHHHHHHHHH',
  '.HHHHhhHHHHHHHH',
  '.HHHhHHHHHHHHHHH',
  'HHHHHHHHHHHHHHHH',
  'HHHHHHHHHHHHHHHH',
  'HHHHHHHHSHHSHHSH',
  'HHHHHHSSSSSSSSSS',
  'HHHHHsSSSEwSSEwS',
  'HHHHSsSSSEESSEES',
  'HHHHSsSSSSSSSSSS',
  'HHHHSSSSSMSSSMS',
  'HHHHHsSSSSMMMS',
  'HHHHHHsSSSS',
  'HHHHHHgUUUgUU',
  'HHHHHsSUUUUUUg',
  '.HHHHsSUUUUUUg',
  '..gUsSUUUUUUg',
  '..gUsSUUUUUUg',
  '..gUsSUUUUUUg',
  '..gUSSSUUUUUg',
  '..ggggggggggg',
];

// みおちゃんのジャンプは両脚を揃えて膝を曲げる（走りは藤くんと共通）
const MIO_LEGS = {
  ...LEGS,
  jump: [
    '...PPPPPPPPP',
    '...PPPPPPPPP',
    '...PPPPPPPPPP',
    '....PPPPPPPPPP',
    '.....PPPPPPPPP',
    '.....PPPPPPPP',
    '....PPPPPPPP',
    '...PPPPPPPP',
    '...PPPPPPP',
    '..WWWWWWWWW',
    '..OOOOOOOOO',
  ],
};

const HEM_OVERLAP = 0; // 裾が脚に重なる行数
const SPRITE_ROWS = BODY.length - HEM_OVERLAP + 12; // 足元までの行数（走り・キック基準）

// 選べるキャラ。canKick: ビールを蹴れるか（false ならビールもジャンプで避ける）
const CHARACTERS = {
  fuji: { name: '藤くん', canKick: true, rule: 'ビールは蹴る / コーラは跳ぶ', body: BODY, legs: LEGS, palette: PALETTE },
  mio: { name: 'みおちゃん', canKick: false, rule: 'ビールもコーラも跳んで避ける', body: MIO_BODY, legs: MIO_LEGS, palette: MIO_PALETTE },
};
const currentCharacter = () => CHARACTERS[characterId];

// ドット絵は 1ドット=1px の画像にしてから拡大して描く。
// 1ドットずつ fillRect すると、半端な倍率のときにドットの間に隙間（網目）が出るため。
const pixelImages = new Map();
function pixelImage(rows, palette) {
  if (!pixelImages.has(palette)) pixelImages.set(palette, new Map());
  const cache = pixelImages.get(palette);
  let img = cache.get(rows);
  if (!img) {
    img = document.createElement('canvas');
    img.width = Math.max(...rows.map((r) => r.length));
    img.height = rows.length;
    const c = img.getContext('2d');
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const color = palette[row[i]];
        if (!color) continue;
        c.fillStyle = color;
        c.fillRect(i, r, 1, 1);
      }
    });
    cache.set(rows, img);
  }
  return img;
}

function drawPixels(c, rows, x, y, palette = PALETTE) {
  const img = pixelImage(rows, palette);
  c.imageSmoothingEnabled = false;
  c.drawImage(img, x, y, img.width * PIXEL, img.height * PIXEL);
}

// キャラを描く。足元（最終行の下）が baseY に来るように配置する
function drawCharacter(c, ch, x, baseY, pose) {
  const top = baseY - (ch.body.length - HEM_OVERLAP + 12) * PIXEL;
  drawPixels(c, ch.legs[pose], x, top + (ch.body.length - HEM_OVERLAP) * PIXEL, ch.palette);
  drawPixels(c, ch.body, x, top, ch.palette); // 本家の恐竜と同じく、走るときに動くのは脚だけ
}

function drawFuji(c, x, baseY, pose) {
  drawCharacter(c, CHARACTERS.fuji, x, baseY, pose);
}

function drawPlayer() {
  let pose;
  if (player.kickTimer > 0) pose = 'kick';
  else if (!player.onGround) pose = 'jump';
  else pose = Math.floor(player.runPhase / 2) % 2 === 0 ? 'run1' : 'run2';
  drawCharacter(ctx, currentCharacter(), player.x - 1, Math.round(sy(player.y)), pose);
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
  if (currentCharacter().canKick) ctx.fillText(`🍺 × ${kicks}`, 16, 28);
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
  drawClouds();
  drawGround();
  drawObstacles();
  drawPlayer();

  const ch = currentCharacter();
  if (state === 'title') {
    drawCenter([
      ['FUJI-KICK', 40, true],
      ['タップ or スペースでスタート', 16, false],
    ]);
    ctx.textAlign = 'left';
  } else {
    drawHud();
    // スタート直後（障害物が出るまで）は誰の番かとルールを出す
    if (state === 'playing' && runningTime < CLEAR_TIME) {
      drawCenter([
        [`${ch.name}の番！`, 28, true],
        [ch.rule, 18, false],
      ]);
      ctx.textAlign = 'left';
    }
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

// タイトル画面でも空に雲が1つ見えるように
addCloud();
clouds[0].x = W * 0.65;

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
