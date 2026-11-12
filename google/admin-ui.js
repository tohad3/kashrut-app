'use strict';

// גרסת Google: שם המשתמש בכותרת, וניהול משתמשים וקישורים אישיים למנהלי מערכת
(() => {
  const B = GS.boot;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (!B.admin) return;

  const btn = document.createElement('button');
  btn.className = 'btn ghost'; btn.type = 'button'; btn.textContent = 'משתמשים';
  btn.title = 'משתמשים וקישורים אישיים';
  $('#logoutBtn').before(btn);
  const loginBtn = document.createElement('button');
  loginBtn.className = 'btn ghost'; loginBtn.type = 'button'; loginBtn.textContent = 'משתמשים וקישורים אישיים';
  $('#importForm details').before(loginBtn);

  const dlg = document.createElement('dialog');
  dlg.id = 'usersDlg';
  dlg.style.cssText = 'max-width:760px;width:calc(100% - 32px);border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--text);padding:18px';
  document.body.appendChild(dlg);

  const msg = (t, bad) => { const el = $('#uMsg'); el.textContent = t; el.style.color = bad ? 'var(--bad)' : 'var(--ok)'; };
  async function render() {
    dlg.innerHTML = '<p class="muted">טוען…</p>';
    let list;
    try { list = await GS.call('users'); } catch (e) { dlg.innerHTML = `<p class="error">${esc(e.message)}</p><button class="btn ghost" type="button" data-close>סגירה</button>`; return; }
    dlg.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0;font-size:19px">משתמשים וקישורים אישיים</h2><button class="icon-btn" type="button" data-close aria-label="סגירה">✕</button></div>
      <p class="muted" style="margin:6px 0 12px">כל משתמש נכנס בקישור אישי. "שליחת קישור" שולחת לו מייל מחשבון המחלקה. "קישור חדש" מבטל את הקישור הקודם.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="text-align:right"><th>שם</th><th>דוא"ל</th><th>מנהל</th><th>פעיל</th><th>כניסה אחרונה</th><th></th></tr></thead>
        <tbody>${list.map((u) => `<tr data-uid="${esc(u.uid)}" style="border-top:1px solid var(--border)">
          <td><input data-k="name" value="${esc(u.name)}" style="width:100%;min-width:110px"></td>
          <td><input data-k="email" type="email" value="${esc(u.email)}" dir="ltr" style="width:100%;min-width:150px"></td>
          <td style="text-align:center"><input data-k="admin" type="checkbox" ${u.admin ? 'checked' : ''}></td>
          <td style="text-align:center"><input data-k="active" type="checkbox" ${u.active ? 'checked' : ''}></td>
          <td class="muted" style="white-space:nowrap">${u.lastSeen ? new Date(u.lastSeen).toLocaleDateString('he-IL') : '—'}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap;min-width:190px"><button class="btn ghost" type="button" data-act="save">שמירה</button><button class="btn ghost" type="button" data-act="link">שליחת קישור</button><button class="btn ghost" type="button" data-act="reset">קישור חדש</button>${u.uid === B.uid ? '' : '<button class="btn ghost" type="button" data-act="del">מחיקה</button>'}</div></td>
        </tr>`).join('')}</tbody></table></div>
      <h3 style="margin:16px 0 6px">הוספת משתמש</h3>
      <form id="uAdd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input name="name" placeholder="שם" required style="flex:1;min-width:140px">
        <input name="email" type="email" placeholder='דוא"ל' dir="ltr" style="flex:1;min-width:180px">
        <label><input name="admin" type="checkbox"> מנהל מערכת</label>
        <button class="btn primary" type="submit">הוספה</button>
      </form>
      <p id="uMsg" role="status" style="min-height:1.4em;margin:10px 0 0"></p>`;
  }
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    const b = e.target.closest('[data-act]'); if (!b) return;
    const tr = b.closest('tr'), uid = tr.dataset.uid, v = (k) => tr.querySelector(`[data-k=${k}]`);
    b.disabled = true;
    try {
      if (b.dataset.act === 'save') { await GS.call('userSave', { uid, name: v('name').value.trim(), email: v('email').value.trim(), admin: v('admin').checked, active: v('active').checked }); msg('נשמר'); }
      if (b.dataset.act === 'link') { await GS.call('userLink', { uid }); msg('הקישור נשלח במייל'); }
      if (b.dataset.act === 'reset') { if (!confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד מיד.')) return; await GS.call('userReset', { uid }); msg('נוצר קישור חדש. לחצו "שליחת קישור" כדי לשלוח אותו.'); }
      if (b.dataset.act === 'del') { if (!confirm('למחוק את המשתמש? הקישור שלו יפסיק לעבוד.')) return; await GS.call('userDelete', { uid }); await render(); msg('נמחק'); }
    } catch (err) { msg(err.message, true); }
    finally { b.disabled = false; }
  });
  dlg.addEventListener('submit', async (e) => {
    if (e.target.id !== 'uAdd') return;
    e.preventDefault();
    const f = e.target;
    try {
      await GS.call('userSave', { name: f.name.value.trim(), email: f.email.value.trim(), admin: f.admin.checked });
      await render(); msg('המשתמש נוסף. לחצו "שליחת קישור" בשורה שלו.');
    } catch (err) { msg(err.message, true); }
  });
  const open = () => { dlg.showModal(); render(); };
  btn.addEventListener('click', open);
  loginBtn.addEventListener('click', open);
})();
