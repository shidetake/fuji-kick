'use strict';

// ===== タイトル画面のキャラ選択 =====
// キャラのボタンを押すとそのキャラでスタート。枠の外のタップ / スペースは前回のキャラでスタート。
(() => {
  const overlay = document.getElementById('select');
  const buttons = Array.from(overlay.querySelectorAll('.char-button'));

  // ボタンにキャラの絵・名前・ルールを入れる
  for (const button of buttons) {
    const ch = CHARACTERS[button.dataset.char];
    const preview = button.querySelector('canvas');
    const scale = 1.5;
    const w = 24 * PIXEL;
    const h = (ch.body.length + 12) * PIXEL;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    preview.width = w * scale * dpr;
    preview.height = h * scale * dpr;
    preview.style.width = `${w * scale}px`;
    preview.style.height = `${h * scale}px`;
    const c = preview.getContext('2d');
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawCharacter(c, ch, 6, h, 'run1');
    button.querySelector('.char-name').textContent = ch.name;
    button.querySelector('.char-rule').textContent = ch.rule;
    button.addEventListener('click', () => startGame(button.dataset.char));
  }

  function highlight() {
    for (const b of buttons) b.classList.toggle('selected', b.dataset.char === characterId);
  }

  // ←→ でキャラを切り替え（スペース / Enter でスタート）
  window.addEventListener('keydown', (e) => {
    if (state !== 'title' || overlay.hidden) return;
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    const i = buttons.findIndex((b) => b.dataset.char === characterId);
    const next = (i + (e.code === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    setCharacter(buttons[next].dataset.char);
    highlight();
  });

  window.FujiSelect = {
    show() { highlight(); overlay.hidden = false; },
    hide() { overlay.hidden = true; },
  };
  window.FujiSelect.show();
})();
