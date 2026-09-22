import {
  ReviewDrafts,
  outcomes,
  validateDecision,
} from './review-drafts.js?v=2';
import { guides } from './exercise-guides.js?v=1';
const app = document.querySelector('#app');
let data,
  key,
  drafts,
  runIndex = 0,
  filter = 'all',
  query = '',
  mediaURL,
  generation = 0;
const labels = {
  matched: 'Matches reference',
  partial: 'Partial · overclaim',
  mismatch: 'Misses reference',
  invalid: 'Invalid response',
  needs_review: 'Needs review',
  not_run: 'Not run',
  matched_positive: 'Matched positive',
  matched_cue: 'Matched cue',
  matched_abstention: 'Appropriate abstention',
  missed_cue: 'Missed cue',
  missed_positive: 'Missed positive',
  reference_needed: 'Reference uncertain',
  review_needed: 'Semantic review needed',
  unsupported_concern: 'Unsupported concern',
  unsupported_claim: 'Unsupported claim',
  invalid_response: 'Rejected response',
  missing_check: 'Missing instruction',
  different_advice: 'Different advice',
};
const escapeHTML = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const pretty = (s) => s.replaceAll('_', ' ');
const badge = (s) =>
  `<span class="badge ${escapeHTML(s)}">${escapeHTML(labels[s] ?? pretty(s))}</span>`;
const checkNames = {
  stance_control: 'Foot placement / stance',
  knee_path: 'Knee movement (inward / outward)',
  rear_heel_control: 'Rear heel during the rep',
};
const checkHelp = {
  stance_control:
    'Review where the feet are placed. Feet on one line belongs here; it can support a setup suggestion without proving a balance problem.',
  knee_path:
    'Review inward or outward knee movement relative to the foot, usually from a front or oblique view. Feet on one line is a stance check. Knees moving forward past toes alone is not an automatic fault.',
  rear_heel_control:
    'For this stationary split-squat variation, review whether the back heel stays raised during the rise as well as the descent.',
};
const getRun = () => data.runs[runIndex];
const taskOf = (run) =>
  run.task ?? { id: 'lunges', name: 'Lunges', title: 'Lunge evaluation' };
function guideHTML() {
  const guide = guides[taskOf(getRun()).id];
  if (!guide) return '';
  return `<details class="raw guide"><summary>${escapeHTML(guide.title)} · quick review guide</summary><ul>${guide.items.map((t) => `<li>${escapeHTML(t)}</li>`).join('')}</ul><p>${escapeHTML(guide.note)}</p><p><strong>Review:</strong> Watch the whole clip, then the flagged moment. Judge the movement, not the source’s red/green graphics. Choose “Cannot assess” if the needed body part is hidden, or “Unsure” if you cannot settle the label.</p><p class="scope">Practical project checklist informed by ${guide.sources.map(([title, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHTML(title)}</a>`).join(' · ')}. These short cues are not a universal technique standard.</p></details>`;
}
function visibleCases() {
  return getRun().results.filter(
    (c) =>
      (filter === 'all' ||
        (filter === 'attention'
          ? c.grade.verdict !== 'matched'
          : c.grade.verdict === filter)) &&
      `${c.id} ${c.reference.title} ${c.reference.view} ${c.reference.expectations.map((e) => e.feedback).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
}

async function decrypt(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw Error('Review file unavailable.');
  const b = new Uint8Array(await r.arrayBuffer());
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b.slice(0, 12) },
    key,
    b.slice(12),
  );
}
async function unlock(value) {
  const status = document.querySelector('#status');
  try {
    status.textContent = 'Opening workspace…';
    const encoded = value.includes('#key=') ? value.split('#key=')[1] : value;
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw Error('Invalid key');
    const bytes = Uint8Array.from(
      atob(encoded.replaceAll('-', '+').replaceAll('_', '/') + '='),
      (c) => c.charCodeAt(0),
    );
    key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
      'decrypt',
      'encrypt',
    ]);
    data = JSON.parse(new TextDecoder().decode(await decrypt('review.bin')));
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    drafts = new ReviewDrafts(
      key,
      `formlab-eval-drafts:${location.pathname}:${fingerprint}`,
    );
    await drafts.load();
    showOverview();
  } catch {
    status.textContent =
      'Could not open reviews. Check the review link or key, then try again.';
  }
}
document.querySelector('#unlock').addEventListener('submit', (e) => {
  e.preventDefault();
  void unlock(document.querySelector('#key').value.trim());
});
const initial = new URLSearchParams(location.hash.slice(1)).get('key');
if (initial) void unlock(initial);
window.addEventListener('hashchange', () => {
  const value = new URLSearchParams(location.hash.slice(1)).get('key');
  if (value && !data) void unlock(value);
});
function cleanup() {
  generation++;
  if (mediaURL) URL.revokeObjectURL(mediaURL);
  mediaURL = null;
}
function showOverview() {
  cleanup();
  const run = getRun(),
    s = run.summary;
  const task = taskOf(run),
    score = s.score ?? { percent: null, graded: 0, pending: s.total };
  app.innerHTML = `<section class="intro"><p class="eyebrow">${escapeHTML(task.name)} / ${run.results.length} clips</p><h1>${escapeHTML(task.title)}</h1><p>Does the coach explain the same positives and corrections as our reference? Review a clip, check the evidence, and save your label.</p></section>
  <nav class="task-tabs" aria-label="Exercise">${[...new Map(data.runs.map((r, i) => [taskOf(r).id, { ...taskOf(r), index: data.runs.findIndex((x) => taskOf(x).id === taskOf(r).id) }])).values()].map((t) => `<button data-task="${t.index}" aria-pressed="${task.id === t.id}">${escapeHTML(t.name)}</button>`).join('')}</nav>
  <div class="toolbar"><div><label for="run">Evaluation run</label><select id="run">${data.runs.map((r, i) => `<option value="${i}" ${i === runIndex ? 'selected' : ''}>${escapeHTML(r.label)}</option>`).join('')}</select></div><div><label for="filter">Results</label><select id="filter"><option value="all">All clips</option><option value="attention">Needs attention</option>${Object.keys(
    s,
  )
    .filter((k) => labels[k])
    .map((k) => `<option value="${k}">${labels[k]}</option>`)
    .join(
      '',
    )}</select></div><div><label for="search">Find a clip</label><input id="search" type="search" placeholder="Stance, heel, torso…" value="${escapeHTML(query)}"></div></div>
  <div class="score"><strong>${s.total ? Math.round((100 * s.matched) / s.total) + '%' : '—'}</strong><div><b>Full matches across all clips</b><p>${s.matched} matched / ${s.total} clips · ${score.pending} pending. Partial and pending results are not counted as successes. This measures the pipeline, not the person’s form.</p></div></div>
  ${
    data.runs.filter(
      (r) =>
        taskOf(r).id === task.id && r.referenceSHA256 === run.referenceSHA256,
    ).length > 1
      ? `<details class="raw comparison"><summary>Compare runs · same clips and labels</summary><div class="comparison-scroll"><table><thead><tr><th>Run</th><th>Full matches</th><th>Partial</th><th>Missed / invalid</th><th>Pending</th></tr></thead><tbody>${data.runs
          .filter(
            (r) =>
              taskOf(r).id === task.id &&
              r.referenceSHA256 === run.referenceSHA256,
          )
          .map(
            (r) =>
              `<tr><td>${escapeHTML(r.label)}</td><td>${r.summary.matched} / ${r.summary.total}</td><td>${r.summary.partial}</td><td>${r.summary.mismatch + r.summary.invalid}</td><td>${r.summary.needs_review + r.summary.not_run}</td></tr>`,
          )
          .join(
            '',
          )}</tbody></table></div><p class="scope">The denominator here includes every clip, including pending reviews. No reference labels changed between these runs. This is development-set agreement, not held-out accuracy.</p></details>`
      : ''
  }
  ${guideHTML()}
  <div class="metrics"><div class="metric"><strong>${s.matched}</strong><span>Match selected instructions</span></div><div class="metric"><strong>${s.partial}</strong><span>Partial / overclaim</span></div><div class="metric"><strong>${s.mismatch + s.invalid}</strong><span>Missed / invalid</span></div><div class="metric"><strong>${s.needs_review}</strong><span>Need review</span></div><div class="metric"><strong>${s.not_run}</strong><span>Not run</span></div></div>
  <p class="summary-note">${escapeHTML(run.description)}<br>Run: ${escapeHTML(new Date(run.id).toLocaleString())}. ${escapeHTML(run.costNote ?? '')}</p>
  <div class="notice">Development set, not validated accuracy. The references are assisted reviews; ${run.results.filter((c) => c.reference.answerOverlays).length} clips still contain answer graphics. “Match” covers selected instructions, not a whole-video pass. ${escapeHTML(run.mode === 'fresh_inference' ? 'Changed responses need a new semantic audit before receiving a match.' : '')}</div>
  <div class="review-export"><span id="draft-count">${drafts.entries.length} saved review decisions</span><button id="export-reviews" ${drafts.entries.length ? '' : 'disabled'}>Export reviews for me</button><p class="scope">Reviews save in this browser. Export and send me the file to update shared labels and rerun grading. Published scores stay unchanged until then.</p></div>
  <div class="section-title"><h2>Clips</h2><span id="count" class="quiet"></span></div><div class="list"><div class="list-head"><span>Clip / source</span><span>Coaching point</span><span>Camera</span><span>Result</span></div><div id="rows"></div></div>
  <details class="raw"><summary>How grading works</summary><p>We check the selected instruction, not the creator’s overall good/bad label. A compatible output status alone never earns a semantic match. Saved semantic audits are bound to the exact response and reference hashes. Changed answers remain pending review. Unsupported claims can turn a match into a partial result. An uncertain reference is unscored.</p><p>${escapeHTML(run.referenceNote)}</p><p>Sources can contribute several related clips; this is not an independent test set. Rep counts are rule outputs from saved pose detections, not manual counts. Historical runs keep their original model responses.</p><p>These audits are assistant-assisted, not independent expert assessments. Additional unlabelled claims in the full response are not automatically verified.</p><pre>${escapeHTML(JSON.stringify(s.instructionCounts, null, 2))}</pre></details>
  <details class="raw new-run"><summary>Run again / add a result</summary><p>Run locally in the app repository. No API key or model calls run in this website.</p><pre>npm run eval:coaching\n\n# Fresh video inference, up to $9 reserved for 15 requests:\nnpm run eval:coaching -- --infer --budget-usd 9\n\n# One clip:\nnpm run eval:coaching -- --infer --case panel-03 --budget-usd 0.6</pre><label for="import">Inspect an exported report.json locally</label><input type="file" id="import" accept="application/json"><p id="import-status" role="status"></p><p>No upload occurs. Importing results does not publish them.</p></details>`;
  document.querySelectorAll('[data-task]').forEach(
    (b) =>
      (b.onclick = () => {
        runIndex = Number(b.dataset.task);
        filter = 'all';
        query = '';
        showOverview();
      }),
  );
  document.querySelector('#export-reviews').onclick = exportReviews;
  document.querySelector('#run').onchange = (e) => {
    runIndex = Number(e.target.value);
    filter = 'all';
    query = '';
    showOverview();
  };
  const f = document.querySelector('#filter');
  f.value = filter;
  f.onchange = (e) => {
    filter = e.target.value;
    renderRows();
  };
  document.querySelector('#search').oninput = (e) => {
    query = e.target.value;
    renderRows();
  };
  document.querySelector('#import').onchange = async (e) => {
    try {
      const r = JSON.parse(await e.target.files[0].text());
      if (
        r.version !== 1 ||
        !Array.isArray(r.results) ||
        !r.summary ||
        !r.results.every((c) => c.reference && c.grade && c.response && c.pose)
      )
        throw Error();
      r.label = `Imported · ${r.route} · ${r.id}`;
      r.results.forEach((c) => {
        const known = data.runs
          .flatMap((run) => run.results)
          .find(
            (x) =>
              x.id === c.id &&
              x.reference.videoSHA256 === c.reference.videoSHA256,
          );
        c.media = known?.media;
      });
      data.runs.push(r);
      runIndex = data.runs.length - 1;
      showOverview();
    } catch {
      document.querySelector('#import-status').textContent =
        'Could not read this report. Use an export from the evaluation runner.';
    }
  };
  renderRows();
}
function renderRows() {
  const rows = visibleCases();
  document.querySelector('#count').textContent =
    `${rows.length} of ${getRun().results.length}`;
  document.querySelector('#rows').innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<button class="case-row" data-id="${escapeHTML(c.id)}"><span class="case-id">${escapeHTML(c.id)}<small>${escapeHTML(c.reference.group)}</small></span><span class="title">${escapeHTML(c.reference.title)}<small>${escapeHTML(pretty(c.reference.expectations[0].expected))}${drafts.entries.some((d) => d.caseId === c.id && d.videoSHA256 === c.reference.videoSHA256) ? ' · Review draft saved' : ''}</small></span><span class="view">${escapeHTML(c.reference.view)} view<small>${c.pose.complete} full · ${c.pose.partial} partial candidates</small></span><span class="result">${badge(c.grade.verdict)}</span></button>`,
        )
        .join('')
    : '<p class="empty">No clips match these filters.</p>';
  document
    .querySelectorAll('[data-id]')
    .forEach((b) => (b.onclick = () => showCase(b.dataset.id)));
}
function timeButton(start, end, label = 'Evidence') {
  return `<button class="time" data-time="${Number(start)}">${escapeHTML(label)} · ${Number(start).toFixed(1)}–${Number(end).toFixed(1)}s</button>`;
}
async function showCase(id) {
  cleanup();
  const token = generation,
    c = getRun().results.find((c) => c.id === id),
    r = c.reference;
  const ordered = visibleCases(),
    position = ordered.findIndex((x) => x.id === id);
  app.innerHTML = `<div class="detail-top"><div><button id="back" class="back">← All clips</button> <button id="review-shortcut" class="back">Review labels</button> <button id="previous" ${position <= 0 ? 'disabled' : ''}>← Previous</button> <span>${position + 1} / ${ordered.length}</span> <button id="next" ${position >= ordered.length - 1 ? 'disabled' : ''}>Next →</button></div>${badge(c.grade.verdict)}</div><p class="eyebrow">${escapeHTML(c.id)} / ${escapeHTML(getRun().label)}</p><h1>${escapeHTML(r.title)}</h1>
  ${guideHTML()}
  <div class="detail-grid"><aside class="video-card"><video id="video" controls playsinline preload="metadata"></video><div id="video-status" role="status" class="video-info">Opening clip…</div><div class="video-info"><a href="${escapeHTML(r.sourceURL)}" target="_blank" rel="noopener noreferrer">Original source ↗</a><dl><dt>Camera</dt><dd>${escapeHTML(r.view)} view</dd><dt>Source interval</dt><dd>${r.sourceInterval.map((n) => Number(n).toFixed(2)).join('–')}s</dd><dt>Creator label</dt><dd>${escapeHTML(pretty(r.creatorLabel))}</dd><dt>Reference</dt><dd>${escapeHTML(pretty(r.referenceQuality))}</dd><dt>Current tracker</dt><dd>${c.pose.complete} full + ${c.pose.partial} partial candidates</dd></dl><p class="scope">${escapeHTML(r.referenceAuthority)} ${r.answerOverlays ? 'Answer graphics remain: this is not a blind test.' : ''}</p></div></aside><section>
  ${c.grade.checks
    .map(
      (q) =>
        `<article class="check"><div class="check-head"><h3>${escapeHTML(pretty(q.id))}</h3>${badge(q.grade)}</div><p class="label">Expected · ${escapeHTML(pretty(q.expected))}</p><p>${escapeHTML(q.feedback)}</p>${q.windows.map(([a, b]) => timeButton(a, b, 'Reference')).join('')}<p class="label">Actual · ${escapeHTML(q.actual?.status ?? 'no accepted check')}</p><p>${escapeHTML(q.actual?.observation || q.actual?.missingEvidence || c.response.error || 'No response for this check.')}</p>${q.actual?.suggestion ? `<p><strong>Cue:</strong> ${escapeHTML(q.actual.suggestion)}</p>` : ''}${(
          q.actual?.events ??
          q.actual?.evidence ??
          []
        )
          .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
          .map((e) => timeButton(e.start, e.end, 'Model'))
          .join(
            '',
          )}<p class="label">Why this grade</p><p class="reason">${escapeHTML(q.rationale)}</p></article>`,
    )
    .join('')}
  ${c.grade.unsupportedClaims.length ? `<article class="check"><h3>Additional claim to fix</h3>${c.grade.unsupportedClaims.map((s) => `<p>${escapeHTML(s)}</p>`).join('')}</article>` : ''}
  ${(c.grade.unreviewedConcerns ?? []).length ? `<article class="check"><h3>Additional concerns need review</h3><p>These claims have no adjudicated reference yet. They cannot silently receive a passing grade.</p>${c.grade.unreviewedConcerns.map((q) => `<p><strong>${escapeHTML(pretty(q.id))}:</strong> ${escapeHTML(q.observation)}</p><p>${escapeHTML(q.suggestion ?? '')}</p>`).join('')}</article>` : ''}
  ${(r.reviewNotes ?? []).map((n) => `<article class="check"><h3>${escapeHTML(n.title)}</h3><p class="label">Your comment</p><p>${escapeHTML(n.text)}</p><p class="reason">${escapeHTML(n.resolution)}</p></article>`).join('')}
  <section id="review-editor" class="check review-editor"></section>
  ${c.response.evidenceGate?.decisions?.length ? `<article class="check"><h3>Local evidence check</h3>${c.response.evidenceGate.decisions.map((d) => `<p>${escapeHTML(d.reason)}</p>`).join('')}<p class="scope">The original model answer remains below; the pipeline withholds the unsupported reassurance.</p></article>` : ''}
  ${c.response.evidenceGate?.explanationEdits?.length ? `<p class="scope">The coaching explanation omits unverified causes. The original model wording is retained below for inspection.</p>` : ''}
  <details class="raw"><summary>Full pipeline response</summary><pre>${escapeHTML(JSON.stringify(c.response.proposal ?? c.response.checks, null, 2))}</pre></details>
  ${c.response.providerProposal ? `<details class="raw"><summary>Original model response · before local checks</summary><pre>${escapeHTML(JSON.stringify(c.response.providerProposal, null, 2))}</pre></details>` : ''}
  <details class="raw"><summary>Reference, constraints & provenance</summary><pre>${escapeHTML(JSON.stringify(r, null, 2))}</pre></details>
  <details class="raw"><summary>Tracking, usage & exact model input</summary><pre>${escapeHTML(JSON.stringify({ pose: c.pose, model: c.response.model, mode: c.response.mode, usage: c.response.usage, priorUsage: c.response.priorUsage, policyId: c.response.policyId, policySHA256: c.response.policySHA256, stage: c.response.stage, evidenceGate: c.response.evidenceGate, requestSHA256: c.response.requestSHA256, coachingRuntime: c.response.runtimeSHA256, poseRuntimeAtCoaching: c.response.poseRuntimeSHA256, prompt: c.response.prompt }, null, 2))}</pre></details>
  <p class="scope">${escapeHTML(c.grade.scope)} Timestamp validation checks structure; it does not verify the model’s visual interpretation.</p></section></div>`;
  document.querySelector('#back').onclick = () => {
    showOverview();
    window.scrollTo(0, 0);
  };
  document.querySelector('#previous').onclick = () => {
    void showCase(ordered[position - 1].id);
    window.scrollTo(0, 0);
  };
  document.querySelector('#next').onclick = () => {
    void showCase(ordered[position + 1].id);
    window.scrollTo(0, 0);
  };
  mountReviewEditor(c);
  document.querySelector('#review-shortcut').onclick = () => {
    document
      .querySelector('#review-editor')
      .scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#review-check').focus({ preventScroll: true });
  };
  window.scrollTo(0, 0);
  document.querySelectorAll('[data-time]').forEach(
    (b) =>
      (b.onclick = () => {
        const v = document.querySelector('#video');
        v.currentTime = Number(b.dataset.time);
        v.play().catch(() => {});
      }),
  );
  try {
    if (!c.media) throw Error();
    const bytes = await decrypt(c.media);
    if (token !== generation) return;
    mediaURL = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    document.querySelector('#video').src = mediaURL;
    document.querySelector('#video-status').textContent =
      'Cropped clip · timestamps below are relative to this clip.';
  } catch {
    if (token === generation)
      document.querySelector('#video-status').textContent =
        'Clip unavailable. Use the original source link or rebuild the media bundle.';
  }
}

function exportReviews() {
  if (!drafts.entries.length) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(drafts.export(), null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `form-lab-exercise-reviews-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mountReviewEditor(c) {
  const run = getRun(),
    r = c.reference;
  const context = {
    exerciseFamily: taskOf(run).id,
    caseId: c.id,
    videoSHA256: r.videoSHA256,
    baseReferenceSHA256: run.referenceSHA256,
  };
  const criteria = [
    ...new Set([
      ...r.expectations.map((q) => q.id),
      ...c.response.checks.map((q) => q.id),
    ]),
  ];
  const preferred = c.grade.unreviewedConcerns?.[0]?.id ?? r.expectations[0].id;
  const editor = document.querySelector('#review-editor');
  editor.innerHTML = `<h2>Review the expected label</h2><p class="scope">Record what you see in the clip. This saves a proposed reference change; it does not mark the model correct or change the published score.</p><form id="review-form"><label for="review-check">Instruction or claim</label><select id="review-check">${criteria.map((id) => `<option value="${escapeHTML(id)}">${escapeHTML(checkNames[id] ?? pretty(id))}</option>`).join('')}</select><p id="review-check-help" class="scope"></p><p id="review-current" class="scope"></p><label for="review-outcome">What should the expected label be?</label><select id="review-outcome" required><option value="">Choose a label…</option>${Object.entries(
    outcomes,
  )
    .map(([id, label]) => `<option value="${id}">${escapeHTML(label)}</option>`)
    .join(
      '',
    )}</select><label for="review-feedback">What should the coach say?</label><textarea id="review-feedback" required maxlength="4000" rows="3" placeholder="Describe the visible movement and any useful correction."></textarea><div class="review-times"><div><label for="review-start">Evidence start (seconds, optional)</label><input id="review-start" type="number" min="0" step="0.01"><button type="button" data-mark="review-start">Use video time</button></div><div><label for="review-end">Evidence end (seconds, optional)</label><input id="review-end" type="number" min="0" step="0.01"><button type="button" data-mark="review-end">Use video time</button></div></div><label for="review-note">Why? (optional)</label><textarea id="review-note" maxlength="4000" rows="2" placeholder="What makes the claim clear or uncertain?"></textarea><div class="review-actions"><button type="submit" id="save-review">Save review in this browser</button><button type="button" id="export-case-reviews" ${drafts.entries.length ? '' : 'disabled'}>Export reviews for me</button></div><p id="review-status" role="status"></p><p class="scope">Export the JSON file and attach it in our chat. I can then version the reference labels and rerun the evaluation. Browser drafts do not sync between devices; keep an export before clearing browser data.</p></form>`;
  const select = document.querySelector('#review-check');
  select.value = preferred;
  const refresh = () => {
    const id = select.value,
      existing = r.expectations.find((q) => q.id === id),
      saved = drafts.find(context, id);
    document.querySelector('#review-check-help').textContent =
      checkHelp[id] ??
      'Review only this selected instruction. Other positives or concerns are separate checks.';
    document.querySelector('#review-current').textContent = existing
      ? `Published reference: ${outcomes[existing.expected] ?? existing.expected}. ${existing.feedback}`
      : 'This model claim does not have an adjudicated reference yet.';
    document.querySelector('#review-outcome').value =
      saved?.expected ?? existing?.expected ?? '';
    document.querySelector('#review-feedback').value =
      saved?.feedback ?? existing?.feedback ?? '';
    document.querySelector('#review-note').value = saved?.note ?? '';
    const window = saved?.windows?.[0] ?? existing?.windows?.[0];
    document.querySelector('#review-start').value = window?.[0] ?? '';
    document.querySelector('#review-end').value = window?.[1] ?? '';
    document.querySelector('#review-status').textContent = saved
      ? `Draft saved ${new Date(saved.updatedAt).toLocaleString()}. Shared labels and scores have not changed.`
      : drafts.warning;
  };
  select.onchange = refresh;
  refresh();
  editor.querySelectorAll('[data-mark]').forEach(
    (button) =>
      (button.onclick = () => {
        const video = document.querySelector('#video');
        if (!video || video.readyState < 1) {
          document.querySelector('#review-status').textContent =
            'Wait for the video to load before marking a time.';
          return;
        }
        document.getElementById(button.dataset.mark).value =
          video.currentTime.toFixed(2);
      }),
  );
  document.querySelector('#export-case-reviews').onclick = exportReviews;
  document.querySelector('#review-form').onsubmit = async (event) => {
    event.preventDefault();
    const status = document.querySelector('#review-status'),
      button = document.querySelector('#save-review');
    try {
      const duration = document.querySelector('#video')?.duration;
      const decision = validateDecision(
        {
          expected: document.querySelector('#review-outcome').value,
          feedback: document.querySelector('#review-feedback').value,
          note: document.querySelector('#review-note').value,
          start: document.querySelector('#review-start').value,
          end: document.querySelector('#review-end').value,
        },
        Number.isFinite(duration)
          ? duration
          : r.sourceInterval[1] - r.sourceInterval[0],
      );
      button.disabled = true;
      await drafts.save({
        ...context,
        checkId: select.value,
        ...decision,
        updatedAt: new Date().toISOString(),
        source: 'user_web_review',
        referenceAuthority:
          'User proposed reference; not independently expert adjudicated',
        runId: run.id,
        route: run.route,
        responseRequestSHA256: c.response.requestSHA256 ?? null,
        originalExpectation:
          r.expectations.find((q) => q.id === select.value) ?? null,
      });
      status.textContent =
        'Saved in this browser. Export reviews and send me the file to update shared labels and scores.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      document.querySelector('#export-case-reviews').disabled =
        !drafts.entries.length;
    }
  };
}
