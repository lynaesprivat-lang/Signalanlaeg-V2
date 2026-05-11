// Signalanlæg - Kategoriseringsværktøj
// App-logik

(function () {
  'use strict';

  // ==============================
  // Dynamiske data fra Supabase
  // ==============================
  let SIGNAL_KATEGORIER = [];
  let VAREKATALOG = [];
  let MASTETYPER_GRUPPER = [];
  let SPAENDBAAND_PR_MAST = {};
  let UDSTYR_MENU = [];
  let KABEL_VARENUMRE = [];
  let UDSTYR_TYPER = [];
  let SIGNAL_TYPER = [];

  const HOJDE_MULIGHEDER = ['', 'Højt', 'Lavt'];
  let FLIR_VARENUMRE = ['250-650-0118', '250-650-0119'];
  let RADAR_VARENUMRE = [
    '250-650-0160', '250-650-0161', '250-650-0164', '250-650-0165', '250-650-0167',
    '250-650-0118', '250-650-0119',
    '167-665-0063', '167-665-0065',
    '250-650-0190/1',
  ];
  const SPAENDBAAND_ARM_DEFAULT = '280-850-0005';
  const SPAENDBAAND_ARM_FLIR    = '280-850-0016';

  // Storage
  const STORAGE_PREFIX = 'signalanlaeg:';

  // UI state
  let mastFilter = null;
  const collapsedMaster = new Set();
  const openSigSections = new Set();
  const openUdstyrSections = new Set();

  async function indlaesKatalogFraSupabase(sbClient) {
    const visFejl = (msg) => {
      const el = document.getElementById('status-besked');
      if (el) { el.textContent = msg; el.style.color = 'red'; el.style.display = 'block'; }
      console.warn(msg);
    };
    try {
      // Hent varer først så kaldenavn er tilgængeligt for alle opslag
      const { data: varerData } = await sbClient.from('varer').select('*').order('sortering');
      const { data: underData } = await sbClient.from('vare_underkategorier').select('*').order('sortering');
      console.log('underData:', underData ? underData.length : 'null', underData ? JSON.stringify(underData[0]) : '');

      const { data: skData, error: skErr } = await sbClient.from('signal_kategorier').select('*').order('sortering');
      if (skErr) { visFejl('Fejl signal_kategorier: ' + skErr.message); return; }
      const { data: stData } = await sbClient.from('signal_typer').select('*').order('sortering');
      if (skData) {
        SIGNAL_KATEGORIER = skData.map(k => ({
          kategori: k.navn,
          typer: (stData || []).filter(t => t.kategori_id === k.id).map(t => {
            const vare = (varerData || []).find(v => v.varenr === t.varenr);
            return { 
              label: t.label, 
              varenr: t.varenr, 
              kaldenavn: (vare && vare.kaldenavn) ? vare.kaldenavn : (t.kaldenavn || '')
            };
          })
        }));
      }

      const { data: mgData, error: mgErr } = await sbClient.from('maste_grupper').select('*').order('sortering');
      if (mgErr) { visFejl('Fejl maste_grupper: ' + mgErr.message); return; }
      const { data: mtData } = await sbClient.from('maste_typer').select('*').order('sortering');
      if (mgData) {
        MASTETYPER_GRUPPER = mgData.map(g => ({
          gruppe: g.navn,
          typer: (mtData || []).filter(t => t.gruppe_id === g.id).map(t => {
            // Slå kaldenavn op fra varer tabellen
            const vare = (varerData || []).find(v => v.varenr === t.varenr);
            return { 
              label: t.label, 
              varenr: t.varenr, 
              kaldenavn: (vare && vare.kaldenavn) ? vare.kaldenavn : (t.kaldenavn || '')
            };
          })
        }));
        SPAENDBAAND_PR_MAST = {};
        (mtData || []).forEach(t => {
          if (t.spaendbaand_varenr) SPAENDBAAND_PR_MAST[t.label] = t.spaendbaand_varenr;
        });
      }

      const { data: vkData, error: vkErr } = await sbClient.from('varekategorier').select('*').order('sortering');
      if (vkErr) { visFejl('Fejl varekategorier: ' + vkErr.message); return; }
      if (vkData) {
        VAREKATALOG = vkData.map(k => {
          const katVarer = (varerData || []).filter(v => v.kategori_id === k.id && !v.underkategori_id);
          const underkat = (underData || []).filter(u => u.kategori_id === k.id);
          const result = { kategori: k.navn, skjult: k.skjult };
          if (underkat.length > 0) {
            result.underkategorier = underkat.map(u => ({
              navn: u.navn,
              varer: (varerData || []).filter(v => v.underkategori_id === u.id).map(v => ({
                varenr: v.varenr, beskrivelse: v.beskrivelse, bem: v.bem || '', kaldenavn: v.kaldenavn || ''
              }))
            }));
          } else {
            result.varer = katVarer.map(v => ({
              varenr: v.varenr, beskrivelse: v.beskrivelse, bem: v.bem || '', kaldenavn: v.kaldenavn || ''
            }));
          }
          return result;
        });
        UDSTYR_MENU = VAREKATALOG.filter(k => !k.skjult);
        KABEL_VARENUMRE = (varerData || []).filter(v => v.er_kabel).map(v => v.varenr);
        UDSTYR_TYPER = UDSTYR_MENU.flatMap(k => k.underkategorier
          ? k.underkategorier.flatMap(u => u.varer.map(v => v.beskrivelse))
          : (k.varer || []).map(v => v.beskrivelse));
        // Byg RADAR og FLIR lister fra databasen
        RADAR_VARENUMRE.length = 0;
        FLIR_VARENUMRE.length = 0;
        (varerData || []).filter(v => v.er_radar).forEach(v => RADAR_VARENUMRE.push(v.varenr));
        (varerData || []).filter(v => v.er_flir).forEach(v => FLIR_VARENUMRE.push(v.varenr));
      }

      SIGNAL_TYPER = SIGNAL_KATEGORIER.flatMap(k => k.typer.map(t => t.label));

      // Indlæs auto-regler
      const { data: reglerData } = await sbClient.from('auto_regler').select('*, auto_regel_varer(*)').order('sortering');
      if (reglerData) {
        const bygRegler = (type) => reglerData.filter(r => r.type === type).map(r => ({
          beskrivelse: r.beskrivelse,
          matcher_felt: r.matcher_felt,
          matcher_operator: r.matcher_operator,
          matcher_vaerdi: r.matcher_vaerdi,
          matcher_felt2: r.matcher_felt2 || '',
          matcher_operator2: r.matcher_operator2 || '',
          matcher_vaerdi2: r.matcher_vaerdi2 || '',
          varer: (r.auto_regel_varer || []).map(v => ({ varenr: v.varenr, antal: parseFloat(v.antal) }))
        }));
        AUTO_REGLER_SIGNAL.length = 0;
        AUTO_REGLER_UDSTYR.length = 0;
        AUTO_REGLER_MAST.length = 0;
        bygRegler('signal').forEach(r => AUTO_REGLER_SIGNAL.push(r));
        bygRegler('udstyr').forEach(r => AUTO_REGLER_UDSTYR.push(r));
        bygRegler('mast').forEach(r => AUTO_REGLER_MAST.push(r));
        console.log('Auto-regler OK — S:', AUTO_REGLER_SIGNAL.length, 'U:', AUTO_REGLER_UDSTYR.length, 'M:', AUTO_REGLER_MAST.length);
      }

      const el = document.getElementById('status-besked');
      if (el) el.style.display = 'none';
      console.log('Katalog OK — SK:', SIGNAL_KATEGORIER.length, 'MG:', MASTETYPER_GRUPPER.length, 'VK:', VAREKATALOG.length);
    } catch (err) {
      const el = document.getElementById('status-besked');
      if (el) { el.textContent = 'Katalog fejl: ' + err.message; el.style.color = 'red'; el.style.display = 'block'; }
      console.warn('Supabase katalog fejl:', err);
    }
  }
  // Auto-gem timer
  let autoGemTimer = null;
  function planAutoGem() {
    clearTimeout(autoGemTimer);
    autoGemTimer = setTimeout(() => {
      const idDel = state.nr.trim() || state.navn.trim();
      if (!idDel) return;
      const key = STORAGE_PREFIX + idDel.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_');
      try {
        localStorage.setItem(key, JSON.stringify(state));
        opdaterGemtListe();
        $('gemte-anlaeg').value = key;
        visBesked('✓ Auto-gemt');
      } catch (err) { /* stille fejl */ }
    }, 15000);
  }

  // ==============================
  // State
  // ==============================
  let state = tomtAnlaeg();

  function tomtAnlaeg() {
    return {
      nr: '',
      navn: '',
      master: []
    };
  }

  // ==============================
  // Hjælpefunktioner
  // ==============================
  const $ = id => document.getElementById(id);

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function fullTegningsnr() {
    return state.nr || '';
  }

  function visBesked(tekst, type = 'success') {
    const el = $('status-besked');
    el.textContent = tekst;
    el.style.color = type === 'danger' ? 'var(--danger)' : 'var(--success)';
    setTimeout(() => { el.textContent = ''; }, 2500);
  }

  // ==============================
  // Rendering
  // ==============================
  function renderMaster() {
    const container = $('master-liste');
    if (state.master.length === 0) {
      container.innerHTML = '<section class="card"><p class="empty-state">Ingen master tilføjet endnu. Opret en ovenfor.</p></section>';
      return;
    }
    container.innerHTML = state.master.map((mast, mastIdx) => renderMastCard(mast, mastIdx)).join('');
    // Gendan kollaps-state for master
    state.master.forEach((mast, mastIdx) => {
      if (collapsedMaster.has(mastIdx)) {
        const card = container.querySelectorAll('.mast-card')[mastIdx];
        if (!card) return;
        const body = card.querySelector('.mast-body');
        const summary = card.querySelector('.mast-summary');
        const btn = card.querySelector('.btn-collapse');
        if (body) body.style.display = 'none';
        if (summary) summary.style.display = '';
        if (btn) btn.textContent = '▸';
        card.dataset.collapsed = 'true';
      }
      // Gendan åbne signal/udstyr sektioner
      const card = container.querySelectorAll('.mast-card')[mastIdx];
      if (!card) return;
      if (openSigSections.has(mastIdx)) {
        const body = card.querySelector('.sig-section-body');
        const arrow = card.querySelector('.mast-section-toggle[data-action="toggle-sig-section"] .btn-collapse');
        if (body) body.style.display = '';
        if (arrow) arrow.textContent = '▾';
      }
      if (openUdstyrSections.has(mastIdx)) {
        const body = card.querySelector('.udstyr-section-body');
        const arrow = card.querySelector('.mast-section-toggle[data-action="toggle-udstyr-section"] .btn-collapse');
        if (body) body.style.display = '';
        if (arrow) arrow.textContent = '▾';
      }
    });
  }

  function renderMastCard(mast, mastIdx) {
    const armVarenr = '250-650-0148';
    const armVare = findVare(armVarenr);
    let armVistPåKort = false;

    const udstyrHtml = (mast.udstyr && mast.udstyr.length > 0)
      ? mast.udstyr.map((u, uIdx) => {
          const vare = u.varenr ? findVare(u.varenr) : null;
          const erKabel = KABEL_VARENUMRE.includes(u.varenr);
          const antalLabel = erKabel && u.antal ? `${u.antal}m ` : (u.antal && u.antal > 1 ? `${u.antal}× ` : '');
          const autoVarer = autoVarerForUdstyr(u, mast.mastetype);

          // Vis forlænger arm auto-vare — kun første gang på dette mastkort
          let armHtml = '';
          if (u.forlængerArm && RADAR_VARENUMRE.includes(u.varenr) && !armVistPåKort) {
            armVistPåKort = true;
            armHtml = `<div class="auto-vare-row">
              <span class="auto-vare-ikon">↳</span>
              <span class="auto-vare-label">1× ${escapeHtml(armVare ? armVare.beskrivelse : armVarenr)}</span>
              <span class="badge badge-auto">auto</span>
            </div>`;
          }

          if (u._redigerer) {
            return `
              <div class="item-row rediger-row">
                <span class="rediger-label">Redigerer udstyr:</span>
                <div class="add-form">
                  <div class="field"><label>Kategori</label>
                    <select data-rediger-u="kategori" data-mast="${mastIdx}" data-udstyr="${uIdx}">
                      ${UDSTYR_MENU.map(k => `<option value="${escapeHtml(k.kategori)}"${k.kategori === (findVareKategoriNavn(u.varenr)) ? ' selected' : ''}>${escapeHtml(k.kategori)}</option>`).join('')}
                    </select></div>
                  <div class="field"><label>Vare</label>
                    <select data-rediger-u="varenr" data-mast="${mastIdx}" data-udstyr="${uIdx}">
                      ${(findVareKategoriVarer(u.varenr) || []).filter(v => !v.varenr.startsWith('INTERN-')).map(v => `<option value="${escapeHtml(v.varenr)}"${v.varenr === u.varenr ? ' selected' : ''}>${escapeHtml(visNavn(v))}</option>`).join('')}
                    </select></div>
                  <div class="field field-small"><label>Antal</label>
                    <input type="number" data-rediger-u="antal" data-mast="${mastIdx}" data-udstyr="${uIdx}" value="${u.antal || 1}" min="0.5" step="0.5" /></div>
                  <div class="field"><label>Betegnelse</label>
                    <input type="text" data-rediger-u="betegnelse" data-mast="${mastIdx}" data-udstyr="${uIdx}" value="${escapeHtml(u.betegnelse || '')}" /></div>
                  <button class="btn-primary" data-action="gem-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}">Gem</button>
                  <button class="btn-secondary" data-action="annuller-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}">Annullér</button>
                </div>
              </div>`;
          }

          const autoHtml = autoVarer.map((v, aIdx) => {
            const autoVare = findVare(v.varenr);
            const override = (u._autoOverrides || {})[aIdx] || {};
            if (override._slettet) return ''; // slettet
            const visAntal = override.antal !== undefined ? override.antal : v.antal;
            const visVarenrAuto = override.varenr || v.varenr;
            const visVare = findVare(visVarenrAuto);
            const aLabel = Number.isInteger(visAntal) ? `${visAntal}×` : `${visAntal}m`;

            if (override._redigerer) {
              const antalDd = bygAntalDropdownHtml(visAntal);
              const varenrDd = bygVareDropdownHtml(v.varenr, visVarenrAuto);
              return `<div class="auto-vare-row rediger-auto-row">
                <span class="auto-vare-ikon">↳</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1">
                  <div style="display:flex;flex-direction:column;gap:2px">
                    <label style="font-size:10px;color:var(--text-subtle)">Antal</label>
                    <span id="auto-u-antal-wrap-${mastIdx}-${uIdx}-${aIdx}">${antalDd}</span>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:2px">
                    <label style="font-size:10px;color:var(--text-subtle)">Vare</label>
                    <span id="auto-u-varenr-wrap-${mastIdx}-${uIdx}-${aIdx}">${varenrDd}</span>
                  </div>
                  <div style="display:flex;gap:4px;align-self:flex-end">
                    <button class="btn-primary" style="padding:4px 12px;font-size:12px" data-action="gem-auto-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}" data-auto="${aIdx}">Gem</button>
                    <button class="btn-secondary" style="padding:4px 10px;font-size:12px" data-action="annuller-auto-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}" data-auto="${aIdx}">Annullér</button>
                  </div>
                </div>
              </div>`;
            }
            return `<div class="auto-vare-row">
              <span class="auto-vare-ikon">↳</span>
              <span class="auto-vare-label">${aLabel} ${escapeHtml(visVare ? visVare.beskrivelse : visVarenrAuto)}</span>
              <span class="badge badge-auto">${override.varenr || override.antal !== undefined ? 'ændret' : 'auto'}</span>
              <button class="btn-icon btn-rediger" style="font-size:10px;padding:1px 6px;margin-left:auto" data-action="rediger-auto-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}" data-auto="${aIdx}" title="Redigér auto-vare">✎</button>
              <button class="btn-icon" style="font-size:10px;padding:1px 6px" data-action="slet-auto-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}" data-auto="${aIdx}" title="Slet auto-vare">×</button>
            </div>`;
          }).join('');
          return `
            <div class="item-row">
              <span class="badge badge-warning">${escapeHtml(visVarenr(u.varenr) || u.type || '')}</span>
              <span class="item-label">${antalLabel}${escapeHtml(vare ? vare.beskrivelse : (u.type || ''))}${u.forlængerArm ? ' <span class="badge badge-neutral" style="font-size:10px">arm</span>' : ''}${u.klistermaerke ? ' <span class="badge badge-neutral" style="font-size:10px">🏷 mærkat</span>' : ''}</span>
              ${u.betegnelse ? `<span class="item-note">${escapeHtml(u.betegnelse)}</span>` : ''}
              <button class="btn-icon btn-rediger" data-action="rediger-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}" title="Redigér">✎</button>
              <button class="btn-icon" data-action="del-udstyr" data-mast="${mastIdx}" data-udstyr="${uIdx}">×</button>
            </div>
            ${armHtml}
            ${autoHtml}
          `;
        }).join('')
      : '<p class="empty-state">Intet ekstra udstyr</p>';

    const signalerHtml = mast.signaler.length > 0
      ? mast.signaler.map((sig, sigIdx) => {
          // Redigér-mode
          if (sig._redigerer) {
            const hojdeOpts = HOJDE_MULIGHEDER.map(h =>
              `<option value="${escapeHtml(h)}"${h === sig.hojde ? ' selected' : ''}>${h || '—'}</option>`
            ).join('');
            const katOpts = SIGNAL_KATEGORIER.map(k =>
              `<option value="${escapeHtml(k.kategori)}"${k.kategori === sig.kategori ? ' selected' : ''}>${escapeHtml(k.kategori)}</option>`
            ).join('');
            const valgtKat = SIGNAL_KATEGORIER.find(k => k.kategori === sig.kategori);
            const typeOpts = valgtKat ? valgtKat.typer.map(ty =>
              `<option value="${escapeHtml(ty.label)}"${ty.label === sig.type ? ' selected' : ''}>${escapeHtml(visNavn(ty))}</option>`
            ).join('') : `<option value="${escapeHtml(sig.type)}">${escapeHtml(sig.type)}</option>`;
            return `
              <div class="item-row rediger-row">
                <span class="rediger-label">Redigerer signal:</span>
                <div class="add-form">
                  <div class="field"><label>Kategori</label>
                    <select data-rediger-sig="kategori" data-mast="${mastIdx}" data-sig="${sigIdx}">${katOpts}</select></div>
                  <div class="field"><label>Type</label>
                    <select data-rediger-sig="type" data-mast="${mastIdx}" data-sig="${sigIdx}">${typeOpts}</select></div>
                  <div class="field field-small"><label>Betegnelse</label>
                    <input type="text" data-rediger-sig="betegnelse" data-mast="${mastIdx}" data-sig="${sigIdx}" value="${escapeHtml(sig.betegnelse || '')}" /></div>
                  <div class="field field-small"><label>Højde</label>
                    <select data-rediger-sig="hojde" data-mast="${mastIdx}" data-sig="${sigIdx}">${hojdeOpts}</select></div>
                  <div class="field"><label>Note</label>
                    <input type="text" data-rediger-sig="note" data-mast="${mastIdx}" data-sig="${sigIdx}" value="${escapeHtml(sig.note || '')}" /></div>
                  ${sig.kategori && sig.kategori.includes('Ercolight') ? `
                  <div class="field" style="justify-content:flex-end">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;font-size:13px;color:var(--text)">
                      <input type="checkbox" data-rediger-sig="pilemaske" data-mast="${mastIdx}" data-sig="${sigIdx}" style="width:auto;min-height:auto;cursor:pointer" ${sig.pilemaske ? 'checked' : ''} />
                      Med pilemaske
                    </label>
                  </div>` : ''}
                  <button class="btn-primary" data-action="gem-sig" data-mast="${mastIdx}" data-sig="${sigIdx}">Gem</button>
                  <button class="btn-secondary" data-action="annuller-sig" data-mast="${mastIdx}" data-sig="${sigIdx}">Annullér</button>
                </div>
              </div>`;
          }
          const autoVarer = autoVarerForSignal(sig);
          const autoHtml = autoVarer.map((v, aIdx) => {
            const override = (sig._autoOverrides || {})[aIdx] || {};
            if (override._slettet) return ''; // slettet
            const visAntal = override.antal !== undefined ? override.antal : v.antal;
            const visVarenrAuto = override.varenr || v.varenr;
            const visVare = findVare(visVarenrAuto);
            const aLabel = Number.isInteger(visAntal) ? `${visAntal}×` : `${visAntal}m`;

            if (override._redigerer) {
              const antalDd = bygAntalDropdownHtml(visAntal);
              const varenrDd = bygVareDropdownHtml(v.varenr, visVarenrAuto);
              return `<div class="auto-vare-row rediger-auto-row">
                <span class="auto-vare-ikon">↳</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1">
                  <div style="display:flex;flex-direction:column;gap:2px">
                    <label style="font-size:10px;color:var(--text-subtle)">Antal</label>
                    <span id="auto-sig-antal-wrap-${mastIdx}-${sigIdx}-${aIdx}">${antalDd}</span>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:2px">
                    <label style="font-size:10px;color:var(--text-subtle)">Vare</label>
                    <span id="auto-sig-varenr-wrap-${mastIdx}-${sigIdx}-${aIdx}">${varenrDd}</span>
                  </div>
                  <div style="display:flex;gap:4px;align-self:flex-end">
                    <button class="btn-primary" style="padding:4px 12px;font-size:12px" data-action="gem-auto-sig" data-mast="${mastIdx}" data-sig="${sigIdx}" data-auto="${aIdx}">Gem</button>
                    <button class="btn-secondary" style="padding:4px 10px;font-size:12px" data-action="annuller-auto-sig" data-mast="${mastIdx}" data-sig="${sigIdx}" data-auto="${aIdx}">Annullér</button>
                  </div>
                </div>
              </div>`;
            }
            return `<div class="auto-vare-row">
              <span class="auto-vare-ikon">↳</span>
              <span class="auto-vare-label">${aLabel} ${escapeHtml(visVare ? visVare.beskrivelse : visVarenrAuto)}</span>
              <span class="badge badge-auto">${override.varenr || override.antal !== undefined ? 'ændret' : 'auto'}</span>
              <button class="btn-icon btn-rediger" style="font-size:10px;padding:1px 6px;margin-left:auto" data-action="rediger-auto-sig" data-mast="${mastIdx}" data-sig="${sigIdx}" data-auto="${aIdx}" title="Redigér auto-vare">✎</button>
              <button class="btn-icon" style="font-size:10px;padding:1px 6px" data-action="slet-auto-sig" data-mast="${mastIdx}" data-sig="${sigIdx}" data-auto="${aIdx}" title="Slet auto-vare">×</button>
            </div>`;
          }).join('');
          const hojdeBadge = sig.hojde
            ? `<span class="badge badge-neutral">${escapeHtml(sig.hojde)}</span>`
            : `<span class="badge badge-hojde-advarsel" title="Højde er ikke valgt">⚠ Højde</span>`;
          const pilemaskeBadge = sig.pilemaske ? `<span class="badge badge-neutral" style="font-size:10px">🔺 Pilemaske</span>` : '';
          return `
            <div class="item-row">
              <span class="badge">${escapeHtml(sig.betegnelse || '?')}</span>
              <span class="item-label">${escapeHtml(sig.type)}</span>
              ${hojdeBadge}
              ${pilemaskeBadge}
              ${sig.note ? `<span class="item-note">${escapeHtml(sig.note)}</span>` : ''}
              <button class="btn-icon btn-rediger" data-action="rediger-sig" data-mast="${mastIdx}" data-sig="${sigIdx}" title="Redigér">✎</button>
              <button class="btn-icon" data-action="del-signal" data-mast="${mastIdx}" data-sig="${sigIdx}">×</button>
            </div>
            ${autoHtml}
          `;
        }).join('')
      : '<p class="empty-state">Ingen signaler</p>';

    const udstyrOptions = UDSTYR_TYPER.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    const signalOptions = SIGNAL_TYPER.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    const hojdeOptions = HOJDE_MULIGHEDER.map(h => `<option value="${escapeHtml(h)}">${h || '—'}</option>`).join('');
    const mastetypeOptions = MASTETYPER_GRUPPER.map(g =>
      `<optgroup label="${escapeHtml(g.gruppe)}">${g.typer.map(m =>
        `<option value="${escapeHtml(m.label)}"${m.label === mast.mastetype ? ' selected' : ''}>${escapeHtml(visNavn(m))}</option>`
      ).join('')}</optgroup>`
    ).join('');

    const signalerCount = mast.signaler.length;
    const udstyrCount = (mast.udstyr || []).length;
    const summary = [
      signalerCount > 0 ? `${signalerCount} signal${signalerCount > 1 ? 'er' : ''}` : '',
      udstyrCount > 0 ? `${udstyrCount} udstyr` : ''
    ].filter(Boolean).join(', ');

    const mastAutoVarer = autoVarerForMast(mast);
    const mastAutoHtml = mastAutoVarer.map(v => {
      const vare = findVare(v.varenr);
      return `<div class="auto-vare-row" style="margin-bottom:3px">
        <span class="auto-vare-ikon">↳</span>
        <span class="auto-vare-label">${v.antal}× ${escapeHtml(vare ? vare.beskrivelse : v.varenr)}</span>
        <span class="badge badge-auto">auto</span>
      </div>`;
    }).join('');

    return `
      <section class="mast-card" data-collapsed="false">
        <div class="mast-header">
          <div style="display:flex;align-items:center;gap:0.5rem;flex:1;min-width:0;flex-wrap:wrap;">
            <button class="btn-collapse" data-action="toggle-mast" data-mast="${mastIdx}" title="Fold/unfold">▾</button>
            ${mast._redigerer ? `
              <input type="text" data-field="mast-id-edit" data-mast="${mastIdx}" value="${escapeHtml(mast.mastId)}" style="width:80px;font-size:15px;font-weight:700;padding:4px 8px" />
              <select data-field="mastetype-edit" data-mast="${mastIdx}" style="font-size:12px;padding:4px 8px;flex:1;min-width:120px">${mastetypeOptions}</select>
              <button class="btn-primary" style="padding:4px 12px;font-size:12px" data-action="gem-mast" data-mast="${mastIdx}">Gem</button>
              <button class="btn-secondary" style="padding:4px 10px;font-size:12px" data-action="annuller-mast" data-mast="${mastIdx}">Annullér</button>
            ` : `
              <span class="mast-title">${escapeHtml(mast.mastId)}</span>
              <span class="mast-subtype-label">${escapeHtml(findMasteVisNavn(mast.mastetype))}</span>
              <span class="mast-summary" style="display:none">${escapeHtml(summary)}</span>
            `}
          </div>
          <div style="display:flex;gap:4px">
            ${mast._redigerer ? '' : `<button class="btn-icon btn-rediger" data-action="rediger-mast" data-mast="${mastIdx}" title="Redigér mast">✎</button>`}
            ${erAdmin ? `<button class="btn-icon" data-action="del-mast" data-mast="${mastIdx}">Slet</button>` : ''}
          </div>
        </div>
        ${mastAutoHtml ? `<div style="padding:0 0 0.5rem">${mastAutoHtml}</div>` : ''}

        <div class="mast-body">
          <div class="mast-section">
            <div class="mast-section-toggle" data-action="toggle-sig-section" data-mast="${mastIdx}" style="cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none">
              <span class="btn-collapse" style="font-size:14px">▸</span>
              <span class="mast-section-label" style="margin:0">Signaler ${mast.signaler.length > 0 ? `<span class="badge" style="font-size:10px;padding:1px 7px">${mast.signaler.length}</span>` : ''}</span>
            </div>
            <div class="sig-section-body" style="display:none">
              ${signalerHtml}
              <div class="add-form">
                <div class="field">
                  <label>Kategori</label>
                  <select data-field="signalkategori" data-mast="${mastIdx}">
                    <option value="">— Vælg kategori —</option>
                    ${SIGNAL_KATEGORIER.map(k => `<option value="${escapeHtml(k.kategori)}">${escapeHtml(k.kategori)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>Præcis type</label>
                  <select data-field="signaltype" data-mast="${mastIdx}" disabled>
                    <option value="">— Vælg kategori først —</option>
                  </select>
                </div>
                <div class="field field-small">
                  <label>Betegnelse</label>
                  <input type="text" data-field="betegnelse" data-mast="${mastIdx}" placeholder="A1H" />
                </div>
                <div class="field field-small">
                  <label>Højde</label>
                  <select data-field="ny-hojde" data-mast="${mastIdx}">${hojdeOptions}</select>
                </div>
                <div class="field">
                  <label>Note</label>
                  <input type="text" data-field="note" data-mast="${mastIdx}" placeholder="(valgfri)" />
                </div>
                <div class="field" id="pilemaske-wrap-${mastIdx}" style="display:none;justify-content:flex-end">
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;font-size:13px;color:var(--text)">
                    <input type="checkbox" data-field="pilemaske" data-mast="${mastIdx}" style="width:auto;min-height:auto;cursor:pointer" />
                    Med pilemaske
                  </label>
                </div>
                <button class="btn-secondary" data-action="add-signal" data-mast="${mastIdx}">+ Tilføj signal</button>
              </div>
            </div>
          </div>

          <div class="mast-section">
            <div class="mast-section-toggle" data-action="toggle-udstyr-section" data-mast="${mastIdx}" style="cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none">
              <span class="btn-collapse" style="font-size:14px">▸</span>
              <span class="mast-section-label" style="margin:0">Ekstra udstyr ${(mast.udstyr||[]).length > 0 ? `<span class="badge badge-warning" style="font-size:10px;padding:1px 7px">${mast.udstyr.length}</span>` : ''}</span>
            </div>
            <div class="udstyr-section-body" style="display:none">
              ${udstyrHtml}
              <div class="add-form">
                <div class="field">
                  <label>Kategori</label>
                  <select data-field="udstyrkategori" data-mast="${mastIdx}">
                    <option value="">— Vælg kategori —</option>
                    ${UDSTYR_MENU.map(k => `<option value="${escapeHtml(k.kategori)}">${escapeHtml(k.kategori)}</option>`).join('')}
                  </select>
                </div>
                <div class="field" id="udstyr-under-wrap-${mastIdx}" style="display:none">
                  <label>Underkategori</label>
                  <select data-field="udstyrunderkategori" data-mast="${mastIdx}" disabled>
                    <option value="">— Vælg underkategori —</option>
                  </select>
                </div>
                <div class="field">
                  <label>Vare</label>
                  <select data-field="udstyrtype" data-mast="${mastIdx}" disabled>
                    <option value="">— Vælg kategori først —</option>
                  </select>
                </div>
                <div class="field field-small" id="udstyr-meter-wrap-${mastIdx}" style="display:none">
                  <label>Meter</label>
                  <input type="number" data-field="udstyrmeter" data-mast="${mastIdx}" placeholder="m" min="0.5" step="0.5" style="min-width:60px" />
                </div>
                <div class="field field-small" id="udstyr-antal-wrap-${mastIdx}">
                  <label>Antal</label>
                  <input type="number" data-field="udstyrantal" data-mast="${mastIdx}" placeholder="1" min="1" step="1" value="1" style="min-width:60px" />
                </div>
                <div class="field field-small" id="udstyr-arm-wrap-${mastIdx}" style="display:none">
                  <label>På arm?</label>
                  <select data-field="udstyrarm" data-mast="${mastIdx}">
                    <option value="nej">Nej</option>
                    <option value="ja">Ja</option>
                  </select>
                </div>
                <div class="field">
                  <label>Betegnelse (valgfri)</label>
                  <input type="text" data-field="udstyrbetegnelse" data-mast="${mastIdx}" placeholder="fx Radar 1" />
                </div>
                <div class="field" id="udstyr-klisterm-wrap-${mastIdx}" style="display:none;justify-content:flex-end">
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;font-size:13px;color:var(--text)">
                    <input type="checkbox" data-field="udstyrklistermaerke" data-mast="${mastIdx}" style="width:auto;min-height:auto;cursor:pointer" />
                    Med klistermærke
                  </label>
                </div>
                <button class="btn-secondary" data-action="add-udstyr" data-mast="${mastIdx}">+ Tilføj udstyr</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function filtereredeMaster() {
    if (!mastFilter) return state.master;
    return state.master.filter(m => mastFilter.has(m.mastId));
  }
  function generateTekst() {
    const dato = new Date().toISOString().slice(0, 10);
    const nummer = fullTegningsnr();
    const titel = nummer
      ? `ANLAEG ${nummer}${state.navn ? ' - ' + state.navn : ''}`
      : `ANLAEG: ${state.navn || '(uden navn)'}`;
    let t = titel + '\n' + '='.repeat(titel.length) + '\n\n';
    if (state.nr) t += `Anlaegsnummer:   ${state.nr}\n`;
    t += `Dato:            ${dato}\n`;
    t += `Antal master:    ${filtereredeMaster().length}\n`;
    const totalSignaler = state.master.reduce((sum, m) => sum + m.signaler.length, 0);
    t += `Antal signaler:  ${totalSignaler}\n\n`;

    if (filtereredeMaster().length === 0) {
      t += 'Ingen master tilfoejt endnu.\n';
    } else {
      filtereredeMaster().forEach(mast => {
        const masteVarenr = findMasteVarenr(mast.mastetype);
        const header = `${mast.mastId} - ${mast.mastetype}${masteVarenr ? ' [' + masteVarenr + ']' : ''}`;
        t += header + '\n' + '-'.repeat(header.length) + '\n';

        // Mast auto-varer
        autoVarerForMast(mast).forEach(v => {
          const vare = findVare(v.varenr);
          const vn = visVarenr(v.varenr);
          t += `  * ${vare ? vare.beskrivelse : v.varenr} x ${v.antal} stk.${vn ? ' [' + vn + ']' : ''}\n`;
        });

        // Signaler
        if (mast.signaler.length > 0) {
          t += '\n';
          mast.signaler.forEach(sig => {
            const vn = visVarenr(sig.varenr);
            let line = `  * ${sig.betegnelse || '?'}: ${sig.type}`;
            if (sig.hojde) line += ` (${sig.hojde})`;
            if (vn) line += ` [${vn}]`;
            if (sig.note) line += ` - ${sig.note}`;
            t += line + '\n';
            autoVarerForSignal(sig).forEach((v, aIdx) => {
              const override = (sig._autoOverrides || {})[aIdx] || {};
              if (override._slettet) return;
              const varenr = override.varenr || v.varenr;
              const antal = override.antal !== undefined ? override.antal : v.antal;
              const vare = findVare(varenr);
              const vn2 = visVarenr(varenr);
              const aLabel = Number.isInteger(antal) ? `${antal} stk.` : `${antal} m`;
              t += `    * ${vare ? vare.beskrivelse : varenr} x ${aLabel}${vn2 ? ' [' + vn2 + ']' : ''}\n`;
            });
          });
        }

        // Ekstra udstyr
        if (mast.udstyr && mast.udstyr.length > 0) {
          t += '\n';
          mast.udstyr.forEach(u => {
            const vn = visVarenr(u.varenr);
            const erKabel = KABEL_VARENUMRE.includes(u.varenr);
            const antalLabel = erKabel ? `${u.antal || 1} m` : `${u.antal || 1} stk.`;
            let line = `  * ${u.type || ''}${u.betegnelse ? ' - ' + u.betegnelse : ''} x ${antalLabel}`;
            if (vn) line += ` [${vn}]`;
            t += line + '\n';
            autoVarerForUdstyr(u, mast.mastetype).forEach((v, aIdx) => {
              const override = (u._autoOverrides || {})[aIdx] || {};
              if (override._slettet) return;
              const varenr = override.varenr || v.varenr;
              const antal = override.antal !== undefined ? override.antal : v.antal;
              const vare = findVare(varenr);
              const vn2 = visVarenr(varenr);
              const aLabel = Number.isInteger(antal) ? `${antal} stk.` : `${antal} m`;
              t += `    * ${vare ? vare.beskrivelse : varenr} x ${aLabel}${vn2 ? ' [' + vn2 + ']' : ''}\n`;
            });
          });
        }
        t += '\n';
      });
    }
    return t;
  }

  function generateMarkdown() {
    const dato = new Date().toISOString().slice(0, 10);
    const nummer = fullTegningsnr();

    let md = '---\n';
    md += 'tags:\n  - signalanlæg\n';
    if (state.nr) md += `anlægsnummer: ${state.nr}\n`;
    if (state.navn) md += `navn: ${state.navn}\n`;
    md += `dato: ${dato}\n`;
    md += `antal_master: ${filtereredeMaster().length}\n`;
    const totalSignaler = state.master.reduce((sum, m) => sum + m.signaler.length, 0);
    md += `antal_signaler: ${totalSignaler}\n`;
    md += '---\n\n';

    const titel = nummer
      ? `# Anlæg ${nummer}${state.navn ? ' – ' + state.navn : ''}`
      : `# Anlæg: ${state.navn || '(uden navn)'}`;
    md += titel + '\n\n## Oversigt\n\n';
    if (state.nr) md += `**Anlægsnummer:** ${state.nr}\n`;
    md += `**Dato:** ${dato}\n`;
    md += `**Antal master:** ${filtereredeMaster().length}\n`;
    md += `**Antal signaler:** ${totalSignaler}\n\n---\n\n`;

    if (filtereredeMaster().length === 0) {
      md += '_Ingen master tilføjet endnu._\n';
    } else {
      filtereredeMaster().forEach(mast => {
        const masteVarenr = findMasteVarenr(mast.mastetype);
        md += `## ${mast.mastId} – ${mast.mastetype}${masteVarenr ? ` \`${masteVarenr}\`` : ''}\n\n`;
        if (mast.mastetype) md += `**Mastetype:** ${mast.mastetype}${masteVarenr ? ` · \`${masteVarenr}\`` : ''}\n`;

        // Mast varer (auto)
        autoVarerForMast(mast).forEach(v => {
          const vare = findVare(v.varenr);
          const vn = visVarenr(v.varenr);
          md += `- ${vare ? vare.beskrivelse : v.varenr} × ${v.antal} stk.${vn ? ` · \`${vn}\`` : ''}\n`;
        });
        md += '\n';

        if (mast.signaler.length > 0) {
          md += '**Signaler:**\n';
          mast.signaler.forEach(sig => {
            const vn = visVarenr(sig.varenr);
            let line = `- **${sig.betegnelse || '?'}:** ${sig.type}`;
            if (sig.hojde) line += ` _(${sig.hojde})_`;
            if (vn) line += ` · \`${vn}\``;
            if (sig.note) line += ` — _${sig.note}_`;
            md += line + '\n';
            autoVarerForSignal(sig).forEach((v, aIdx) => {
              const override = (sig._autoOverrides || {})[aIdx] || {};
              if (override._slettet) return;
              const varenr = override.varenr || v.varenr;
              const antal = override.antal !== undefined ? override.antal : v.antal;
              const vare = findVare(varenr);
              const vn2 = visVarenr(varenr);
              const aLabel = Number.isInteger(antal) ? `${antal} stk.` : `${antal} m`;
              md += `  - ${vare ? vare.beskrivelse : varenr} × ${aLabel}${vn2 ? ` · \`${vn2}\`` : ''}\n`;
            });
          });
          md += '\n';
        }

        if (mast.udstyr && mast.udstyr.length > 0) {
          md += '**Ekstra udstyr:**\n';
          mast.udstyr.forEach(u => {
            const vn = visVarenr(u.varenr);
            const erKabel = KABEL_VARENUMRE.includes(u.varenr);
            const antalLabel = erKabel ? `${u.antal || 1} m` : `${u.antal || 1} stk.`;
            let line = `- ${u.type || ''}${u.betegnelse ? ' – ' + u.betegnelse : ''} × ${antalLabel}`;
            if (vn) line += ` · \`${vn}\``;
            md += line + '\n';
            autoVarerForUdstyr(u, mast.mastetype).forEach((v, aIdx) => {
              const override = (u._autoOverrides || {})[aIdx] || {};
              if (override._slettet) return;
              const varenr = override.varenr || v.varenr;
              const antal = override.antal !== undefined ? override.antal : v.antal;
              const vare = findVare(varenr);
              const vn2 = visVarenr(varenr);
              const aLabel = Number.isInteger(antal) ? `${antal} stk.` : `${antal} m`;
              md += `  - ${vare ? vare.beskrivelse : varenr} × ${aLabel}${vn2 ? ` · \`${vn2}\`` : ''}\n`;
            });
          });
          md += '\n';
        }
      });
    }
    return md;
  }

  function opdaterOutput() {
    const format = $('format-vaelger').value;
    $('output').value = format === 'txt' ? generateTekst() : generateMarkdown();
  }

  function render() {
    renderMaster();
    renderMastFilter();
    opdaterOutput();
    planAutoGem();
  }

  function renderMastFilter() {
    const wrap = $('mast-filter-wrap');
    const checkboxes = $('mast-filter-checkboxes');
    if (!wrap || !checkboxes) return;
    if (state.master.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    checkboxes.innerHTML = state.master.map(m => `
      <label class="mast-filter-chip ${!mastFilter || mastFilter.has(m.mastId) ? 'aktiv' : ''}">
        <input type="checkbox" data-mast-filter="${escapeHtml(m.mastId)}"
          ${!mastFilter || mastFilter.has(m.mastId) ? 'checked' : ''} />
        ${escapeHtml(m.mastId)}
      </label>`).join('');
    checkboxes.querySelectorAll('input[data-mast-filter]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (!mastFilter) mastFilter = new Set(state.master.map(m => m.mastId));
        if (cb.checked) mastFilter.add(cb.dataset.mastFilter);
        else mastFilter.delete(cb.dataset.mastFilter);
        opdaterOutput();
      });
    });
  }

  // ==============================
  // Automatiske regler
  // ==============================
  // Auto-regler — indlæses fra Supabase
  let AUTO_REGLER_SIGNAL = [];
  let AUTO_REGLER_UDSTYR = [];
  let AUTO_REGLER_MAST = [];
  const AUTO_REGLER = AUTO_REGLER_SIGNAL;


  function matcherEt(felt, op, vaerdi, obj) {
    if (!felt || !op || !vaerdi) return true; // tom betingelse = altid sand
    const val = obj[felt];
    if (op === 'equals') return String(val) === vaerdi;
    if (op === 'includes') return val && String(val).includes(vaerdi);
    if (op === 'not_includes') return !val || !String(val).includes(vaerdi);
    if (op === 'in_list') return vaerdi.split(',').includes(String(val));
    if (felt === 'underkategori_og_klisterm') return obj.klistermaerke && obj.underkategori === vaerdi;
    return false;
  }

  function matcherPasser(regel, obj) {
    const første = matcherEt(regel.matcher_felt, regel.matcher_operator, regel.matcher_vaerdi, obj);
    if (!første) return false;
    if (regel.matcher_felt2 && regel.matcher_operator2 && regel.matcher_vaerdi2) {
      return matcherEt(regel.matcher_felt2, regel.matcher_operator2, regel.matcher_vaerdi2, obj);
    }
    return true;
  }

  // Beregn automatiske varer for et enkelt signal
  function autoVarerForSignal(sig) {
    const result = [];
    AUTO_REGLER_SIGNAL.forEach(regel => {
      if (matcherPasser(regel, sig)) regel.varer.forEach(v => result.push({ ...v }));
    });
    return result;
  }

  // Beregn automatiske varer for et enkelt udstyr (med mastetype og arm-info)
  function autoVarerForUdstyr(u, mastetype) {
    const result = [];
    AUTO_REGLER_UDSTYR.forEach(regel => {
      if (matcherPasser(regel, u)) regel.varer.forEach(v => result.push({ ...v }));
    });

    // Spændbånd for radar/kamera — slås op fra maste_typer via SPAENDBAAND_PR_MAST
    if (RADAR_VARENUMRE.includes(u.varenr)) {
      if (u.forlængerArm) {
        const svarenr = FLIR_VARENUMRE.includes(u.varenr) ? SPAENDBAAND_ARM_FLIR : SPAENDBAAND_ARM_DEFAULT;
        result.push({ varenr: svarenr, antal: 2 });
      } else if (mastetype) {
        const svarenr = SPAENDBAAND_PR_MAST[mastetype];
        if (svarenr) result.push({ varenr: svarenr, antal: 2 });
      }
    }

    return result;
  }

  // Find kategorinavn for et varenr
  // Hjælpefunktioner
  function findVare(varenr) {
    for (const kat of VAREKATALOG) {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      const v = alleVarer.find(v => v.varenr === varenr);
      if (v) return v;
    }
    return null;
  }

  function visVarenr(varenr) {
    if (!varenr || varenr.startsWith('INTERN-')) return '';
    return varenr;
  }

  // Vis kaldenavn i menus, label/beskrivelse i output
  function visNavn(obj) {
    if (!obj) return '';
    return (obj.kaldenavn && obj.kaldenavn.trim()) ? obj.kaldenavn : (obj.beskrivelse || obj.label || '');
  }

  function findMasteVarenr(label) {
    for (const g of MASTETYPER_GRUPPER) {
      const t = g.typer.find(t => t.label === label);
      if (t) return visVarenr(t.varenr) || '';
    }
    return '';
  }

  function findMasteVisNavn(label) {
    for (const g of MASTETYPER_GRUPPER) {
      const t = g.typer.find(t => t.label === label);
      if (t) return visNavn(t) || label;
    }
    return label;
  }

  function findVareKategoriNavn(varenr) {
    for (const kat of VAREKATALOG) {
      if (kat.underkategorier) {
        for (const under of kat.underkategorier) {
          if (under.varer.find(v => v.varenr === varenr)) return kat.kategori;
        }
      } else if (kat.varer) {
        if (kat.varer.find(v => v.varenr === varenr)) return kat.kategori;
      }
    }
    return null;
  }

  // Find alle varer i samme kategori som et givet varenr (til dropdown)
  function findVareKategoriVarer(varenr) {
    for (const kat of VAREKATALOG) {
      if (kat.underkategorier) {
        for (const under of kat.underkategorier) {
          if (under.varer.find(v => v.varenr === varenr)) return under.varer;
        }
      } else if (kat.varer) {
        if (kat.varer.find(v => v.varenr === varenr)) return kat.varer;
      }
    }
    return null;
  }

  // Byg varenr dropdown HTML for en given vare (fra samme kategori)
  function bygVareDropdownHtml(varenr, selected) {
    const varer = findVareKategoriVarer(varenr);
    if (!varer) return `<input type="text" value="${escapeHtml(selected)}" style="width:150px;font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-2);color:var(--text)" />`;
    return `<select style="font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-2);color:var(--text);min-width:180px">
      ${varer.filter(v => !v.varenr.startsWith('INTERN-')).map(v =>
        `<option value="${escapeHtml(v.varenr)}"${v.varenr === selected ? ' selected' : ''}>${escapeHtml(visNavn(v))}</option>`
      ).join('')}
    </select>`;
  }

  // Byg antal dropdown (0.5 til 20 med 0.5 trin, plus heltal op til 20)
  function bygAntalDropdownHtml(selected) {
    const opts = [];
    for (let i = 0.5; i <= 20; i += 0.5) {
      const label = Number.isInteger(i) ? `${i}` : `${i}`;
      opts.push(`<option value="${i}"${i === selected ? ' selected' : ''}>${label}</option>`);
    }
    return `<select style="width:80px;font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-2);color:var(--text)">${opts.join('')}</select>`;
  }

  function autoVarerForMast(mast) {
    const result = [];
    AUTO_REGLER_MAST.forEach(regel => {
      if (matcherPasser(regel, mast)) regel.varer.forEach(v => result.push({ ...v }));
    });
    return result;
  }

  // Beregn stykliste pr. mast inkl. automatiske varer
  function beregnStyklistePrMast(mast) {
    const tæller = {};
    // Mastetype
    const masteVarenr = findMasteVarenr(mast.mastetype);
    if (masteVarenr) tæller[masteVarenr] = (tæller[masteVarenr] || 0) + 1;
    // Auto-varer fra mastetype (hætter osv.)
    autoVarerForMast(mast).forEach(v => {
      tæller[v.varenr] = (tæller[v.varenr] || 0) + v.antal;
    });
    // Manuelt tilføjet udstyr + auto-varer for udstyr
    let armTilfoejt = false;
    (mast.udstyr || []).forEach(u => {
      if (u.varenr) {
        const antal = parseFloat(u.antal) || 1;
        tæller[u.varenr] = (tæller[u.varenr] || 0) + antal;
      }
      // Forlænger arm — max 1 pr. mast
      if (u.forlængerArm && RADAR_VARENUMRE.includes(u.varenr) && !armTilfoejt) {
        tæller['250-650-0148'] = (tæller['250-650-0148'] || 0) + 1;
        armTilfoejt = true;
      }
      const udstyrAntal = parseFloat(u.antal) || 1;
      autoVarerForUdstyr(u, mast.mastetype).forEach((v, aIdx) => {
        const override = (u._autoOverrides || {})[aIdx] || {};
        if (override._slettet) return;
        const varenr = override.varenr || v.varenr;
        const autoAntal = override.antal !== undefined ? override.antal : v.antal;
        tæller[varenr] = (tæller[varenr] || 0) + (autoAntal * udstyrAntal);
      });
    });
    // Automatiske varer fra signaler + selve lanterner
    (mast.signaler || []).forEach(sig => {
      if (sig.varenr) tæller[sig.varenr] = (tæller[sig.varenr] || 0) + 1;
      autoVarerForSignal(sig).forEach((v, aIdx) => {
        const override = (sig._autoOverrides || {})[aIdx] || {};
        if (override._slettet) return;
        const varenr = override.varenr || v.varenr;
        const antal = override.antal !== undefined ? override.antal : v.antal;
        tæller[varenr] = (tæller[varenr] || 0) + antal;
      });
    });
    return tæller;
  }

  // Byg signal-sektion fra total (TYPE: nøgler)
  function signalSektionHtml(total) {
    const signaler = Object.entries(total)
      .filter(([k]) => k.startsWith('TYPE:'))
      .map(([k, antal]) => ({ type: k.replace('TYPE:', ''), antal }))
      .sort((a, b) => a.type.localeCompare(b.type));
    if (signaler.length === 0) return '';
    return `
      <div class="stykliste-gruppe">
        <div class="stykliste-kat-label">Signaler</div>
        ${signaler.map(s => `<div class="stykliste-row">
          <span class="stykliste-varenr">—</span>
          <span class="stykliste-beskrivelse">${escapeHtml(s.type)}</span>
          <span class="stykliste-antal">${s.antal} stk.</span>
        </div>`).join('')}
      </div>`;
  }

  function signalSektionTekst(total) {
    const signaler = Object.entries(total)
      .filter(([k]) => k.startsWith('TYPE:'))
      .map(([k, antal]) => ({ type: k.replace('TYPE:', ''), antal }))
      .sort((a, b) => a.type.localeCompare(b.type));
    if (signaler.length === 0) return '';
    let t = 'Signaler:\n';
    signaler.forEach(s => {
      t += `  ${'—'.padEnd(18)} ${s.type} (${s.antal} stk.)\n`;
    });
    return t + '\n';
  }

  function signalSektionMd(total) {
    const signaler = Object.entries(total)
      .filter(([k]) => k.startsWith('TYPE:'))
      .map(([k, antal]) => ({ type: k.replace('TYPE:', ''), antal }))
      .sort((a, b) => a.type.localeCompare(b.type));
    if (signaler.length === 0) return '';
    let md = '### Signaler\n\n';
    signaler.forEach(s => md += `- — ${s.type} — **${s.antal} stk.**\n`);
    return md + '\n';
  }

  // Filtrer total for visning (fjern TYPE: nøgler fra varekatalog-loop)
  function totalUdenSignaler(total) {
    return Object.fromEntries(Object.entries(total).filter(([k]) => !k.startsWith('TYPE:')));
  }

  function renderStykliste() {
    const container = $('stykliste-indhold');
    if (!container) return;

    if (state.master.length === 0) {
      container.innerHTML = '<p class="empty-state">Ingen master tilføjet endnu.</p>';
      return;
    }

    // Samlet tæller på tværs af alle master
    const total = {};
    state.master.forEach(mast => {
      Object.entries(beregnStyklistePrMast(mast)).forEach(([varenr, antal]) => {
        total[varenr] = (total[varenr] || 0) + antal;
      });
    });

    if (Object.keys(total).length === 0) {
      container.innerHTML = '<p class="empty-state">Ingen varer tilføjet endnu.</p>';
      return;
    }

    // Vis pr. kategori — INTERN varer vises med — som varenr
    const grupperHtml = VAREKATALOG.map(kat => {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      const rækker = alleVarer.filter(v => total[v.varenr]);
      if (rækker.length === 0) return '';
      return `
        <div class="stykliste-gruppe">
          <div class="stykliste-kat-label">${escapeHtml(kat.kategori)}</div>
          ${rækker.map(v => {
            const erKabel = KABEL_VARENUMRE.includes(v.varenr);
            const antalVis = erKabel ? total[v.varenr] + ' m' : total[v.varenr] + ' stk.';
            return `<div class="stykliste-row">
              <span class="stykliste-varenr">${escapeHtml(visVarenr(v.varenr) || '—')}</span>
              <span class="stykliste-beskrivelse">${escapeHtml(v.beskrivelse)}</span>
              <span class="stykliste-antal">${antalVis}</span>
            </div>`;
          }).join('')}
        </div>`;
    }).join('');

    container.innerHTML = grupperHtml || '<p class="empty-state">Ingen kendte varer.</p>';
  }

  function generateStyklisteMarkdown() {
    const dato = new Date().toISOString().slice(0, 10);
    const nummer = fullTegningsnr();
    const titel = nummer
      ? `Stykliste – Anlæg ${nummer}${state.navn ? ' – ' + state.navn : ''}`
      : `Stykliste – ${state.navn || 'Anlæg'}`;
    let md = `# ${titel}\n\n`;
    md += `**Dato:** ${dato}  **Master:** ${state.master.length}\n\n`;

    const total = {};
    state.master.forEach(mast => {
      Object.entries(beregnStyklistePrMast(mast)).forEach(([varenr, antal]) => {
        total[varenr] = (total[varenr] || 0) + antal;
      });
    });

    if (Object.keys(total).length === 0) { md += '_Ingen varer._\n'; return md; }

    // DEL 1: Kategorier med varer
    VAREKATALOG.forEach(kat => {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      const varer = alleVarer.filter(v => total[v.varenr]);
      if (varer.length === 0) return;
      md += `### ${kat.kategori}\n\n`;
      varer.forEach(v => {
        const erKabel = KABEL_VARENUMRE.includes(v.varenr);
        const antalVis = erKabel ? total[v.varenr] + ' m' : total[v.varenr] + ' stk.';
        const vn = visVarenr(v.varenr) || '—';
        md += `- \`${vn}\` ${v.beskrivelse} — **${antalVis}**\n`;
      });
      md += '\n';
    });

    // DEL 2: Samlet tabel
    md += '---\n\n## Samlet oversigt\n\n';
    md += '| Varenr. | Beskrivelse | Antal |\n';
    md += '| :------ | :---------- | ----: |\n';
    VAREKATALOG.forEach(kat => {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      alleVarer.filter(v => total[v.varenr]).forEach(v => {
        const erKabel = KABEL_VARENUMRE.includes(v.varenr);
        const antalVis = erKabel ? total[v.varenr] + ' m' : total[v.varenr] + ' stk.';
        md += `| \`${visVarenr(v.varenr) || '—'}\` | ${v.beskrivelse} | **${antalVis}** |\n`;
      });
    });

    return md;
  }

  // ==============================
  // LocalStorage
  // ==============================
  function gemteNoegler() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && !k.includes('github')) keys.push(k);
    }
    return keys.sort();
  }

  function opdaterGemtListe() {
    const sel = $('gemte-anlaeg');
    sel.innerHTML = '<option value="">— Vælg gemt anlæg —</option>';
    gemteNoegler().forEach(k => {
      const navn = k.replace(STORAGE_PREFIX, '');
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = navn;
      sel.appendChild(opt);
    });
  }

  function indlaesAnlaeg(key) {
    if (!key) return;
    try {
      const data = localStorage.getItem(key);
      if (!data) return;
      state = JSON.parse(data);
      opdaterFormFelter();
      collapsedMaster.clear();
      state.master.forEach((_, i) => collapsedMaster.add(i));
      render();
      visBesked('✓ Anlæg indlæst');
    } catch (err) {
      visBesked('Kunne ikke indlæse: ' + err.message, 'danger');
    }
  }

  function sletAnlaeg(key) {
    if (!key) return;
    if (!confirm('Slet det gemte anlæg permanent?')) return;
    const navn = key.replace(STORAGE_PREFIX, '');
    localStorage.removeItem(key);
    opdaterGemtListe();
    visBesked('Anlæg slettet');
    supabaseSletAnlaeg(navn).catch(() => {});
  }

  function gemAnlaeg() {
    const idDel = state.nr.trim() || state.navn.trim();
    if (!idDel) {
      visBesked('Giv anlægget et nummer eller navn først', 'danger');
      return;
    }
    const key = STORAGE_PREFIX + idDel.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_');
    try {
      localStorage.setItem(key, JSON.stringify(state));
      opdaterGemtListe();
      $('gemte-anlaeg').value = key;
      visBesked('✓ Anlæg gemt');
      // Gem i Supabase
      supabaseGemAnlaeg(key, state).catch(() => {});
    } catch (err) {
      visBesked('Kunne ikke gemme: ' + err.message, 'danger');
    }
  }

  function omdoebAnlaeg(key) {
    if (!key) { visBesked('Vælg et anlæg først', 'danger'); return; }
    const gammeltNavn = key.replace(STORAGE_PREFIX, '');
    const container = $('omdoeb-container');
    if (container) {
      container.style.display = '';
      const input = $('omdoeb-input');
      if (input) { input.value = gammeltNavn; input.focus(); input.select(); }
    }
  }

  function bekraeftOmdoeb() {
    const key = $('gemte-anlaeg').value;
    if (!key) return;
    const nytNavn = $('omdoeb-input').value.trim();
    if (!nytNavn) return;
    const nyKey = STORAGE_PREFIX + nytNavn.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_');
    const data = localStorage.getItem(key);
    if (!data) return;
    localStorage.setItem(nyKey, data);
    localStorage.removeItem(key);
    $('omdoeb-container').style.display = 'none';
    opdaterGemtListe();
    $('gemte-anlaeg').value = nyKey;
    visBesked(`✓ Omdøbt til ${nytNavn}`);
  }

  function eksporterJson() {
    const alle = {};
    gemteNoegler().forEach(k => {
      alle[k.replace(STORAGE_PREFIX, '')] = JSON.parse(localStorage.getItem(k));
    });
    const blob = new Blob([JSON.stringify(alle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signalanlaeg-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    visBesked('✓ Alle anlæg eksporteret');
  }

  function eksporterJsonEnkelt() {
    const idDel = state.nr.trim() || state.navn.trim();
    if (!idDel) { visBesked('Udfyld anlægsnummer eller navn først', 'danger'); return; }
    const navn = idDel.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_');
    const enkelt = {};
    enkelt[navn] = state;
    const blob = new Blob([JSON.stringify(enkelt, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signalanlaeg-${navn}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    visBesked(`✓ Anlæg "${idDel}" eksporteret`);
  }

  function importerJson(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        let antal = 0;
        Object.entries(data).forEach(([navn, anlaeg]) => {
          const key = STORAGE_PREFIX + navn;
          localStorage.setItem(key, JSON.stringify(anlaeg));
          antal++;
        });
        opdaterGemtListe();
        visBesked(`✓ ${antal} anlæg importeret`);
      } catch (err) {
        visBesked('Ugyldig JSON-fil: ' + err.message, 'danger');
      }
    };
    reader.readAsText(file);
  }

  // ==============================
  // Form-håndtering
  // ==============================
  function opdaterFormFelter() {
    $('anlaeg-nr').value = state.nr;
    $('anlaeg-navn').value = state.navn;
  }

  function nytAnlaeg() {
    if (state.master.length > 0 && !confirm('Start nyt anlæg? Nuværende data slettes (medmindre det er gemt).')) return;
    state = tomtAnlaeg();
    opdaterFormFelter();
    render();
  }

  function naturalSort(a, b) {
    return a.mastId.localeCompare(b.mastId, undefined, { numeric: true, sensitivity: 'base' });
  }

  function tilfoejMast() {
    const mastId = $('ny-mast-id').value.trim() || `S${state.master.length + 1}`;
    state.master.push({
      mastId: mastId,
      mastetype: $('ny-mastetype').value,
      udstyr: [],
      signaler: []
    });
    state.master.sort(naturalSort);
    $('ny-mast-id').value = '';
    render();
  }

  // ==============================
  // ==============================
  // Event handlers
  // ==============================
  function tilkoblEvents() {
    $('anlaeg-nr').addEventListener('input', e => { state.nr = e.target.value; opdaterOutput(); planAutoGem(); });
    $('anlaeg-navn').addEventListener('input', e => { state.navn = e.target.value; opdaterOutput(); planAutoGem(); });

    $('nyt-anlaeg-btn').addEventListener('click', nytAnlaeg);
    $('tilfoej-mast-btn').addEventListener('click', tilfoejMast);

    $('gem-btn').addEventListener('click', gemAnlaeg);
    $('indlaes-btn').addEventListener('click', () => indlaesAnlaeg($('gemte-anlaeg').value));
    $('omdoeb-btn').addEventListener('click', () => omdoebAnlaeg($('gemte-anlaeg').value));
    $('slet-btn') && $('slet-btn').addEventListener('click', () => sletAnlaeg($('gemte-anlaeg').value));

    $('gem-alle-supabase-btn') && $('gem-alle-supabase-btn').addEventListener('click', gemAlleSupabase);
    $('export-json-btn').addEventListener('click', eksporterJson);
    $('export-json-enkelt-btn') && $('export-json-enkelt-btn').addEventListener('click', eksporterJsonEnkelt);
    $('import-json-input').addEventListener('change', e => {
      if (e.target.files[0]) importerJson(e.target.files[0]);
      e.target.value = '';
    });

    // Mast filter
    $('filter-alle-btn') && $('filter-alle-btn').addEventListener('click', () => {
      mastFilter = new Set(state.master.map(m => m.mastId));
      renderMastFilter();
      opdaterOutput();
    });
    $('filter-ingen-btn') && $('filter-ingen-btn').addEventListener('click', () => {
      mastFilter = new Set();
      renderMastFilter();
      opdaterOutput();
    });

    // Toggle output
    $('toggle-output-btn').addEventListener('click', () => {
      const indhold = $('output-indhold');
      const controls = $('output-controls');
      const btn = $('toggle-output-btn');
      const skjult = indhold.style.display === 'none';
      indhold.style.display = skjult ? '' : 'none';
      if (controls) controls.style.display = skjult ? '' : 'none';
      btn.textContent = skjult ? '▾' : '▸';
    });

    $('format-vaelger').addEventListener('change', opdaterOutput);
    $('kopier-btn').addEventListener('click', kopierOutput);
    $('download-btn').addEventListener('click', downloadOutput);
    $('download-stykliste-btn').addEventListener('click', downloadStykliste);

    // Event-delegation på mast-liste
    $('master-liste').addEventListener('click', handleMasterKlik);
    $('master-liste').addEventListener('change', handleMasterChange);
  }

  function handleMasterKlik(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (!action) return;

    const mIdx = parseInt(t.dataset.mast);

    if (action === 'rediger-mast') {
      state.master[mIdx]._redigerer = true;
      render();
    } else if (action === 'annuller-mast') {
      delete state.master[mIdx]._redigerer;
      render();
    } else if (action === 'gem-mast') {
      const card = t.closest('.mast-card');
      const idInput = card.querySelector('[data-field="mast-id-edit"]');
      const typeSelect = card.querySelector('[data-field="mastetype-edit"]');
      if (idInput && idInput.value.trim()) state.master[mIdx].mastId = idInput.value.trim();
      if (typeSelect) state.master[mIdx].mastetype = typeSelect.value;
      delete state.master[mIdx]._redigerer;
      state.master.sort(naturalSort);
      render();
    } else if (action === 'toggle-sig-section') {
      const card = t.closest('.mast-card');
      const body = card.querySelector('.sig-section-body');
      const arrow = card.querySelector('.mast-section-toggle[data-action="toggle-sig-section"] .btn-collapse');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
      const mIdx2 = parseInt(t.dataset.mast);
      if (open) openSigSections.delete(mIdx2); else openSigSections.add(mIdx2);
    } else if (action === 'toggle-udstyr-section') {
      const card = t.closest('.mast-card');
      const body = card.querySelector('.udstyr-section-body');
      const arrow = card.querySelector('.mast-section-toggle[data-action="toggle-udstyr-section"] .btn-collapse');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
      const mIdx2 = parseInt(t.dataset.mast);
      if (open) openUdstyrSections.delete(mIdx2); else openUdstyrSections.add(mIdx2);
    } else if (action === 'toggle-mast') {
      const card = t.closest('.mast-card');
      const body = card.querySelector('.mast-body');
      const summary = card.querySelector('.mast-summary');
      const collapsed = card.dataset.collapsed === 'true';
      const mIdx2 = parseInt(t.dataset.mast);
      if (collapsed) {
        body.style.display = '';
        summary.style.display = 'none';
        t.textContent = '▾';
        card.dataset.collapsed = 'false';
        collapsedMaster.delete(mIdx2);
      } else {
        body.style.display = 'none';
        summary.style.display = '';
        t.textContent = '▸';
        card.dataset.collapsed = 'true';
        collapsedMaster.add(mIdx2);
      }
    } else if (action === 'del-mast') {
      if (confirm(`Slet ${state.master[mIdx].mastId} og alle dens signaler?`)) {
        state.master.splice(mIdx, 1);
        // Opdater kollaps-indeks efter sletning
        const nyCollapsed = new Set();
        collapsedMaster.forEach(i => { if (i < mIdx) nyCollapsed.add(i); else if (i > mIdx) nyCollapsed.add(i - 1); });
        collapsedMaster.clear(); nyCollapsed.forEach(i => collapsedMaster.add(i));
        const nySig = new Set();
        openSigSections.forEach(i => { if (i < mIdx) nySig.add(i); else if (i > mIdx) nySig.add(i - 1); });
        openSigSections.clear(); nySig.forEach(i => openSigSections.add(i));
        const nyUdstyr = new Set();
        openUdstyrSections.forEach(i => { if (i < mIdx) nyUdstyr.add(i); else if (i > mIdx) nyUdstyr.add(i - 1); });
        openUdstyrSections.clear(); nyUdstyr.forEach(i => openUdstyrSections.add(i));
        render();
      }
    } else if (action === 'del-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      state.master[mIdx].udstyr.splice(uIdx, 1);
      render();
    } else if (action === 'slet-auto-sig') {
      const sIdx = parseInt(t.dataset.sig);
      const aIdx = parseInt(t.dataset.auto);
      const sig = state.master[mIdx].signaler[sIdx];
      if (!sig._autoOverrides) sig._autoOverrides = {};
      sig._autoOverrides[aIdx] = { _slettet: true };
      render();
    } else if (action === 'slet-auto-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      const aIdx = parseInt(t.dataset.auto);
      const u = state.master[mIdx].udstyr[uIdx];
      if (!u._autoOverrides) u._autoOverrides = {};
      u._autoOverrides[aIdx] = { _slettet: true };
      render();
    } else if (action === 'rediger-auto-sig') {
      const sIdx = parseInt(t.dataset.sig);
      const aIdx = parseInt(t.dataset.auto);
      const sig = state.master[mIdx].signaler[sIdx];
      if (!sig._autoOverrides) sig._autoOverrides = {};
      if (!sig._autoOverrides[aIdx]) sig._autoOverrides[aIdx] = {};
      sig._autoOverrides[aIdx]._redigerer = true;
      render();
    } else if (action === 'annuller-auto-sig') {
      const sIdx = parseInt(t.dataset.sig);
      const aIdx = parseInt(t.dataset.auto);
      const sig = state.master[mIdx].signaler[sIdx];
      if (sig._autoOverrides && sig._autoOverrides[aIdx]) delete sig._autoOverrides[aIdx]._redigerer;
      render();
    } else if (action === 'gem-auto-sig') {
      const sIdx = parseInt(t.dataset.sig);
      const aIdx = parseInt(t.dataset.auto);
      const antalWrap = document.getElementById(`auto-sig-antal-wrap-${mIdx}-${sIdx}-${aIdx}`);
      const varenrWrap = document.getElementById(`auto-sig-varenr-wrap-${mIdx}-${sIdx}-${aIdx}`);
      const antalEl = antalWrap ? antalWrap.querySelector('select') : null;
      const varenrEl = varenrWrap ? (varenrWrap.querySelector('select') || varenrWrap.querySelector('input')) : null;
      const sig = state.master[mIdx].signaler[sIdx];
      if (!sig._autoOverrides) sig._autoOverrides = {};
      sig._autoOverrides[aIdx] = {
        antal: antalEl ? parseFloat(antalEl.value) : undefined,
        varenr: varenrEl && varenrEl.value.trim() ? varenrEl.value.trim() : undefined,
      };
      render();
    } else if (action === 'rediger-auto-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      const aIdx = parseInt(t.dataset.auto);
      const u = state.master[mIdx].udstyr[uIdx];
      if (!u._autoOverrides) u._autoOverrides = {};
      if (!u._autoOverrides[aIdx]) u._autoOverrides[aIdx] = {};
      u._autoOverrides[aIdx]._redigerer = true;
      render();
    } else if (action === 'annuller-auto-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      const aIdx = parseInt(t.dataset.auto);
      const u = state.master[mIdx].udstyr[uIdx];
      if (u._autoOverrides && u._autoOverrides[aIdx]) delete u._autoOverrides[aIdx]._redigerer;
      render();
    } else if (action === 'gem-auto-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      const aIdx = parseInt(t.dataset.auto);
      const antalWrap = document.getElementById(`auto-u-antal-wrap-${mIdx}-${uIdx}-${aIdx}`);
      const varenrWrap = document.getElementById(`auto-u-varenr-wrap-${mIdx}-${uIdx}-${aIdx}`);
      const antalEl = antalWrap ? antalWrap.querySelector('select') : null;
      const varenrEl = varenrWrap ? (varenrWrap.querySelector('select') || varenrWrap.querySelector('input')) : null;
      const u = state.master[mIdx].udstyr[uIdx];
      if (!u._autoOverrides) u._autoOverrides = {};
      u._autoOverrides[aIdx] = {
        antal: antalEl ? parseFloat(antalEl.value) : undefined,
        varenr: varenrEl && varenrEl.value.trim() ? varenrEl.value.trim() : undefined,
      };
      render();
    } else if (action === 'del-signal') {
      const sIdx = parseInt(t.dataset.sig);
      state.master[mIdx].signaler.splice(sIdx, 1);
      render();
    } else if (action === 'rediger-sig') {
      const sIdx = parseInt(t.dataset.sig);
      state.master[mIdx].signaler[sIdx]._redigerer = true;
      render();
    } else if (action === 'annuller-sig') {
      const sIdx = parseInt(t.dataset.sig);
      delete state.master[mIdx].signaler[sIdx]._redigerer;
      render();
    } else if (action === 'gem-sig') {
      const sIdx = parseInt(t.dataset.sig);
      const card = t.closest('.mast-card');
      const sig = state.master[mIdx].signaler[sIdx];
      const kategori = card.querySelector(`[data-rediger-sig="kategori"][data-sig="${sIdx}"]`);
      const type = card.querySelector(`[data-rediger-sig="type"][data-sig="${sIdx}"]`);
      const betegnelse = card.querySelector(`[data-rediger-sig="betegnelse"][data-sig="${sIdx}"]`);
      const hojde = card.querySelector(`[data-rediger-sig="hojde"][data-sig="${sIdx}"]`);
      const note = card.querySelector(`[data-rediger-sig="note"][data-sig="${sIdx}"]`);
      const pilemaskeEl = card.querySelector(`[data-rediger-sig="pilemaske"][data-sig="${sIdx}"]`);
      if (kategori) sig.kategori = kategori.value;
      if (type) {
        sig.type = type.value;
        // Opdater varenr hvis muligt
        for (const kat of SIGNAL_KATEGORIER) {
          const match = kat.typer.find(ty => ty.label === type.value);
          if (match) { sig.varenr = match.varenr; break; }
        }
      }
      if (betegnelse) sig.betegnelse = betegnelse.value.trim();
      if (hojde) sig.hojde = hojde.value;
      if (note) sig.note = note.value.trim();
      if (pilemaskeEl !== null) sig.pilemaske = pilemaskeEl ? pilemaskeEl.checked : false;
      // Nulstil auto-overrides så auto-varer genberegnes
      delete sig._autoOverrides;
      delete sig._redigerer;
      render();
    } else if (action === 'rediger-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      state.master[mIdx].udstyr[uIdx]._redigerer = true;
      render();
    } else if (action === 'annuller-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      delete state.master[mIdx].udstyr[uIdx]._redigerer;
      render();
    } else if (action === 'gem-udstyr') {
      const uIdx = parseInt(t.dataset.udstyr);
      const card = t.closest('.mast-card');
      const u = state.master[mIdx].udstyr[uIdx];
      const varenrEl = card.querySelector(`[data-rediger-u="varenr"][data-udstyr="${uIdx}"]`);
      const antal = card.querySelector(`[data-rediger-u="antal"][data-udstyr="${uIdx}"]`);
      const betegnelse = card.querySelector(`[data-rediger-u="betegnelse"][data-udstyr="${uIdx}"]`);
      if (varenrEl && varenrEl.value) {
        u.varenr = varenrEl.value;
        const vare = findVare(varenrEl.value);
        if (vare) u.type = vare.beskrivelse;
      }
      if (antal) u.antal = parseFloat(antal.value) || 1;
      if (betegnelse) u.betegnelse = betegnelse.value.trim();
      delete u._redigerer;
      render();
    } else if (action === 'add-udstyr') {
      const card = t.closest('.mast-card');
      const varenr = card.querySelector('[data-field="udstyrtype"]').value;
      const betegnelse = card.querySelector('[data-field="udstyrbetegnelse"]').value.trim();
      const antalInput = card.querySelector('[data-field="udstyrantal"]');
      const meterInput = card.querySelector('[data-field="udstyrmeter"]');
      const armSelect = card.querySelector('[data-field="udstyrarm"]');
      const erKabel = KABEL_VARENUMRE.includes(varenr);
      const rawAntal = erKabel
        ? (meterInput && meterInput.value ? parseFloat(meterInput.value) : 1)
        : (antalInput && antalInput.value ? parseFloat(antalInput.value) : 1);
      const klistermEl = card.querySelector('[data-field="udstyrklistermaerke"]');
      const forlængerArm = armSelect ? armSelect.value === 'ja' : false;
      const klistermaerke = klistermEl ? klistermEl.checked : false;
      if (!varenr) { visBesked('Vælg en vare først', 'danger'); return; }
      const vare = findVare(varenr);
      const gemAntal = isNaN(rawAntal) || rawAntal < 0.5 ? 1 : rawAntal;
      const underkategoriEl = card.querySelector('[data-field="udstyrunderkategori"]');
      const underkategori = underkategoriEl ? underkategoriEl.value : '';
      state.master[mIdx].udstyr.push({ varenr, type: vare ? vare.beskrivelse : varenr, betegnelse, antal: gemAntal, forlængerArm, klistermaerke, underkategori });
      card.querySelector('[data-field="udstyrbetegnelse"]').value = '';
      if (meterInput) meterInput.value = '';
      if (antalInput) antalInput.value = '1';
      if (armSelect) armSelect.value = 'nej';
      if (klistermEl) klistermEl.checked = false;
      render();
    } else if (action === 'add-signal') {
      const card = t.closest('.mast-card');
      const kategori = card.querySelector('[data-field="signalkategori"]').value;
      const type = card.querySelector('[data-field="signaltype"]').value;
      const betegnelse = card.querySelector('[data-field="betegnelse"]').value.trim();
      const hojde = card.querySelector('[data-field="ny-hojde"]').value;
      const note = card.querySelector('[data-field="note"]').value.trim();
      const pilemaskeEl = card.querySelector('[data-field="pilemaske"]');
      const pilemaske = pilemaskeEl ? pilemaskeEl.checked : false;
      // Find varenr fra SIGNAL_KATEGORIER
      let varenr = '';
      for (const kat of SIGNAL_KATEGORIER) {
        const match = kat.typer.find(ty => ty.label === type);
        if (match) { varenr = match.varenr; break; }
      }
      state.master[mIdx].signaler.push({ type, varenr, kategori, betegnelse, hojde, note, pilemaske });
      card.querySelector('[data-field="betegnelse"]').value = '';
      card.querySelector('[data-field="note"]').value = '';
      if (pilemaskeEl) pilemaskeEl.checked = false;
      render();
    }
  }

  function handleMasterChange(e) {
    const t = e.target;
    if (t.dataset.field === 'mastetype') {
      const mIdx = parseInt(t.dataset.mast);
      state.master[mIdx].mastetype = t.value;
      opdaterOutput();
    } else if (t.dataset.field === 'signalkategori') {
      const card = t.closest('.mast-card');
      const mIdx = parseInt(t.dataset.mast);
      const typeSelect = card.querySelector('[data-field="signaltype"]');
      const valgtKategori = t.value;
      const kategori = SIGNAL_KATEGORIER.find(k => k.kategori === valgtKategori);
      if (kategori) {
        typeSelect.innerHTML = kategori.typer
          .map(ty => `<option value="${escapeHtml(ty.label)}">${escapeHtml(visNavn(ty))}</option>`)
          .join('');
        typeSelect.disabled = false;
      } else {
        typeSelect.innerHTML = '<option value="">— Vælg kategori først —</option>';
        typeSelect.disabled = true;
      }
      // Vis pilemaske kun for Ercolight
      const pilemaskeWrap = card.querySelector(`#pilemaske-wrap-${mIdx}`);
      if (pilemaskeWrap) {
        const erErcolight = valgtKategori.includes('Ercolight');
        pilemaskeWrap.style.display = erErcolight ? '' : 'none';
        if (!erErcolight) {
          const cb = pilemaskeWrap.querySelector('input[type="checkbox"]');
          if (cb) cb.checked = false;
        }
      }
    } else if (t.dataset.redigersig === 'kategori' || t.getAttribute('data-rediger-sig') === 'kategori') {
      // Live opdatering af type-dropdown i redigér-form
      const card = t.closest('.mast-card');
      const sIdx = parseInt(t.dataset.sig);
      const typeSelect = card.querySelector(`[data-rediger-sig="type"][data-sig="${sIdx}"]`);
      const valgtKategori = t.value;
      const kategori = SIGNAL_KATEGORIER.find(k => k.kategori === valgtKategori);
      if (typeSelect && kategori) {
        typeSelect.innerHTML = kategori.typer
          .map(ty => `<option value="${escapeHtml(ty.label)}">${escapeHtml(visNavn(ty))}</option>`)
          .join('');
      }
    } else if (t.getAttribute('data-rediger-u') === 'kategori') {
      const card = t.closest('.mast-card');
      const uIdx = parseInt(t.dataset.udstyr);
      const vareSelect = card.querySelector(`[data-rediger-u="varenr"][data-udstyr="${uIdx}"]`);
      const valgtKat = t.value;
      const kat = UDSTYR_MENU.find(k => k.kategori === valgtKat);
      if (vareSelect && kat) {
        const alleVarer = kat.underkategorier
          ? kat.underkategorier.flatMap(u => u.varer)
          : (kat.varer || []);
        vareSelect.innerHTML = alleVarer
          .filter(v => !v.varenr.startsWith('INTERN-'))
          .map(v => `<option value="${escapeHtml(v.varenr)}">${escapeHtml(visNavn(v))}</option>`)
          .join('');
      }
    } else if (t.dataset.field === 'udstyrtype') {
      const card = t.closest('.mast-card');
      const mIdx = parseInt(t.dataset.mast);
      const armWrap = card.querySelector(`#udstyr-arm-wrap-${mIdx}`);
      const meterWrap = card.querySelector(`#udstyr-meter-wrap-${mIdx}`);
      const antalWrap = card.querySelector(`#udstyr-antal-wrap-${mIdx}`);
      const erRadar = RADAR_VARENUMRE.includes(t.value);
      const erKabel = KABEL_VARENUMRE.includes(t.value);
      if (armWrap) armWrap.style.display = erRadar ? '' : 'none';
      if (meterWrap) meterWrap.style.display = erKabel ? '' : 'none';
      if (antalWrap) antalWrap.style.display = erKabel ? 'none' : '';
    } else if (t.dataset.field === 'udstyrkategori') {
      const card = t.closest('.mast-card');
      const mIdx = parseInt(t.dataset.mast);
      const vareSelect = card.querySelector('[data-field="udstyrtype"]');
      const underWrap = card.querySelector(`#udstyr-under-wrap-${mIdx}`);
      const underSelect = card.querySelector('[data-field="udstyrunderkategori"]');
      const valgtKat = t.value;
      const kat = UDSTYR_MENU.find(k => k.kategori === valgtKat);

      if (kat && kat.underkategorier) {
        // Vis underkategori-dropdown
        underWrap.style.display = '';
        underSelect.innerHTML = '<option value="">— Vælg underkategori —</option>' +
          kat.underkategorier.map(u => `<option value="${escapeHtml(u.navn)}">${escapeHtml(u.navn)}</option>`).join('');
        underSelect.disabled = false;
        vareSelect.innerHTML = '<option value="">— Vælg underkategori først —</option>';
        vareSelect.disabled = true;
      } else if (kat && kat.varer) {
        // Direkte til varer
        underWrap.style.display = 'none';
        underSelect.disabled = true;
        vareSelect.innerHTML = kat.varer
          .map(v => `<option value="${escapeHtml(v.varenr)}">${escapeHtml(visNavn(v))}</option>`)
          .join('');
        vareSelect.disabled = false;
        // Vis meter-felt hvis kabel, ellers antal-felt
        const meterWrap = card.querySelector(`#udstyr-meter-wrap-${mIdx}`);
        const antalWrap = card.querySelector(`#udstyr-antal-wrap-${mIdx}`);
        const armWrap = card.querySelector(`#udstyr-arm-wrap-${mIdx}`);
        const erKabel = kat.varer.some(v => KABEL_VARENUMRE.includes(v.varenr));
        const erRadar = kat.varer.some(v => RADAR_VARENUMRE.includes(v.varenr));
        if (meterWrap) meterWrap.style.display = erKabel ? '' : 'none';
        if (antalWrap) antalWrap.style.display = erKabel ? 'none' : '';
        if (armWrap) armWrap.style.display = erRadar ? '' : 'none';
      } else {
        underWrap.style.display = 'none';
        vareSelect.innerHTML = '<option value="">— Vælg kategori først —</option>';
        vareSelect.disabled = true;
      }
    } else if (t.dataset.field === 'udstyrunderkategori') {
      const card = t.closest('.mast-card');
      const vareSelect = card.querySelector('[data-field="udstyrtype"]');
      const katSelect = card.querySelector('[data-field="udstyrkategori"]');
      const valgtKat = katSelect.value;
      const valgtUnder = t.value;
      const kat = UDSTYR_MENU.find(k => k.kategori === valgtKat);
      const under = kat && kat.underkategorier ? kat.underkategorier.find(u => u.navn === valgtUnder) : null;
      if (under && under.varer.length > 0) {
        vareSelect.innerHTML = under.varer
          .map(v => `<option value="${escapeHtml(v.varenr)}">${escapeHtml(visNavn(v))}</option>`)
          .join('');
        vareSelect.disabled = false;
        const mIdx2 = parseInt(t.dataset.mast);
        const meterWrap2 = card.querySelector(`#udstyr-meter-wrap-${mIdx2}`);
        const antalWrap2 = card.querySelector(`#udstyr-antal-wrap-${mIdx2}`);
        const armWrap2 = card.querySelector(`#udstyr-arm-wrap-${mIdx2}`);
        const klistermWrap2 = card.querySelector(`#udstyr-klisterm-wrap-${mIdx2}`);
        const erKabel2 = under.varer.length > 0 && KABEL_VARENUMRE.includes(under.varer[0].varenr);
        const erRadar2 = under.varer.some(v => RADAR_VARENUMRE.includes(v.varenr));
        const erFodgTryk = valgtUnder === 'Prisma' || valgtUnder === 'RTB';
        if (meterWrap2) meterWrap2.style.display = erKabel2 ? '' : 'none';
        if (antalWrap2) antalWrap2.style.display = erKabel2 ? 'none' : '';
        if (armWrap2) armWrap2.style.display = erRadar2 ? '' : 'none';
        if (klistermWrap2) {
          klistermWrap2.style.display = erFodgTryk ? '' : 'none';
          if (!erFodgTryk) { const cb = klistermWrap2.querySelector('input'); if (cb) cb.checked = false; }
        }
      } else {
        vareSelect.innerHTML = '<option value="">— Ingen varer endnu —</option>';
        vareSelect.disabled = true;
      }
    }
  }

  function kopierOutput() {
    const text = $('output').value;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => visBesked('✓ Kopieret til udklipsholder'))
        .catch(() => {
          $('output').select();
          document.execCommand('copy');
          visBesked('✓ Kopieret');
        });
    } else {
      $('output').select();
      document.execCommand('copy');
      visBesked('✓ Kopieret');
    }
  }

  function generateStyklisteTekst() {
    const dato = new Date().toISOString().slice(0, 10);
    const nummer = fullTegningsnr();
    const titel = nummer
      ? `STYKLISTE – ANLÆG ${nummer}${state.navn ? ' – ' + state.navn : ''}`
      : `STYKLISTE – ${state.navn || 'ANLÆG'}`;

    const pad = (s, n) => String(s).padEnd(n).substring(0, n);
    const COL1 = 18, COL2 = 36, COL3 = 10;
    const topLine = '┌' + '─'.repeat(COL1+2) + '┬' + '─'.repeat(COL2+2) + '┬' + '─'.repeat(COL3+2) + '┐';
    const midLine = '├' + '─'.repeat(COL1+2) + '┼' + '─'.repeat(COL2+2) + '┼' + '─'.repeat(COL3+2) + '┤';
    const botLine = '└' + '─'.repeat(COL1+2) + '┴' + '─'.repeat(COL2+2) + '┴' + '─'.repeat(COL3+2) + '┘';
    const row = (a, b, c) => `│ ${pad(a,COL1)} │ ${pad(b,COL2)} │ ${pad(c,COL3)} │`;

    let t = titel + '\n' + '='.repeat(titel.length) + '\n';
    t += `Dato: ${dato}   Master: ${state.master.length}\n\n`;

    // Samlet total
    const total = {};
    state.master.forEach(mast => {
      Object.entries(beregnStyklistePrMast(mast)).forEach(([varenr, antal]) => {
        total[varenr] = (total[varenr] || 0) + antal;
      });
    });

    if (Object.keys(total).length === 0) { t += 'Ingen varer.\n'; return t; }

    // DEL 1: Kategorier med varer
    VAREKATALOG.forEach(kat => {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      const varer = alleVarer.filter(v => total[v.varenr]);
      if (varer.length === 0) return;
      t += `${kat.kategori}:\n`;
      varer.forEach(v => {
        const erKabel = KABEL_VARENUMRE.includes(v.varenr);
        const antalVis = erKabel ? total[v.varenr] + ' m' : total[v.varenr] + ' stk.';
        const vn = visVarenr(v.varenr) || '—';
        t += `  ${vn.padEnd(18)} ${v.beskrivelse} (${antalVis})\n`;
      });
      t += '\n';
    });

    // DEL 2: Samlet tabel
    t += '='.repeat(COL1+COL2+COL3+10) + '\n';
    t += 'SAMLET OVERSIGT\n';
    t += '='.repeat(COL1+COL2+COL3+10) + '\n';
    t += topLine + '\n';
    t += row('Varenr.', 'Beskrivelse', 'Antal') + '\n';
    t += midLine + '\n';
    VAREKATALOG.forEach(kat => {
      const alleVarer = kat.underkategorier
        ? kat.underkategorier.flatMap(u => u.varer)
        : (kat.varer || []);
      const varer = alleVarer.filter(v => total[v.varenr]);
      varer.forEach(v => {
        const erKabel = KABEL_VARENUMRE.includes(v.varenr);
        const antalVis = erKabel ? total[v.varenr] + ' m' : total[v.varenr] + ' stk.';
        t += row(visVarenr(v.varenr) || '—', v.beskrivelse, antalVis) + '\n';
      });
    });
    t += botLine + '\n';

    return t;
  }

  function downloadStykliste() {
    const format = $('stykliste-format').value;
    const tekst = format === 'txt' ? generateStyklisteTekst() : generateStyklisteMarkdown();
    const nummer = fullTegningsnr() || state.navn.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_') || 'anlaeg';
    const filnavn = `${nummer}-stykliste.${format}`;
    const mimeType = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
    const blob = new Blob([tekst], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filnavn;
    a.click();
    URL.revokeObjectURL(url);
    visBesked(`✓ ${filnavn} downloadet`);
  }

  function downloadOutput() {
    const format = $('format-vaelger').value;
    const text = $('output').value;
    const nummer = fullTegningsnr() || state.navn.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, '_') || 'anlaeg';
    const filnavn = `${nummer}.${format}`;
    const mimeType = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filnavn;
    a.click();
    URL.revokeObjectURL(url);
    visBesked(`✓ ${filnavn} downloadet`);
  }

  // ==============================
  // Init
  // ==============================
  // ==============================
  // Supabase Integration
  // ==============================
  const { createClient } = supabase;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  let aktivBruger = null;
  let aktivProfil = null;
  let erAdmin = false;

  async function tjekLogin() {
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      window.location.href = 'login.html';
      return false;
    }
    aktivBruger = data.session.user;
    // Hent profil
    const { data: profil } = await sb.from('profiler').select('*').eq('id', aktivBruger.id).single();
    aktivProfil = profil;
    erAdmin = profil && profil.rolle === 'admin';
    // Vis navn i header
    const navnEl = document.getElementById('bruger-navn');
    if (navnEl && profil) navnEl.textContent = profil.navn;
    // Skjul admin-funktioner for ikke-admins
    if (profil && profil.rolle !== 'admin') {
      const sletBtn = document.getElementById('slet-btn');
      if (sletBtn) sletBtn.style.display = 'none';
      const omdoebBtn = document.getElementById('omdoeb-btn');
      if (omdoebBtn) omdoebBtn.style.display = 'none';
      const omdoebContainer = document.getElementById('omdoeb-container');
      if (omdoebContainer) omdoebContainer.style.display = 'none';
    }
    return true;
  }

  async function gemAlleSupabase() {
    const noegler = gemteNoegler();
    if (noegler.length === 0) { visBesked('Ingen lokale anlæg at gemme', 'danger'); return; }
    visBesked(`Gemmer ${noegler.length} anlæg til sky...`);
    let ok = 0;
    for (const key of noegler) {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        await supabaseGemAnlaeg(key, data);
        ok++;
      } catch (e) { console.warn('Fejl ved gem af', key, e); }
    }
    visBesked(`✓ ${ok} af ${noegler.length} anlæg gemt til sky`);
  }

  async function supabaseGemAnlaeg(key, data) {
    if (!aktivBruger) return;
    const nr = data.nr || key.replace(STORAGE_PREFIX, '');
    const { error } = await sb.from('anlaeg').upsert({
      nr: nr,
      navn: data.navn || '',
      data: data,
      oprettet_af: aktivBruger.id,
      opdateret_af: aktivBruger.id
    }, { onConflict: 'nr' });
    if (error) console.warn('Supabase gem fejl:', error);
  }

  async function supabaseHentAlle() {
    const { data, error } = await sb.from('anlaeg').select('nr, navn, data').order('nr');
    if (error || !data) return;
    data.forEach(row => {
      const key = STORAGE_PREFIX + row.nr;
      localStorage.setItem(key, JSON.stringify(row.data));
    });
    opdaterGemtListe();
  }

  async function supabaseSletAnlaeg(nr) {
    if (!aktivBruger) return;
    await sb.from('anlaeg').delete().eq('nr', nr);
  }

  function init() {
    tilkoblEvents();
    opdaterFormFelter();

    // Log ud knap
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.href = 'login.html';
    });

    // Vis loading
    const main = document.querySelector('.app-main');
    if (main) main.style.opacity = '0.3';

    // Login check → indlæs katalog → render → hent anlæg
    tjekLogin().then(async loggetInd => {
      if (!loggetInd) return;
      await indlaesKatalogFraSupabase(sb);
      // Opdater mastetype dropdown i HTML
      opdaterMasteDropdowns();
      console.log('MG[1] typer:', JSON.stringify(MASTETYPER_GRUPPER[1]?.typer?.slice(0,3)));
      // Nu er katalog klar — render og hent anlæg
      if (main) main.style.opacity = '1';
      opdaterGemtListe();
      render();
      await supabaseHentAlle();
    });
  }

  function opdaterMasteDropdowns() {
    const sel = $('ny-mastetype');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Vælg mastetype —</option>';
    MASTETYPER_GRUPPER.forEach(grp => {
      const og = document.createElement('optgroup');
      og.label = grp.gruppe;
      grp.typer.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.label;
        opt.textContent = visNavn(t) || t.label;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    });
    if (current) sel.value = current;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
