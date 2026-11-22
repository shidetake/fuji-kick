'use strict';

// ===== みんなのランキング =====
// ゲームオーバー時にスコアを送り、トップ10を表示する。名前は一度入れたらブラウザに覚えておく。
(() => {
  const API = '/api/scores';
  const NAME_MAX = 10;

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 無視 */ } },
  };

  function playerId() {
    let id = storage.get('fuji-kick-player');
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      storage.set('fuji-kick-player', id);
    }
    return id;
  }

  const el = (id) => document.getElementById(id);
  const overlay = el('ranking');
  const nameForm = el('name-form');
  const nameInput = el('name-input');
  const list = el('ranking-list');
  const status = el('ranking-status');

  let pending = null;   // 名前の入力待ちのスコア
  let character = 'fuji'; // どのキャラのランキングを表示しているか
  let editing = false;  // 名前の入力欄を開いているか

  nameInput.maxLength = NAME_MAX;

  function show() { overlay.hidden = false; }
  function hide() {
    overlay.hidden = true;
    closeNameForm();
  }

  function openNameForm() {
    editing = true;
    nameForm.hidden = false;
    el('actions').hidden = true;
    nameInput.value = storage.get('fuji-kick-name') || '';
    // スマホはタップ操作の中でないとキーボードが出ないことがあるので、出なければ入力欄をタップしてもらう
    setTimeout(() => nameInput.focus(), 50);
  }
  function closeNameForm() {
    editing = false;
    nameForm.hidden = true;
    el('actions').hidden = false;
    nameInput.blur();
  }

  function render(data) {
    list.innerHTML = '';
    if (!data.top.length) {
      status.textContent = 'まだ誰も登録していません';
      return;
    }
    status.textContent = '';
    const rows = data.top.slice();
    if (data.you && data.you.rank > rows.length) {
      rows.push({ gap: true });
      rows.push({ rank: data.you.rank, name: storage.get('fuji-kick-name') || 'あなた', score: data.you.score, you: true });
    }
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.gap) {
        li.className = 'gap';
        li.textContent = '⋮';
      } else {
        if (r.you) li.className = 'you';
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = `${r.rank}`;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = r.name; // textContent なので名前に HTML が入っていても安全
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = String(Math.floor(r.score)).padStart(5, '0');
        li.append(rank, name, score);
      }
      list.append(li);
    }
  }

  async function request(method, body) {
    const url = method === 'GET'
      ? `${API}?player=${encodeURIComponent(playerId())}&character=${encodeURIComponent(character)}`
      : API;
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function submit(result) {
    status.textContent = '送信中…';
    try {
      render(await request('POST', { player: playerId(), name: storage.get('fuji-kick-name'), character, ...result }));
    } catch (e) {
      console.error(e);
      status.textContent = 'ランキングに接続できませんでした';
    }
  }

  async function load() {
    status.textContent = '読み込み中…';
    try {
      render(await request('GET'));
    } catch (e) {
      console.error(e);
      status.textContent = 'ランキングに接続できませんでした';
    }
  }

  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!name) { nameInput.focus(); return; }
    storage.set('fuji-kick-name', Array.from(name).slice(0, NAME_MAX).join(''));
    closeNameForm();
    if (pending) {
      const result = pending;
      pending = null;
      await submit(result);
    } else {
      // 名前の変更だけ
      status.textContent = '送信中…';
      try {
        render(await request('POST', { player: playerId(), name: storage.get('fuji-kick-name'), character }));
      } catch (err) {
        console.error(err);
        status.textContent = 'ランキングに接続できませんでした';
      }
    }
  });

  el('skip-button').addEventListener('click', () => {
    pending = null;
    closeNameForm();
    load();
  });
  el('rename-button').addEventListener('click', openNameForm);
  el('retry-button').addEventListener('click', () => press());


  window.FujiRanking = {
    onGameOver(result) {
      character = result.character || 'fuji';
      el('ranking-title').textContent = `ランキング TOP10（${CHARACTERS[character].name}）`;
      el('result-message').textContent = overMessage;
      el('result-score').textContent = `SCORE ${String(result.score).padStart(5, '0')}` +
        (CHARACTERS[character].canKick ? `  🍺 × ${result.kicks}` : '');
      list.innerHTML = '';
      show();
      if (!storage.get('fuji-kick-name')) {
        pending = result;
        openNameForm();
        load(); // 名前を入れる前から今のランキングを見せる
      } else {
        submit(result);
      }
    },
    blocksRetry() { return editing; },
    hide,
  };
})();
