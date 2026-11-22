// ランキング API（Vercel Function）
//   GET  /api/scores?player=<id>&character=<fuji|mio>  … トップ10と自分の順位
//   POST /api/scores { player, name, character, score, kicks, duration } … スコア登録（自己ベストのみ残す）
//   POST /api/scores { player, name } … 名前だけ変更
//
// データは Upstash Redis に保存する。ランキングはキャラごとに分ける。
//   fk:scores     … 藤くんのランキング。ソート済みセット（member = プレイヤーID, score = 自己ベスト）
//   fk:scores:mio … みおちゃんのランキング
//   fk:names      … ハッシュ（プレイヤーID → 名前）。キャラ共通

const scoresKey = (character) => (character === 'mio' ? 'fk:scores:mio' : 'fk:scores');
const NAMES_KEY = 'fk:names';
const TOP_N = 10;
const NAME_MAX = 10;

// ありえないスコアを弾くための上限（ゲームの最高速度 1248px/s で 1秒あたり約125点 + キック1回50点）
const MAX_POINTS_PER_SEC = 130;
const KICK_BONUS = 50;
const MAX_KICKS_PER_SEC = 4;

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const results = await res.json();
  for (const r of results) if (r.error) throw new Error(r.error);
  return results.map((r) => r.result);
}

const isPlayerId = (v) => typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);

function cleanName(v) {
  if (typeof v !== 'string') return null;
  // 制御文字を除いて前後の空白を削る
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const len = Array.from(name).length;
  if (len < 1 || len > NAME_MAX) return null;
  return name;
}

function isPlausible(score, kicks, duration) {
  if (![score, kicks, duration].every(Number.isFinite)) return false;
  if (score < 0 || kicks < 0 || duration < 0 || duration > 3600) return false;
  if (kicks > duration * MAX_KICKS_PER_SEC + 1) return false;
  return score <= duration * MAX_POINTS_PER_SEC + kicks * KICK_BONUS + 10;
}

async function ranking(player, character) {
  const key = scoresKey(character);
  const [top, myRank, myScore] = await redis([
    ['ZREVRANGE', key, 0, TOP_N - 1, 'WITHSCORES'],
    ['ZREVRANK', key, player || '-'],
    ['ZSCORE', key, player || '-'],
  ]);
  const ids = [];
  for (let i = 0; i < top.length; i += 2) ids.push(top[i]);
  const names = ids.length ? (await redis([['HMGET', NAMES_KEY, ...ids]]))[0] : [];
  const list = ids.map((id, i) => ({
    rank: i + 1,
    name: names[i] || '???',
    score: Number(top[i * 2 + 1]),
    you: id === player,
  }));
  const you = myRank === null ? null : { rank: myRank + 1, score: Number(myScore) };
  return { top: list, you };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({ error: 'ranking is not configured' });
    return;
  }
  try {
    if (req.method === 'GET') {
      const player = isPlayerId(req.query.player) ? req.query.player : null;
      res.status(200).json(await ranking(player, req.query.character));
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const player = body.player;
      const name = cleanName(body.name);
      if (!isPlayerId(player) || !name) {
        res.status(400).json({ error: 'invalid player or name' });
        return;
      }
      const commands = [['HSET', NAMES_KEY, player, name]];
      if (body.score !== undefined) {
        const score = Math.floor(Number(body.score));
        const kicks = Math.floor(Number(body.kicks));
        const duration = Number(body.duration);
        if (!isPlausible(score, kicks, duration)) {
          res.status(400).json({ error: 'implausible score' });
          return;
        }
        commands.push(['ZADD', scoresKey(body.character), 'GT', score, player]); // 自己ベストを更新したときだけ書き換わる
      }
      await redis(commands);
      res.status(200).json(await ranking(player, body.character));
      return;
    }
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
};
