/* Class Coin Exchange — shared front-end for both SPM 261 sections.
   Reads window.SECTION ("01"/"02"), window.SECTION_LABEL, window.API_BASE. */
(function(){
  "use strict";

  var SECTION = window.SECTION;
  var LABEL   = window.SECTION_LABEL || ("SPM261." + SECTION);
  var API     = window.API_BASE;
  var PW_KEY  = "cce_pw_" + SECTION;
  var LEVERAGE = 10;   // default; the backend sends the live value (Script Property "LEVERAGE") in every response.

  var appEl = document.getElementById("app");
  var state = null;          // {market:{index,history,btc,startPrice}, students:[...]}
  var pw    = null;

  try { pw = sessionStorage.getItem(PW_KEY) || null; } catch(e){}

  /* ---------- helpers (ported from the original) ---------- */
  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmtIndex(n){ return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtPts(n){ return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtUSD(n){ return '$' + Number(n).toLocaleString('en-US',{maximumFractionDigits:0}); }
  function fmtWhen(iso){
    if(!iso) return 'never';
    try{ return new Date(iso + (iso.length===10?'T12:00:00':'')).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
    catch(e){ return ''; }
  }
  function coinBase(coin){ var b = Number(coin && coin.base); return b > 0 ? b : 2; }
  function coinValue(coin,idx){ return Math.max(0, coinBase(coin) * (1 + LEVERAGE * (idx / coin.entryIndex - 1))); }
  function coinDeltaPct(coin,idx){ return LEVERAGE * ((idx - coin.entryIndex) / coin.entryIndex) * 100; }
  function studentHeldValue(st,idx){ return st.coins.reduce(function(s,c){ return s + coinValue(c,idx); },0); }

  function buildChart(history){
    var series = [{date:null,index:100}].concat(history);
    if(series.length < 2){
      return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 800 200" preserveAspectRatio="none">' +
        '<circle cx="400" cy="100" r="6" fill="var(--gold)"></circle></svg></div>' +
        '<div class="chart-empty">Baseline set — the trend line starts building after the first daily close.</div>';
    }
    var W=800,H=200,padL=6,padR=6,padT=16,padB=24;
    var plotW=W-padL-padR, plotH=H-padT-padB;
    var vals=series.map(function(h){return h.index;});
    var vmin=Math.min.apply(null,vals), vmax=Math.max.apply(null,vals);
    if(vmin===vmax){ vmin-=1; vmax+=1; }
    var pd=(vmax-vmin)*0.15; vmin-=pd; vmax+=pd;
    var x=function(i){ return padL + (i/(series.length-1))*plotW; };
    var y=function(v){ return padT + plotH - ((v-vmin)/(vmax-vmin))*plotH; };
    var trendUp = series[series.length-1].index >= series[0].index;
    var lineColor = trendUp ? 'var(--up)' : 'var(--down)';
    var pathD = series.map(function(h,i){ return (i===0?'M':'L')+x(i).toFixed(2)+','+y(h.index).toFixed(2); }).join(' ');
    var areaD = pathD + ' L'+x(series.length-1).toFixed(2)+','+(padT+plotH).toFixed(2) +
      ' L'+x(0).toFixed(2)+','+(padT+plotH).toFixed(2)+' Z';
    var gridLines='', steps=3;
    for(var i=0;i<=steps;i++){
      var v=vmin+(vmax-vmin)*(i/steps), gy=y(v);
      gridLines+='<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+gy.toFixed(2)+'" y2="'+gy.toFixed(2)+'"/>';
      gridLines+='<text x="'+padL+'" y="'+(gy-4).toFixed(2)+'">'+fmtIndex(v)+'</text>';
    }
    var pointDots = series.map(function(h,i){
      if(i===series.length-1) return '';
      return '<circle class="pt" cx="'+x(i).toFixed(2)+'" cy="'+y(h.index).toFixed(2)+'" r="3.5" fill="'+lineColor+'"></circle>';
    }).join('');
    var axisLabels = series.map(function(h,i){
      var label = i===0 ? 'Start' : fmtWhen(h.date);
      var anchor = i===0 ? 'start' : (i===series.length-1 ? 'end' : 'middle');
      return '<text class="axis-label" x="'+x(i).toFixed(2)+'" y="'+(H-6)+'" text-anchor="'+anchor+'">'+label+'</text>';
    }).join('');
    var lastX=x(series.length-1), lastY=y(series[series.length-1].index);
    var lastVal=series[series.length-1].index;
    var approxLen=plotW*1.4;
    var calloutRight = lastX > W*0.7;
    var calloutX = calloutRight ? lastX-8 : lastX+8;
    var calloutAnchor = calloutRight ? 'end' : 'start';
    return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">' +
      '<defs><linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="'+lineColor+'" stop-opacity="0.32"></stop>' +
        '<stop offset="100%" stop-color="'+lineColor+'" stop-opacity="0"></stop>' +
      '</linearGradient></defs>' +
      '<g class="grid">'+gridLines+'</g>' +
      '<path class="area" d="'+areaD+'" fill="url(#chartGrad)"></path>' +
      '<path class="line" d="'+pathD+'" stroke="'+lineColor+'" stroke-dasharray="'+approxLen+'" stroke-dashoffset="'+approxLen+'"></path>' +
      pointDots +
      '<text class="value-callout" x="'+calloutX.toFixed(2)+'" y="'+(lastY-12).toFixed(2)+'" text-anchor="'+calloutAnchor+'" fill="'+lineColor+'">'+fmtIndex(lastVal)+'</text>' +
      '<g class="axis">'+axisLabels+'</g>' +
      '<circle class="endpoint" cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="5" fill="'+lineColor+'"></circle>' +
      '</svg></div>';
  }

  function buildHistoryList(history){
    if(!history.length) return '';
    var items = history.slice(-14).map(function(h){
      var cls = h.pct > 0.005 ? 'up' : (h.pct < -0.005 ? 'down' : '');
      var sign = h.pct > 0 ? '+' : '';
      return '<span class="history-item">'+fmtWhen(h.date)+' <span class="hi-pct '+cls+'">'+sign+(h.pct||0).toFixed(2)+'%</span></span>';
    }).join('');
    return '<div class="history-list">'+items+'</div>';
  }

  function buildCoinHistoryPanel(coin,marketHistory){
    var points = [{date:coin.grantedAt,index:coin.entryIndex}];
    marketHistory.forEach(function(h){ if(h.date > coin.grantedAt) points.push({date:h.date,index:h.index}); });
    var rows = points.map(function(p,i){
      var val = Math.max(0, coinBase(coin) * (1 + LEVERAGE * (p.index/coin.entryIndex - 1)));
      var pct = LEVERAGE * ((p.index - coin.entryIndex)/coin.entryIndex)*100;
      var cls = pct>0.05?'up':(pct<-0.05?'down':'flat');
      var sign = pct>0?'+':'';
      var label = i===0 ? (fmtWhen(p.date)+' (granted)') : fmtWhen(p.date);
      return '<div class="coin-hist-row"><span class="coin-hist-date">'+label+'</span>' +
        '<span class="coin-hist-val num">'+fmtPts(val)+' pts</span>' +
        '<span class="delta-pill '+cls+'">'+sign+pct.toFixed(1)+'%</span></div>';
    }).join('');
    return '<div class="coin-history-panel" hidden>'+rows+'</div>';
  }

  function buildCoinRow(student,coin,idx,marketHistory,writable){
    var val = coinValue(coin,idx), pct = coinDeltaPct(coin,idx);
    var cls = pct>0.05?'up':(pct<-0.05?'down':'flat');
    var sign = pct>0?'+':'';
    return '<div class="coin-row">' +
      '<span class="coin-basis">granted '+fmtWhen(coin.grantedAt)+' &middot; '+fmtPts(coinBase(coin))+' base</span>' +
      '<span class="coin-value num">'+fmtPts(val)+' pts</span>' +
      '<span class="delta-pill '+cls+'">'+sign+pct.toFixed(1)+'%</span>' +
      '<button type="button" class="btn-ghost btn-small coin-hist-btn">History</button>' +
      (writable ? '<button type="button" class="btn-ghost btn-small sell-btn" data-student="'+student.id+'" data-coin="'+coin.id+'">Sell</button>' : '') +
      '</div>' + buildCoinHistoryPanel(coin,marketHistory);
  }

  function buildStudentRow(student,idx,marketHistory,writable){
    var heldVal = studentHeldValue(student,idx);
    var total = student.banked + heldVal;
    var coinsHTML = student.coins.length
      ? student.coins.map(function(c){ return buildCoinRow(student,c,idx,marketHistory,writable); }).join('')
      : '<div class="no-coins">No coins held</div>';
    return '<tr>' +
      '<td class="name-cell">'+escapeHTML(student.name)+'</td>' +
      '<td class="coins-cell">'+coinsHTML +
        (writable ? '<div class="grant-row"><button type="button" class="btn-ghost btn-small grant-btn" data-student="'+student.id+'">+ Grant coin</button></div>' : '') +
      '</td>' +
      '<td class="value-cell num">'+fmtPts(heldVal)+' pts</td>' +
      '<td class="banked-cell num">'+fmtPts(student.banked)+' pts</td>' +
      '<td class="total-cell num">'+fmtPts(total)+' pts</td>' +
      '<td class="row-actions">'+(writable ? '<button type="button" class="btn-danger-text remove-btn" data-student="'+student.id+'">Remove</button>' : '')+'</td>' +
      '</tr>';
  }

  function buildAppHTML(st,writable){
    var market = st.market, students = st.students, history = market.history;
    var closedDate = history.length >= 2 ? history[history.length-2].date : null;
    var overallPct = (market.index - 100);
    var overallCls = overallPct>0.05?'up':(overallPct<-0.05?'down':'flat');

    var rosterBody = students.length
      ? students.map(function(s){ return buildStudentRow(s,market.index,history,writable); }).join('')
      : '';
    var rosterSection = students.length
      ? '<div class="ledger-wrap"><table class="ledger"><thead><tr>' +
          '<th>Student</th><th>Coins held</th><th>Held value</th><th>Banked</th><th>Total</th><th></th>' +
        '</tr></thead><tbody>'+rosterBody+'</tbody></table></div>'
      : '<div class="ledger-wrap"><div class="empty-state"><p>No students yet.</p>' +
          (writable ? '<p>Add your first student below to grant them a coin.</p>' : '') + '</div></div>';

    var banner = writable
      ? '<div class="readonly-banner">Teacher mode — your changes save for everyone. <button type="button" id="signOut">Sign out</button></div>'
      : '<div class="readonly-banner">Live view. <button type="button" id="signIn">Teacher sign in</button></div>';

    return '' +
    '<div class="shell">' +
      banner +
      '<header class="topbar">' +
        '<span class="brand-mark">₿</span>' +
        '<div><span class="course-kicker">'+escapeHTML(LABEL)+'</span><h1>Class Coin Exchange</h1><p class="tagline">Real Bitcoin swings. Real classroom stakes.</p></div>' +
      '</header>' +
      '<section class="market anim-in" aria-label="Market">' +
        '<div class="market-top"><div class="market-index">' +
          '<span class="market-label">Class market index &middot; started at 100</span>' +
          '<div class="market-value-row">' +
            '<span class="market-value num">'+fmtIndex(market.index)+'</span>' +
            '<span class="delta-pill '+overallCls+'">'+(overallPct>0?'+':'')+overallPct.toFixed(1)+'% overall</span>' +
          '</div>' +
          '<span class="btc-line">BTC '+fmtUSD(market.btc)+' &middot; baseline '+fmtUSD(market.startPrice)+'</span>' +
          '<span class="market-updated">'+(closedDate?('Closed through '+fmtWhen(closedDate)+' &middot; '):'')+'today tracks Bitcoin live</span>' +
        '</div></div>' +
        buildChart(history) +
        buildHistoryList(history) +
      '</section>' +
      '<section class="roster" aria-label="Students">' +
        '<div class="roster-head"><h2>Roster</h2>' +
          (writable ? (
          '<form class="add-student" id="addStudentForm">' +
            '<input id="newStudentName" type="text" placeholder="Student name" required>' +
            '<button type="submit" class="btn-primary">Add student</button>' +
          '</form>') : '') +
        '</div>' + rosterSection +
      '</section>' +
      '<p class="foot-note">Each coin starts at the <strong>bonus points you choose</strong> when you grant it (default 2). Its value then swings at <strong>'+LEVERAGE+'&times;</strong> Bitcoin’s move since you got the coin — a 3% BTC day is a '+(3*LEVERAGE)+'% swing on the coin (value never drops below 0). ' +
      'Past days are locked at their close; today tracks Bitcoin live. Sell any time to bank the coin’s current value; hold it and it keeps riding the market.</p>' +
    '</div>';
  }

  /* ---------- data layer ---------- */
  function apiGet(){
    return fetch(API + '?section=' + encodeURIComponent(SECTION) + '&t=' + Date.now(), {method:'GET'})
      .then(function(r){ return r.json(); });
  }
  function apiPost(action,payload){
    return fetch(API, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({section:SECTION, password:pw, action:action, payload:payload||{}})
    }).then(function(r){ return r.json(); });
  }

  function toStateShape(res){
    if(res && Number(res.leverage) > 0) LEVERAGE = Number(res.leverage);
    return {
      market:{ index:res.index, btc:res.btc, startPrice:res.startPrice, history:res.history||[] },
      students:res.students||[]
    };
  }

  /* ---------- render + wire ---------- */
  function render(){
    var writable = !!pw;
    appEl.innerHTML = buildAppHTML(state, writable);
    wire();
  }

  function showToast(msg){
    var ex = document.getElementById('toast'); if(ex) ex.remove();
    var t = document.createElement('div'); t.id='toast'; t.className='toast'; t.textContent=msg;
    document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 3200);
  }

  function signIn(){
    var entered = window.prompt('Teacher password for ' + LABEL + ':');
    if(entered === null) return;
    entered = entered.trim();
    if(!entered) return;
    pw = entered;
    try{ sessionStorage.setItem(PW_KEY, pw); }catch(e){}
    // verify with a no-op action
    apiPost('ping').then(function(res){
      if(res && res.ok){ refresh(); showToast('Signed in.'); }
      else { pw=null; try{sessionStorage.removeItem(PW_KEY);}catch(e){} showToast('Wrong password.'); render(); }
    }).catch(function(){ showToast('Could not reach the server.'); });
  }
  function signOut(){
    pw = null; try{ sessionStorage.removeItem(PW_KEY); }catch(e){}
    render(); showToast('Signed out.');
  }

  function doAction(action,payload){
    apiPost(action,payload).then(function(res){
      if(res && res.ok){ state = toStateShape(res); render(); }
      else if(res && res.error === 'not_authorized'){
        pw=null; try{sessionStorage.removeItem(PW_KEY);}catch(e){}
        showToast('Session expired — sign in again.'); render();
      } else {
        showToast('Could not save: ' + ((res && res.error) || 'unknown error'));
      }
    }).catch(function(){ showToast('Could not reach the server.'); });
  }

  function wire(){
    var si = document.getElementById('signIn'); if(si) si.addEventListener('click', signIn);
    var so = document.getElementById('signOut'); if(so) so.addEventListener('click', signOut);

    var addForm = document.getElementById('addStudentForm');
    if(addForm) addForm.addEventListener('submit', function(e){
      e.preventDefault();
      var input = document.getElementById('newStudentName');
      var name = input.value.trim();
      if(!name) return;
      input.value='';
      doAction('addStudent', {name:name});
    });

    document.querySelectorAll('.coin-hist-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var panel = btn.closest('.coin-row').nextElementSibling;
        if(!panel || !panel.classList.contains('coin-history-panel')) return;
        var open = !panel.hidden;
        panel.hidden = open;
        btn.textContent = open ? 'History' : 'Hide history';
      });
    });

    document.querySelectorAll('.grant-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var raw = window.prompt('Bonus points for this coin (its starting value before the market moves it):', '2');
        if(raw === null) return;
        var pts = parseFloat(String(raw).trim());
        if(!(pts > 0)){ showToast('Enter a positive number of points.'); return; }
        if(pts > 1000){ showToast('That is above the 1000-point cap.'); return; }
        doAction('grantCoin', {studentId:btn.getAttribute('data-student'), points:pts});
      });
    });

    document.querySelectorAll('.sell-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        doAction('sell', {studentId:btn.getAttribute('data-student'), coinId:btn.getAttribute('data-coin')});
      });
    });

    document.querySelectorAll('.remove-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(!btn.classList.contains('confirming')){
          btn.classList.add('confirming'); btn.textContent='Click again to remove';
          btn._t = setTimeout(function(){ btn.classList.remove('confirming'); btn.textContent='Remove'; }, 3500);
          return;
        }
        clearTimeout(btn._t);
        doAction('removeStudent', {studentId:btn.getAttribute('data-student')});
      });
    });
  }

  function refresh(){
    return apiGet().then(function(res){
      if(res && (res.ok || res.index !== undefined)){ state = toStateShape(res); render(); }
      else { appEl.innerHTML = '<div class="shell"><div class="err-banner">Could not load the exchange: ' + ((res&&res.error)||'unknown') + '</div></div>'; }
    }).catch(function(){
      appEl.innerHTML = '<div class="shell"><div class="err-banner">Could not reach the exchange server. Check the connection and reload.</div></div>';
    });
  }

  /* ---------- boot ---------- */
  if(!API || API.indexOf('PASTE_') === 0){
    appEl.innerHTML = '<div class="shell"><div class="err-banner">Backend URL not set yet. Paste the Apps Script web-app URL into <code>config.js</code>.</div></div>';
    return;
  }
  appEl.innerHTML = '<div class="shell"><div class="loading">Loading the exchange…</div></div>';
  refresh();
})();
