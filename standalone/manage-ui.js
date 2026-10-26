'use strict';

// ניהול רשימת העסקים במצב ללא שרת: זיהוי עסקים חדשים ועסקים שירדו, הוספה ועדכון.
// משתמש בפונקציות של app.js (state, openSite, kpiRender, toast, loadAll...) ובקריאות של local-api.js.
(() => {
  const DAYS = 30;
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'manageCard';
  card.style.marginBottom = '16px';
  card.innerHTML = `<h3>עדכון רשימת העסקים</h3>
    <p class="muted" id="manageNote">טוען…</p>
    <div class="kpis small" id="manageKpis" style="margin-bottom:8px"></div>
    <button class="btn primary" type="button" id="manageAdd">+ עסק חדש</button>`;
  $('#view-sites').prepend(card);

  const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '—');
  const sheet = (html) => {
    if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
    $('#sheetContent').innerHTML = html;
    $('#sheet').classList.remove('hidden');
    $('#sheet').classList.add('wide');
    state.sheet = { type: 'manage', n: ++sheetSeq }; // צעד בהיסטוריה, כדי שסגירה תחזור לרשימה
    pushNav();
  };
  let sheetSeq = 0;
  // אחרי שינוי: טוענים מחדש את העסקים ואת נתוני הלוח
  async function reload() {
    state.bizExtra = null;
    await loadAll(true);
    renderManage();
  }

  let last = null;
  async function renderManage() {
    if ($('#view-sites').classList.contains('hidden')) return;
    try { last = await api(`/biz-changes?days=${DAYS}`); } catch (e) { $('#manageNote').textContent = e.message; return; }
    const c = last;
    $('#manageNote').textContent = c.covered
      ? `לפי הדיווחים שנטענו (${dateText(c.from)}–${dateText(c.to)}). "בלי דיווח" = עסק פעיל שלא היה עליו דיווח ב-${c.days} הימים האחרונים שבקובץ.`
      : 'כדי לזהות עסקים חדשים ועסקים שירדו, טוענים קובץ דיווחי משגיחים (כפתור "טעינת קובץ" למעלה).';
    kpiRender('#manageKpis', [
      [c.fresh.length ? 'warn' : 'ok', c.fresh.length, 'עסקים חדשים (בדיווחים ולא ברשימה)', c.fresh.length ? showFresh : null],
      [c.silent.length ? 'bad' : 'ok', c.silent.length, c.silent.some((x) => x.notInExport) ? 'עסקים שירדו / בלי דיווח' : `עסקים פעילים בלי דיווח ${c.days} ימים`, c.silent.length ? showSilent : null],
      ['ok', c.aliases.length, 'שמות מהדיווחים ששויכו לעסקים', c.aliases.length ? showAliases : null],
      ['ok', c.supLog.length, 'עסקים שקיבלו משגיחים מהדיווחים', c.supLog.length ? showSupLog : null],
      ['', c.added.length, 'נוספו באפליקציה', c.added.length ? () => showList('עסקים שנוספו באפליקציה', c.added) : null],
      ['', c.inactive.length, 'סומנו לא פעילים', c.inactive.length ? () => showList('עסקים שסומנו לא פעילים', c.inactive) : null],
    ]);
  }

  function showFresh() {
    const rows = last.fresh;
    sheet(`<h2>עסקים חדשים</h2>
      <p class="muted">שמות שמופיעים ${rows.some((r) => r.fromExport) ? 'בדיווחים או בייצוא בתי העסק' : 'בדיווחי המשגיחים'} ואין עסק כזה ברשימה. אם זה עסק חדש – מוסיפים אותו. אם זה שם אחר של עסק קיים – מסמנים "לא חדש".</p>
      <div class="table-wrap"><table><thead><tr><th>שם</th><th>דיווחים</th><th>דיווח אחרון</th><th>משגיחים</th><th>אולי זה</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${esc(r.name)}${r.fromExport ? ' ' + tag('מהייצוא', '') : ''}</td><td>${r.count}</td><td>${dateText(r.last)}</td><td>${plinks(r.supervisors)}</td>
        <td>${r.suggest ? `<button class="btn ghost" data-sugg="${i}" title="שיוך הדיווחים לעסק הזה">↩ ${esc(r.suggest.name)}</button>${r.suggest.supMatch ? ' ' + tag('אותו משגיח', 'ok') : ''}` : '—'}</td>
        <td><button class="btn primary" data-add="${i}">הוספה</button> <button class="btn ghost" data-link="${i}">שיוך לעסק קיים</button> <button class="btn ghost" data-dismiss="${i}">לא חדש</button></td></tr>`).join('')}
      </tbody></table></div>
      <datalist id="mdl-board">${(state.bizBoard || []).map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>`);
    $('#sheetContent').onclick = async (e) => {
      const a = e.target.closest('[data-add]'), d = e.target.closest('[data-dismiss]'), l = e.target.closest('[data-link]'), sg = e.target.closest('[data-sugg]');
      if (sg) {
        const r = rows[Number(sg.dataset.sugg)];
        try { await api('/biz-alias', { method: 'POST', body: { name: r.name, boardId: r.suggest.id } }); toast(`"${r.name}" שויך ל"${r.suggest.name}"`); await reload(); showFresh(); }
        catch (err) { toast(err.message, true); }
        return;
      }
      if (l) {
        const r = rows[Number(l.dataset.link)];
        const cell = l.parentElement;
        cell.innerHTML = `<input list="mdl-board" placeholder="שם העסק ברשימה" style="min-width:200px"> <button class="btn primary" type="button">שיוך</button>`;
        $('input', cell).focus();
        $('button', cell).onclick = async () => {
          const v = $('input', cell).value.trim(), b = (state.bizBoard || []).find((x) => x.name === v);
          if (!b) return toast('יש לבחור עסק מהרשימה', true);
          try { await api('/biz-alias', { method: 'POST', body: { name: r.name, boardId: b.id } }); toast(`הדיווחים של "${r.name}" שויכו ל"${b.name}"`); await reload(); showFresh(); }
          catch (err) { toast(err.message, true); }
        };
        return;
      }
      if (a) { const r = rows[Number(a.dataset.add)]; return editForm(null, { name: r.name, supervisors: r.supervisors.join(', '), active: true }); }
      if (d) {
        try { await api('/biz-dismiss', { method: 'POST', body: { name: rows[Number(d.dataset.dismiss)].name } }); toast('סומן כלא חדש'); await renderManage(); showFresh(); }
        catch (err) { toast(err.message, true); }
      }
    };
  }

  function showSilent() {
    const rows = last.silent;
    sheet(`<h2>עסקים שירדו / בלי דיווח</h2>
      <p class="muted">עסקים פעילים ברשימה ${rows.some((r) => r.notInExport) ? 'שאינם בייצוא בתי העסק, או ' : ''}שלא היה עליהם דיווח ב-${last.days} הימים האחרונים שבקובץ. עסק שנסגר מסמנים כלא פעיל (אפשר להחזיר).</p>
      <div class="table-wrap"><table><thead><tr><th>עסק</th><th>אשכול</th><th>מפקח</th><th>דיווח אחרון</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td><button class="plain-link" data-open="${r.siteId}">${esc(r.name)}</button>${r.notInExport ? ' ' + tag('לא בייצוא', 'bad') : ''}</td><td>${esc(r.cluster || '')}</td><td>${esc(r.inspector || '')}</td><td>${r.last ? dateText(r.last) : 'אין בקובץ'}</td>
        <td><button class="btn ghost" data-off="${i}">סימון לא פעיל</button></td></tr>`).join('')}
      </tbody></table></div>`);
    $('#sheetContent').onclick = async (e) => {
      const o = e.target.closest('[data-open]'), off = e.target.closest('[data-off]');
      if (o) return openSite(Number(o.dataset.open));
      if (off) {
        const r = rows[Number(off.dataset.off)];
        if (!confirm(`לסמן את "${r.name}" כלא פעיל?`)) return;
        try { await api('/biz-manage/' + r.id, { method: 'POST', body: { active: false } }); toast('סומן לא פעיל'); await reload(); showSilent(); }
        catch (err) { toast(err.message, true); }
      }
    };
  }

  function showAliases() {
    const rows = last.aliases;
    sheet(`<h2>שמות מהדיווחים ששויכו לעסקים</h2>
      <p class="muted">הדיווחים על השם שמימין נספרים לעסק שמשמאל. "אוטומטי" = שויך לפי דמיון בשם${rows.some((r) => r.supMatch) ? ' (ו"אותו משגיח" = גם המשגיח שדיווח משויך לעסק)' : ''}. שיוך שגוי מבטלים, והשם יחזור לרשימת העסקים החדשים.</p>
      <div class="table-wrap"><table><thead><tr><th>שם בדיווחים</th><th>העסק ברשימה</th><th></th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${esc(r.name)}</td><td>${esc(r.to)}</td><td>${r.auto ? tag('אוטומטי', '') : tag('ידני', '')}${r.supMatch ? ' ' + tag('אותו משגיח', 'ok') : ''}</td>
        <td><button class="btn ghost" data-undo="${i}">ביטול</button></td></tr>`).join('')}
      </tbody></table></div>`);
    $('#sheetContent').onclick = async (e) => {
      const u = e.target.closest('[data-undo]');
      if (!u) return;
      const r = rows[Number(u.dataset.undo)];
      try { await api('/biz-alias', { method: 'POST', body: { name: r.name, undo: true } }); toast('השיוך בוטל'); await reload(); showAliases(); }
      catch (err) { toast(err.message, true); }
    };
  }

  function showSupLog() {
    const rows = last.supLog;
    sheet(`<h2>משגיחים שנוספו לעסקים לפי הדיווחים</h2>
      <p class="muted">משגיח שדיווח על עסק לפחות פעמיים ולא היה משויך אליו במסד נוסף למשגיחי העסק. אפשר לתקן בכרטיס העסק ("עדכון פרטי העסק").</p>
      <div class="table-wrap"><table><thead><tr><th>עסק</th><th>משגיחים שנוספו</th><th>מתי</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><button class="plain-link" data-open="${siteOf(r.boardId)}">${esc(r.to)}</button></td><td>${plinks(r.added)}</td><td>${dateText(Date.parse(r.at))}</td></tr>`).join('')}
      </tbody></table></div>`);
    $('#sheetContent').onclick = (e) => { const o = e.target.closest('[data-open]'); if (o) openSite(Number(o.dataset.open)); };
  }
  const siteOf = (boardId) => (state.sites.find((x) => x.boardId === boardId) || {}).id;

  function showList(title, rows) {
    sheet(`<h2>${esc(title)}</h2><ul>${rows.map((r) => `<li><button class="plain-link" data-open="${r.siteId}">${esc(r.name)}</button></li>`).join('')}</ul>`);
    $('#sheetContent').onclick = (e) => { const o = e.target.closest('[data-open]'); if (o) openSite(Number(o.dataset.open)); };
  }

  // טופס עסק: חדש (boardId = null) או קיים
  const FIELDS = [['name', 'שם העסק'], ['address', 'רחוב'], ['number', 'מספר בית'], ['cluster', 'אשכול'], ['subCluster', 'תת אשכול'], ['route', 'מסלול'], ['category', 'סיווג'], ['inspector', 'מפקח'], ['supervisors', 'משגיחים (מופרדים בפסיק)'], ['notes', 'הערות']];
  function editForm(boardId, init) {
    const b = boardId ? (state.bizBoard || []).find((x) => x.id === boardId) || {} : {};
    const v = { ...b, supervisors: (b.supNames || []).join(', '), ...init };
    const opts = (k) => [...new Set((state.bizBoard || []).map((x) => x[k]).filter(Boolean))].sort((p, q) => p.localeCompare(q, 'he'));
    const people = [...(state.staff ? state.staff.values() : [])].map((x) => x.name).sort((p, q) => p.localeCompare(q, 'he'));
    sheet(`<h2>${boardId ? 'עדכון פרטי העסק' : 'עסק חדש'}</h2>
      <form id="manageForm"><div class="form-grid">
        ${FIELDS.map(([k, label]) => `<label class="${k === 'notes' || k === 'supervisors' ? 'full' : ''}">${label}
          <input name="${k}" value="${esc(v[k] ?? '')}" ${k === 'name' ? 'required' : ''} list="mdl-${k}"></label>`).join('')}
        <label><span><input type="checkbox" name="active" ${v.active !== false ? 'checked' : ''}> עסק פעיל</span></label>
      </div>
      ${['cluster', 'subCluster', 'route', 'category'].map((k) => `<datalist id="mdl-${k}">${opts(k).map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`).join('')}
      <datalist id="mdl-inspector">${opts('inspector').map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
      <datalist id="mdl-supervisors">${people.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
      <p class="muted">נשמר במחשב הזה בלבד (לא בשירת הים ולא במסד הנתונים של ניהול משגיחים).</p>
      <button class="btn primary" type="submit">שמירה</button>
      ${b.added ? '<button class="btn ghost" type="button" id="manageRemove">מחיקת העסק</button>' : ''}
      </form>`);
    $('#sheetContent').onclick = null;
    $('#manageForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, body = { active: f.active.checked };
      for (const [k] of FIELDS) body[k] = f[k].value;
      try {
        const r = await api('/biz-manage/' + (boardId || 'new'), { method: 'POST', body });
        // השדות אשכול / סיווג / מפקח נשמרים גם כעריכה של "לוח משגיחים", שגוברת על הנתונים מהמסד
        const site = boardId ? state.sites.find((x) => x.boardId === boardId) : null;
        const siteId = site ? site.id : r.siteId;
        if (site) await api('/biz-edit/' + siteId, { method: 'POST', body: { cluster: body.cluster, subCluster: body.subCluster, route: body.route, category: body.category, inspector: body.inspector, notes: body.notes } });
        toast(boardId ? 'פרטי העסק עודכנו' : 'העסק נוסף');
        await reload();
        openSite(siteId);
      } catch (err) { toast(err.message, true); }
    });
    const rm = $('#manageRemove');
    if (rm) rm.addEventListener('click', async () => {
      if (!confirm(`למחוק את "${b.name}"?`)) return;
      try { await api('/biz-manage/' + boardId, { method: 'POST', body: { remove: true } }); toast('העסק נמחק'); hideSheet(); await reload(); }
      catch (err) { toast(err.message, true); }
    });
  }

  $('#manageAdd').addEventListener('click', () => editForm(null, {}));

  // כפתור עדכון בכרטיס העסק
  const baseOpenSite = openSite;
  openSite = async function (id) {
    await baseOpenSite(id);
    const s = state.sites.find((x) => x.id === id);
    if (!s || !s.boardId || !canEdit() || !state.sheet || state.sheet.id !== id) return;
    const h = $('#sheetContent h2');
    if (h) h.insertAdjacentHTML('afterend', `<p><button class="btn ghost" type="button" id="manageEdit">✎ עדכון פרטי העסק</button>${s.added ? ' ' + tag('נוסף באפליקציה', '') : ''}</p>`);
    const btn = $('#manageEdit');
    if (btn) btn.addEventListener('click', () => editForm(s.boardId, {}));
  };
  window.openSite = openSite;

  // מתעדכן בכל כניסה ללשונית בתי עסק ואחרי כל טעינה
  const baseGo = go;
  go = function (view) { baseGo(view); if (view === 'sites') renderManage(); };
  const baseRender = renderSiteList;
  renderSiteList = function () { baseRender(); renderManage(); };

  /* ---------- התראה: עסקים בלי ביקורת ובלי החתמות בתקופה שנבחרה ---------- */
  const AL_KEY = 'bizAlert';
  const alCfg = { n: 14, unit: 'd', kind: 'both' };
  try { Object.assign(alCfg, JSON.parse(localStorage.getItem(AL_KEY) || '{}')); } catch {}
  const KIND_TEXT = { both: 'בלי ביקורת וגם בלי החתמות', insp: 'בלי ביקורת', sign: 'בלי החתמות' };
  const alCard = document.createElement('div');
  alCard.className = 'card';
  alCard.id = 'alertCard';
  alCard.style.margin = '0 0 16px';
  alCard.innerHTML = `<h3>⚠ התראה: עסקים בלי ביקורת ובלי החתמות</h3>
    <div class="toolbar">
      <label>תקופה<input id="alN" type="number" min="1" max="365" style="width:90px"></label>
      <label>יחידה<select id="alUnit"><option value="d">ימים</option><option value="w">שבועות</option></select></label>
      <label>להתריע על עסקים<select id="alKind"><option value="both">${KIND_TEXT.both}</option><option value="insp">${KIND_TEXT.insp}</option><option value="sign">${KIND_TEXT.sign}</option></select></label>
    </div>
    <p class="muted" id="alNote"></p>
    <div class="kpis small" id="alKpis"></div>`;
  $('#kpis').after(alCard);
  $('#alN').value = alCfg.n; $('#alUnit').value = alCfg.unit; $('#alKind').value = alCfg.kind;
  alCard.addEventListener('change', () => {
    alCfg.n = Math.min(365, Math.max(1, Number($('#alN').value) || 1)); alCfg.unit = $('#alUnit').value; alCfg.kind = $('#alKind').value;
    try { localStorage.setItem(AL_KEY, JSON.stringify(alCfg)); } catch {}
    renderAlert();
  });
  const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const periodText = () => `${alCfg.n} ${alCfg.unit === 'w' ? 'שבועות' : 'ימים'}`;

  // ביקורת = דיווח של מפקח (לפי התפקיד בקובץ, או מפקח שרשום על העסק). החתמה = דיווח של משגיח.
  // התקופה נספרת אחורה מהיום האחרון שבקובץ, לא מהיום.
  async function alertRows() {
    const range = await localData.lastRange();
    if (!range || !state.siteById) return null;
    const days = alCfg.n * (alCfg.unit === 'w' ? 7 : 1);
    const d = new Date(range.to + 'T12:00:00'); d.setDate(d.getDate() - days + 1);
    const from = isoDay(d), to = range.to;
    const insp = new Set(), sign = new Set();
    for (const r of await api(`/reports?from=${from}&to=${to}`)) {
      const site = state.siteById.get(r.siteId);
      if (!site) continue;
      const isInsp = /מפקח/.test(r.group || '') || splitNames(site.inspectors).some((n) => nameKey(n) === nameKey(r.supervisor));
      (isInsp ? insp : sign).add(r.siteId);
    }
    const hit = (x) => (alCfg.kind === 'insp' ? !insp.has(x.id) : alCfg.kind === 'sign' ? !sign.has(x.id) : !insp.has(x.id) && !sign.has(x.id));
    const list = state.sites.filter((x) => x.active && x.statusId !== 0 && hit(x));
    return { from, to, partial: from < range.from, dataFrom: range.from, list };
  }
  const alertTitle = (a) => `עסקים ${KIND_TEXT[alCfg.kind]} ב-${periodText()} (${dm(a.from)}–${dm(a.to)})`;

  let alSeq = 0;
  async function renderAlert() {
    const seq = ++alSeq;
    let a;
    try { a = await alertRows(); } catch (e) { $('#alNote').textContent = e.message; return; }
    if (seq !== alSeq) return;
    if (!a) { $('#alNote').textContent = 'טוענים קובץ דיווחים כדי לקבל התראות.'; $('#alKpis').innerHTML = ''; return; }
    $('#alNote').textContent = `עסקים פעילים שלא היה עליהם דיווח ב-${periodText()} האחרונים שבקובץ (${dm(a.from)}–${dm(a.to)}).` +
      (a.partial ? ` שים לב: הקובץ מתחיל רק ב-${dm(a.dataFrom)}, ולכן חלק מהתקופה לא נבדק.` : '');
    kpiRender('#alKpis', [[a.list.length ? 'bad' : 'ok', a.list.length, alertTitle(a), a.list.length ? () => openDrill(alertTitle(a), 'sites', a.list) : null]]);
  }

  // חלונית אחרי טעינת קובץ: עסקים חדשים שזוהו, וההתראה על עסקים בלי ביקורת והחתמות
  async function importPopup() {
    let c, a;
    try { c = await api(`/biz-changes?days=${DAYS}`); a = await alertRows(); } catch { return; }
    last = c;
    if (!c.fresh.length && !(a && a.list.length)) return;
    const MAX = 15;
    sheet(`<h2>סיכום טעינת הקובץ</h2>
      ${c.fresh.length ? `<h3>🆕 זוהו ${c.fresh.length} עסקים חדשים</h3>
        <p class="muted">שמות שמופיעים בקובץ ואינם ברשימת העסקים (שמות שדומים מספיק לעסק קיים שויכו אליו אוטומטית).</p>
        <ul>${c.fresh.slice(0, MAX).map((r) => `<li>${esc(r.name)}${r.count ? ` <span class="muted">(${r.count} דיווחים)</span>` : ''}</li>`).join('')}</ul>
        ${c.fresh.length > MAX ? `<p class="muted">ועוד ${c.fresh.length - MAX}…</p>` : ''}
        <p><button class="btn primary" type="button" id="popFresh">טיפול בעסקים החדשים</button></p>` : '<p>לא זוהו עסקים חדשים.</p>'}
      ${a && a.list.length ? `<h3>⚠ ${a.list.length} ${alertTitle(a)}</h3>
        <p><button class="btn ghost" type="button" id="popAlert">הצגת הרשימה</button> <span class="muted">את התקופה משנים בדשבורד.</span></p>` : ''}`);
    const f = $('#popFresh'), al = $('#popAlert');
    if (f) f.addEventListener('click', showFresh);
    if (al) al.addEventListener('click', () => openDrill(alertTitle(a), 'sites', a.list));
  }

  const baseDash = renderDashboard;
  renderDashboard = function () {
    baseDash();
    renderAlert();
    let pop = false;
    try { pop = sessionStorage.getItem('afterImport') === '1'; sessionStorage.removeItem('afterImport'); } catch {}
    if (pop) importPopup();
  };
})();
