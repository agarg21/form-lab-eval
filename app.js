const app = document.querySelector('#app');
let data, key, runIndex = 0, filter = 'all', query = '', mediaURL, generation = 0;
const labels = {matched:'Matches reference',partial:'Partial · overclaim',mismatch:'Misses reference',invalid:'Invalid response',needs_review:'Needs review',not_run:'Not run',matched_positive:'Matched positive',matched_cue:'Matched cue',matched_abstention:'Appropriate abstention',missed_cue:'Missed cue',missed_positive:'Missed positive',reference_needed:'Reference uncertain',review_needed:'Semantic review needed',unsupported_concern:'Unsupported concern',unsupported_claim:'Unsupported claim',invalid_response:'Rejected response',missing_check:'Missing instruction',different_advice:'Different advice'};
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = (s) => s.replaceAll('_',' ');
const badge = (s) => `<span class="badge ${escapeHTML(s)}">${escapeHTML(labels[s] ?? pretty(s))}</span>`;
const getRun = () => data.runs[runIndex];
async function decrypt(path) {
  const r=await fetch(path); if(!r.ok) throw Error('Review file unavailable.');
  const b=new Uint8Array(await r.arrayBuffer());
  return crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12));
}
async function unlock(value) {
  const status=document.querySelector('#status');
  try {
    status.textContent='Opening workspace…';
    const encoded=value.includes('#key=')?value.split('#key=')[1]:value;
    if(!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw Error('Invalid key');
    const bytes=Uint8Array.from(atob(encoded.replaceAll('-','+').replaceAll('_','/')+'='),c=>c.charCodeAt(0));
    key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']);
    data=JSON.parse(new TextDecoder().decode(await decrypt('review.bin')));
    showOverview();
  } catch { status.textContent='Could not open reviews. Check the review link or key, then try again.'; }
}
document.querySelector('#unlock').addEventListener('submit',e=>{e.preventDefault();void unlock(document.querySelector('#key').value.trim());});
const initial=new URLSearchParams(location.hash.slice(1)).get('key'); if(initial) void unlock(initial);
window.addEventListener('hashchange',()=>{const value=new URLSearchParams(location.hash.slice(1)).get('key');if(value&&!data)void unlock(value);});
function cleanup(){generation++; if(mediaURL)URL.revokeObjectURL(mediaURL);mediaURL=null;}
function showOverview(){
  cleanup(); const run=getRun(),s=run.summary;
  app.innerHTML=`<section class="intro"><p class="eyebrow">Lunges & split squats / ${run.results.length} clips</p><h1>Does the feedback match?</h1><p>Compare the coach’s response with our agreed instructions. Open a clip to see the evidence and why we graded it that way.</p></section>
  <div class="toolbar"><div><label for="run">Evaluation run</label><select id="run">${data.runs.map((r,i)=>`<option value="${i}" ${i===runIndex?'selected':''}>${escapeHTML(r.label)}</option>`).join('')}</select></div><div><label for="filter">Results</label><select id="filter"><option value="all">All clips</option><option value="attention">Needs attention</option>${Object.keys(s).filter(k=>labels[k]).map(k=>`<option value="${k}">${labels[k]}</option>`).join('')}</select></div><div><label for="search">Find a clip</label><input id="search" type="search" placeholder="Stance, heel, torso…" value="${escapeHTML(query)}"></div></div>
  <div class="metrics"><div class="metric"><strong>${s.matched}</strong><span>Match selected instructions</span></div><div class="metric"><strong>${s.partial}</strong><span>Partial / overclaim</span></div><div class="metric"><strong>${s.mismatch+s.invalid}</strong><span>Missed / invalid</span></div><div class="metric"><strong>${s.needs_review}</strong><span>Need review</span></div><div class="metric"><strong>${s.not_run}</strong><span>Not run</span></div></div>
  <p class="summary-note">${escapeHTML(run.description)}<br>Run: ${escapeHTML(new Date(run.id).toLocaleString())}. ${escapeHTML(run.costNote ?? '')}</p>
  <div class="notice">Development set, not validated accuracy. The references are assisted reviews; 10 clips still contain answer graphics. “Match” covers selected instructions, not a whole-video pass. ${escapeHTML(run.mode==='fresh_inference'?'Changed responses need a new semantic audit before receiving a match.':'')}</div>
  <div class="section-title"><h2>Clips</h2><span id="count" class="quiet"></span></div><div class="list"><div class="list-head"><span>Clip / source</span><span>Coaching point</span><span>Camera</span><span>Result</span></div><div id="rows"></div></div>
  <details class="raw"><summary>How grading works</summary><p>We check the selected instruction, not the creator’s overall good/bad label. A compatible output status alone never earns a semantic match. Saved semantic audits are bound to the exact response and reference hashes. Changed answers remain pending review. Unsupported claims can turn a match into a partial result. An uncertain reference is unscored.</p><p>${escapeHTML(run.referenceNote)}</p><p>The forward-lean example uses your adopted reference. The walking-lunge example is excluded because it is a different variation. Rep counts below are current rule outputs from cached pose detections, not manual counts or fresh pose inference.</p><p>These audits are assistant-assisted, not independent expert assessments. Additional unlabelled claims in the full response are not automatically verified.</p><pre>${escapeHTML(JSON.stringify(s.instructionCounts,null,2))}</pre></details>
  <details class="raw new-run"><summary>Run again / add a result</summary><p>Run locally in the app repository. No API key or model calls run in this website.</p><pre>npm run eval:coaching\n\n# Fresh video inference, up to $9 reserved for 15 requests:\nnpm run eval:coaching -- --infer --budget-usd 9\n\n# One clip:\nnpm run eval:coaching -- --infer --case panel-03 --budget-usd 0.6</pre><label for="import">Inspect an exported report.json locally</label><input type="file" id="import" accept="application/json"><p id="import-status" role="status"></p><p>No upload occurs. Importing results does not publish them.</p></details>`;
  document.querySelector('#run').onchange=e=>{runIndex=Number(e.target.value);showOverview();};
  const f=document.querySelector('#filter');f.value=filter;f.onchange=e=>{filter=e.target.value;renderRows();};
  document.querySelector('#search').oninput=e=>{query=e.target.value;renderRows();};
  document.querySelector('#import').onchange=async e=>{
    try{const r=JSON.parse(await e.target.files[0].text());if(r.version!==1||!Array.isArray(r.results)||!r.summary||!r.results.every(c=>c.reference&&c.grade&&c.response&&c.pose))throw Error();
    r.label=`Imported · ${r.route} · ${r.id}`;r.results.forEach(c=>{const known=data.runs[0].results.find(x=>x.id===c.id&&x.reference.videoSHA256===c.reference.videoSHA256);c.media=known?.media;});data.runs.push(r);runIndex=data.runs.length-1;showOverview();}
    catch{document.querySelector('#import-status').textContent='Could not read this report. Use an export from the evaluation runner.';}
  };renderRows();
}
function renderRows(){
  const rows=getRun().results.filter(c=>(filter==='all'||(filter==='attention'?c.grade.verdict!=='matched':c.grade.verdict===filter))&&`${c.id} ${c.reference.title} ${c.reference.view} ${c.reference.expectations.map(e=>e.feedback).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  document.querySelector('#count').textContent=`${rows.length} of ${getRun().results.length}`;
  document.querySelector('#rows').innerHTML=rows.length?rows.map(c=>`<button class="case-row" data-id="${escapeHTML(c.id)}"><span class="case-id">${escapeHTML(c.id)}<small>${escapeHTML(c.reference.group)}</small></span><span class="title">${escapeHTML(c.reference.title)}<small>${escapeHTML(pretty(c.reference.expectations[0].expected))}</small></span><span class="view">${escapeHTML(c.reference.view)} view<small>${c.pose.complete} full · ${c.pose.partial} partial candidates</small></span><span class="result">${badge(c.grade.verdict)}</span></button>`).join(''):'<p class="empty">No clips match these filters.</p>';
  document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>showCase(b.dataset.id));
}
function timeButton(start,end,label='Evidence'){return `<button class="time" data-time="${Number(start)}">${escapeHTML(label)} · ${Number(start).toFixed(1)}–${Number(end).toFixed(1)}s</button>`;}
async function showCase(id){
  cleanup();const token=generation,c=getRun().results.find(c=>c.id===id),r=c.reference;
  app.innerHTML=`<div class="detail-top"><button id="back" class="back">← All clips</button>${badge(c.grade.verdict)}</div><p class="eyebrow">${escapeHTML(c.id)} / ${escapeHTML(getRun().label)}</p><h1>${escapeHTML(r.title)}</h1>
  <div class="detail-grid"><aside class="video-card"><video id="video" controls playsinline preload="metadata"></video><div id="video-status" role="status" class="video-info">Opening clip…</div><div class="video-info"><a href="${escapeHTML(r.sourceURL)}" target="_blank" rel="noopener noreferrer">Original source ↗</a><dl><dt>Camera</dt><dd>${escapeHTML(r.view)} view</dd><dt>Source interval</dt><dd>${r.sourceInterval.map(n=>Number(n).toFixed(2)).join('–')}s</dd><dt>Creator label</dt><dd>${escapeHTML(pretty(r.creatorLabel))}</dd><dt>Reference</dt><dd>${escapeHTML(pretty(r.referenceQuality))}</dd><dt>Current tracker</dt><dd>${c.pose.complete} full + ${c.pose.partial} partial candidates</dd></dl><p class="scope">${escapeHTML(r.referenceAuthority)} ${r.answerOverlays?'Answer graphics remain: this is not a blind test.':''}</p></div></aside><section>
  ${c.grade.checks.map(q=>`<article class="check"><div class="check-head"><h3>${escapeHTML(pretty(q.id))}</h3>${badge(q.grade)}</div><p class="label">Expected · ${escapeHTML(pretty(q.expected))}</p><p>${escapeHTML(q.feedback)}</p>${q.windows.map(([a,b])=>timeButton(a,b,'Reference')).join('')}<p class="label">Actual · ${escapeHTML(q.actual?.status??'no accepted check')}</p><p>${escapeHTML(q.actual?.observation||q.actual?.missingEvidence||c.response.error||'No response for this check.')}</p>${q.actual?.suggestion?`<p><strong>Cue:</strong> ${escapeHTML(q.actual.suggestion)}</p>`:''}${(q.actual?.events??q.actual?.evidence??[]).filter(e=>Number.isFinite(e.start)&&Number.isFinite(e.end)).map(e=>timeButton(e.start,e.end,'Model')).join('')}<p class="label">Why this grade</p><p class="reason">${escapeHTML(q.rationale)}</p></article>`).join('')}
  ${c.grade.unsupportedClaims.length?`<article class="check"><h3>Additional claim to fix</h3>${c.grade.unsupportedClaims.map(s=>`<p>${escapeHTML(s)}</p>`).join('')}</article>`:''}
  ${(c.grade.unreviewedConcerns??[]).length?`<article class="check"><h3>Additional concerns need review</h3><p>These claims have no adjudicated reference yet. They cannot silently receive a passing grade.</p>${c.grade.unreviewedConcerns.map(q=>`<p><strong>${escapeHTML(pretty(q.id))}:</strong> ${escapeHTML(q.observation)}</p><p>${escapeHTML(q.suggestion??'')}</p>`).join('')}</article>`:''}
  <details class="raw"><summary>Full model response</summary><pre>${escapeHTML(JSON.stringify(c.response.proposal??c.response.checks,null,2))}</pre></details>
  <details class="raw"><summary>Reference, constraints & provenance</summary><pre>${escapeHTML(JSON.stringify(r,null,2))}</pre></details>
  <details class="raw"><summary>Tracking, usage & exact model input</summary><pre>${escapeHTML(JSON.stringify({pose:c.pose,model:c.response.model,mode:c.response.mode,usage:c.response.usage,requestSHA256:c.response.requestSHA256,coachingRuntime:c.response.runtimeSHA256,poseRuntimeAtCoaching:c.response.poseRuntimeSHA256,prompt:c.response.prompt},null,2))}</pre></details>
  <p class="scope">${escapeHTML(c.grade.scope)} Timestamp validation checks structure; it does not verify the model’s visual interpretation.</p></section></div>`;
  document.querySelector('#back').onclick=()=>{showOverview();window.scrollTo(0,0);};window.scrollTo(0,0);
  document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{const v=document.querySelector('#video');v.currentTime=Number(b.dataset.time);v.play().catch(()=>{});});
  try{if(!c.media)throw Error();const bytes=await decrypt(c.media);if(token!==generation)return;mediaURL=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));document.querySelector('#video').src=mediaURL;document.querySelector('#video-status').textContent='Cropped clip · timestamps below are relative to this clip.';}
  catch{if(token===generation)document.querySelector('#video-status').textContent='Clip unavailable. Use the original source link or rebuild the media bundle.';}
}
