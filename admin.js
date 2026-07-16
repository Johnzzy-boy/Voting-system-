/**
 * admin.js — Admin Dashboard Logic
 * ============================================================
 * Handles all admin operations:
 *   - Candidate management (add/edit/delete)
 *   - Voter management (view/suspend/delete)
 *   - Election timer configuration
 *   - Live results overview
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', async () => {

  const sess = requireAuth(true);  // admin only
  if (!sess) return;

  setupLiveRefresh();

  // Update nav
  const navName = document.getElementById('nav-admin-name');
  if (navName) navName.textContent = sess.fullName;

  const preloader = document.getElementById('preloader');

  // Load initial data
  await loadStats();
  await loadVoters();
  await loadCandidates();
  await loadElectionSettings();
  await loadAdminResults();
  initImbomahAssistant();

  if (preloader) {
    preloader.classList.add('hidden');
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Candidate modal
  document.getElementById('add-candidate-btn').addEventListener('click', () => openCandidateModal());
  document.getElementById('candidate-modal-close').addEventListener('click', closeCandidateModal);
  document.getElementById('candidate-form').addEventListener('submit', saveCandidate);

  // Photo preview
  document.getElementById('candidate-photo-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    const preview = document.getElementById('photo-preview');
    if (!file) {
      preview.style.display = 'none';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Election settings
  document.getElementById('election-settings-form').addEventListener('submit', saveElectionSettings);

  // Mobile navigation
  const navToggle = document.getElementById('nav-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  const mobileNavClose = document.getElementById('mobile-nav-close');
  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

  const closeMobileNav = () => {
    mobileNav?.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
    mobileNav?.setAttribute('aria-hidden', 'true');
  };

  navToggle?.addEventListener('click', () => {
    const isOpen = mobileNav?.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
    mobileNav?.setAttribute('aria-hidden', String(!isOpen));
  });

  mobileNavClose?.addEventListener('click', closeMobileNav);
  mobileNav?.addEventListener('click', (e) => {
    if (e.target === mobileNav) closeMobileNav();
  });

  document.querySelectorAll('.mobile-nav-links a').forEach(link => {
    link.addEventListener('click', closeMobileNav);
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearSession();
    window.location.href = 'login.html';
  });

  mobileLogoutBtn?.addEventListener('click', () => {
    clearSession();
    window.location.href = 'login.html';
  });
});

function setupLiveRefresh() {
  const refresh = () => {
    loadStats().catch(console.error);
    loadVoters().catch(console.error);
    loadCandidates().catch(console.error);
    loadElectionSettings().catch(console.error);
    loadAdminResults().catch(console.error);
  };

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('votesecure-sync');
    channel.addEventListener('message', () => refresh());
    window.addEventListener('beforeunload', () => channel.close());
  }

  window.addEventListener('storage', (event) => {
    if (event.key === 'votesecure-sync') refresh();
  });

  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  window.setInterval(refresh, 3000);
}

// ── Stats Overview ────────────────────────────────────────────────────────

function isRegularVoter(voter) {
  return !!voter && voter.isAdmin !== true && voter.voterId !== 'ADMIN-001' && voter.email !== 'admin@votesecure.gov';
}

async function loadStats() {
  const [voters, candidates, votes, config] = await Promise.all([
    getAllVoters(), getAllCandidates(), getAllVotes(), getElectionConfig()
  ]);

  const activeVoters = voters.filter(v => isRegularVoter(v) && v.status === 'active');
  const votersVoted  = activeVoters.filter(v => Object.keys(v.hasVoted || {}).length > 0);

  document.getElementById('stat-voters').textContent      = activeVoters.length;
  document.getElementById('stat-candidates').textContent  = candidates.length;
  document.getElementById('stat-votes').textContent       = votes.length;
  document.getElementById('stat-status').textContent      = isElectionActive(config) ? 'Active' : 'Inactive';
  document.getElementById('stat-status').closest('.stat-card')
    .querySelector('.stat-icon').className = `stat-icon ${isElectionActive(config) ? 'green' : 'red'}`;

  // Participation rate
  const pct = activeVoters.length ? Math.round(votersVoted.length / activeVoters.length * 100) : 0;
  const el  = document.getElementById('stat-participation');
  if (el) el.textContent = `${pct}%`;

  const tickerFeed = document.getElementById('ticker-feed');
  if (tickerFeed) {
    const statusText = isElectionActive(config) ? 'Election is live now' : 'Election is currently on standby';
    const message = `Votes: ${votes.length} • Voters: ${activeVoters.length} • ${statusText} • Participation: ${pct}%`;
    tickerFeed.innerHTML = `<span>${sanitize(message)}</span>`;
  }
}

// ── Voters Table ──────────────────────────────────────────────────────────

async function loadVoters() {
  const voters = await getAllVoters();
  const tbody  = document.getElementById('voters-tbody');

  const registrants = voters.filter(v => isRegularVoter(v));
  if (registrants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gray)">No voters registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = registrants.map(v => `
    <tr>
      <td><span class="text-mono text-sm text-gold">${sanitize(v.voterId)}</span></td>
      <td>${sanitize(v.fullName)}</td>
      <td>${sanitize(v.email)}</td>
      <td>${new Date(v.createdAt).toLocaleDateString()}</td>
      <td>
        <span class="badge ${v.status === 'active' ? 'badge-green' : 'badge-red'}">
          ${v.status}
        </span>
      </td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-sm btn-secondary" onclick="toggleSuspend('${v.voterId}','${v.status}')">
            ${v.status === 'active' ? 'Suspend' : 'Reinstate'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="removeVoter('${v.voterId}')">Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

async function toggleSuspend(voterId, currentStatus) {
  if (!confirm(`Are you sure you want to ${currentStatus === 'active' ? 'suspend' : 'reinstate'} this voter?`)) return;
  const voter = await getVoter(voterId);
  voter.status = currentStatus === 'active' ? 'suspended' : 'active';
  await updateVoter(voter);
  showToast(`Voter ${currentStatus === 'active' ? 'suspended' : 'reinstated'}.`, 'success');
  loadVoters(); loadStats();
}

async function removeVoter(voterId) {
  if (!confirm('Permanently delete this voter? This cannot be undone.')) return;
  await deleteVoter(voterId);
  showToast('Voter deleted.', 'success');
  loadVoters(); loadStats();
}

// ── Candidates Table ──────────────────────────────────────────────────────

async function loadCandidates() {
  const candidates = await getAllCandidates();
  const tbody = document.getElementById('candidates-tbody');

  if (candidates.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray)">No candidates added yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = candidates.map(c => `
    <tr>
      <td>
        <div class="flex gap-1" style="align-items:center">
          <div class="candidate-avatar" style="width:34px;height:34px;font-size:1rem">
            ${c.photo ? `<img src="${c.photo}" alt="">` : sanitize(c.name[0])}
          </div>
          <span>${sanitize(c.name)}</span>
        </div>
      </td>
      <td><span class="badge badge-blue">${sanitize(c.position)}</span></td>
      <td>${sanitize(c.party)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${sanitize(c.manifesto || '—')}
      </td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-sm btn-secondary" onclick="editCandidate(${c.id})">Edit</button>
          <button class="btn btn-sm btn-danger"    onclick="removeCandidate(${c.id})">Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

// ── Candidate Modal ───────────────────────────────────────────────────────

let editingCandidateId = null;
let candidatePhotoData = null;

function openCandidateModal(candidate = null) {
  editingCandidateId = candidate ? candidate.id : null;
  candidatePhotoData = candidate?.photo || null;
  const form = document.getElementById('candidate-form');
  form.reset();
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('candidate-modal-title').textContent =
    candidate ? 'Edit Candidate' : 'Add Candidate';

  if (candidate) {
    document.getElementById('c-name').value     = candidate.name;
    document.getElementById('c-position').value = candidate.position;
    document.getElementById('c-party').value    = candidate.party;
    document.getElementById('c-manifesto').value= candidate.manifesto || '';
    if (candidate.photo) {
      const preview = document.getElementById('photo-preview');
      preview.src = candidate.photo; preview.style.display = 'block';
    }
  }

  document.getElementById('candidate-modal').classList.add('open');
}

function closeCandidateModal() {
  document.getElementById('candidate-modal').classList.remove('open');
  editingCandidateId = null;
  candidatePhotoData = null;
}

async function editCandidate(id) {
  const c = await getCandidate(id);
  if (c) openCandidateModal(c);
}

async function saveCandidate(e) {
  e.preventDefault();
  const btn = document.getElementById('save-candidate-btn');
  btn.disabled = true;

  const fileInput = document.getElementById('candidate-photo-file');
  const preview = document.getElementById('photo-preview');
  const imageData = preview.src && preview.style.display !== 'none' ? preview.src : candidatePhotoData;

  const data = {
    name:      document.getElementById('c-name').value.trim(),
    position:  document.getElementById('c-position').value.trim(),
    party:     document.getElementById('c-party').value.trim(),
    manifesto: document.getElementById('c-manifesto').value.trim(),
    photo:     imageData || null,
  };

  if (!data.name || !data.position || !data.party) {
    showToast('Name, position, and party are required.', 'error');
    btn.disabled = false; return;
  }

  try {
    if (editingCandidateId) {
      await updateCandidate({ ...data, id: editingCandidateId });
      showToast('Candidate updated.', 'success');
    } else {
      await addCandidate(data);
      showToast('Candidate added.', 'success');
    }
    closeCandidateModal();
    loadCandidates(); loadStats(); loadAdminResults();
  } catch (err) {
    showToast('Error saving candidate.', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

async function removeCandidate(id) {
  if (!confirm('Delete this candidate? Associated votes will remain but won\'t count.')) return;
  await deleteCandidate(id);
  showToast('Candidate deleted.', 'success');
  loadCandidates(); loadStats(); loadAdminResults();
}

// ── Election Settings ─────────────────────────────────────────────────────

async function loadElectionSettings() {
  const config = await getElectionConfig();
  if (config.startTime) {
    document.getElementById('election-start').value = toDateTimeLocal(config.startTime);
  }
  if (config.endTime) {
    document.getElementById('election-end').value = toDateTimeLocal(config.endTime);
  }
  if (config.title) {
    document.getElementById('election-title').value = config.title;
  }
  updateElectionStatus(config);
}

async function saveElectionSettings(e) {
  e.preventDefault();
  const startVal = document.getElementById('election-start').value;
  const endVal   = document.getElementById('election-end').value;
  const title    = document.getElementById('election-title').value.trim();

  if (!startVal || !endVal) {
    showToast('Please set both start and end date/time.', 'error'); return;
  }

  const startTime = new Date(startVal).getTime();
  const endTime   = new Date(endVal).getTime();

  if (endTime <= startTime) {
    showToast('End time must be after start time.', 'error'); return;
  }

  await saveElectionConfig({ title: title || 'General Election', startTime, endTime });
  showToast('Election settings saved.', 'success');
  updateElectionStatus({ startTime, endTime });
  loadStats();
}

function updateElectionStatus(config) {
  const el  = document.getElementById('election-current-status');
  const summaryEl = document.getElementById('election-window-summary');
  const now = Date.now();

  if (!config.startTime || !config.endTime) {
    el.innerHTML = '<span class="badge badge-gray">Not Configured</span>';
    if (summaryEl) summaryEl.textContent = 'Set a start and end time to activate the election schedule.';
    return;
  }

  const start = new Date(config.startTime);
  const end = new Date(config.endTime);
  const startText = start.toLocaleString();
  const endText = end.toLocaleString();

  if (now < config.startTime) {
    el.innerHTML = `<span class="badge badge-blue">Scheduled — starts ${startText}</span>`;
    if (summaryEl) summaryEl.textContent = `Voting opens on ${startText} and closes on ${endText}.`;
  } else if (isElectionActive(config)) {
    el.innerHTML = `<span class="badge badge-green">🟢 Active — ends ${endText}</span>`;
    if (summaryEl) summaryEl.textContent = `Voting is currently open until ${endText}.`;
  } else {
    el.innerHTML = `<span class="badge badge-red">Ended</span>`;
    if (summaryEl) summaryEl.textContent = `The voting window ended on ${endText}.`;
  }
}

// ── Admin Results Preview ─────────────────────────────────────────────────

async function loadAdminResults() {
  const [candidates, votes] = await Promise.all([getAllCandidates(), getAllVotes()]);
  const container = document.getElementById('admin-results');

  if (candidates.length === 0) {
    container.innerHTML = '<div class="chat-bubble chat-bubble-system"><div class="chat-author">System</div><div class="chat-text">No candidates have been added yet.</div></div>';
    return;
  }

  const byPosition = {};
  candidates.forEach(c => {
    if (!byPosition[c.position]) byPosition[c.position] = [];
    byPosition[c.position].push(c);
  });

  const voteCounts = {};
  votes.forEach(v => { voteCounts[v.candidateId] = (voteCounts[v.candidateId] || 0) + 1; });

  const summaryText = votes.length
    ? `${votes.length} ballot${votes.length !== 1 ? 's' : ''} collected across ${Object.keys(byPosition).length} position${Object.keys(byPosition).length !== 1 ? 's' : ''}.`
    : 'No ballots have been cast yet.';

  container.innerHTML = `
    <div class="chat-shell">
      <div class="chat-bubble chat-bubble-system">
        <div class="chat-author">System</div>
        <div class="chat-text">${summaryText}</div>
      </div>
      ${Object.entries(byPosition).map(([pos, cands]) => {
        const total = cands.reduce((s, c) => s + (voteCounts[c.id] || 0), 0);
        const sorted = [...cands].sort((a,b) => (voteCounts[b.id]||0) - (voteCounts[a.id]||0));
        const leader = sorted[0];
        const leaderCount = voteCounts[leader.id] || 0;
        const leaderPct = total ? Math.round(leaderCount / total * 100) : 0;

        return `
          <div class="chat-bubble chat-bubble-admin">
            <div class="chat-author">${sanitize(pos)}</div>
            <div class="chat-text">
              <strong>${sanitize(leader.name)}</strong> is leading with <strong>${leaderCount} vote${leaderCount !== 1 ? 's' : ''}</strong> (${leaderPct}%).
            </div>
            <div class="chat-mini-list">
              ${sorted.slice(0, 4).map(c => `
                <div class="chat-mini-item">
                  <strong>${sanitize(c.name)}</strong>
                  <span>${voteCounts[c.id] || 0} votes</span>
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Imbomah Assistant ───────────────────────────────────────────────────

function initImbomahAssistant() {
  const form = document.getElementById('imbomah-form');
  const input = document.getElementById('imbomah-input');
  const messages = document.getElementById('imbomah-messages');
  const launcher = document.getElementById('imbomah-launcher');
  const windowEl = document.getElementById('imbomah-window');
  const closeBtn = document.getElementById('imbomah-close');

  if (!form || !input || !messages || !launcher || !windowEl || !closeBtn) return;

  if (messages.children.length === 0) {
    appendImbomahMessage('Imbomah', 'Hello admin. I can summarize results, highlight leaders, and flag turnout risks. Ask me anything about the election.', 'system');
  }

  const openWindow = () => {
    windowEl.classList.add('open');
    windowEl.setAttribute('aria-hidden', 'false');
    input.focus();
  };

  const closeWindow = () => {
    windowEl.classList.remove('open');
    windowEl.setAttribute('aria-hidden', 'true');
  };

  launcher.addEventListener('click', () => {
    if (windowEl.classList.contains('open')) {
      closeWindow();
    } else {
      openWindow();
    }
  });

  closeBtn.addEventListener('click', closeWindow);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWindow();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) return;

    appendImbomahMessage('You', prompt, 'user');
    input.value = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    input.disabled = true;

    try {
      const reply = await generateImbomahReply(prompt);
      appendImbomahMessage('Imbomah', reply, 'system');
    } catch (err) {
      console.error(err);
      appendImbomahMessage('Imbomah', 'I ran into an issue while reviewing the election data. Please try again.', 'system');
    } finally {
      submitBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  document.querySelectorAll('.assistant-suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.prompt || '';
      form.requestSubmit();
    });
  });
}

function appendImbomahMessage(author, text, type) {
  const messages = document.getElementById('imbomah-messages');
  if (!messages) return;

  const bubble = document.createElement('div');
  bubble.className = type === 'user' ? 'chat-bubble chat-bubble-admin' : 'chat-bubble chat-bubble-system';
  bubble.innerHTML = `
    <div class="chat-author">${sanitize(author)}</div>
    <div class="chat-text">${sanitize(text).replace(/\n/g, '<br>')}</div>
  `;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

async function generateImbomahReply(prompt) {
  const context = await getImbomahContext();
  const lower = prompt.toLowerCase();

  if (!context.hasData) {
    return 'No election data is available yet. Add candidates and cast some votes so I can start analyzing the race.';
  }

  if (/(summar|overview|what's happening|what is happening|status)/i.test(lower)) {
    return buildSummaryReply(context);
  }

  if (/(leader|winning|winner|front runner|who is leading)/i.test(lower)) {
    return buildLeaderReply(context);
  }

  if (/(turnout|participation|voter|engagement|active)/i.test(lower)) {
    return buildTurnoutReply(context);
  }

  if (/(risk|tight|close|competitive|watch|concern)/i.test(lower)) {
    return buildRiskReply(context);
  }

  if (/(recommend|suggest|advice|action|next step)/i.test(lower)) {
    return buildRecommendationReply(context);
  }

  return buildGeneralReply(context, prompt);
}

async function getImbomahContext() {
  const [voters, candidates, votes, config] = await Promise.all([
    getAllVoters(), getAllCandidates(), getAllVotes(), getElectionConfig()
  ]);

  const regularVoters = voters.filter(isRegularVoter);
  const activeVoters = regularVoters.filter(v => v.status === 'active');
  const votedVoters = activeVoters.filter(v => Object.keys(v.hasVoted || {}).length > 0);

  const byPosition = {};
  candidates.forEach(c => {
    if (!byPosition[c.position]) byPosition[c.position] = [];
    byPosition[c.position].push(c);
  });

  const voteCounts = {};
  votes.forEach(v => {
    voteCounts[v.candidateId] = (voteCounts[v.candidateId] || 0) + 1;
  });

  const positionSummaries = Object.entries(byPosition).map(([position, cands]) => {
    const sorted = [...cands].sort((a, b) => (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0));
    const total = sorted.reduce((sum, c) => sum + (voteCounts[c.id] || 0), 0);
    const leader = sorted[0];
    const leaderVotes = voteCounts[leader.id] || 0;
    const leaderPct = total ? Math.round(leaderVotes / total * 100) : 0;
    const runnerUp = sorted[1];
    const runnerUpVotes = voteCounts[runnerUp?.id] || 0;
    const margin = leaderVotes - runnerUpVotes;

    return {
      position,
      total,
      leader: leader ? { name: leader.name, party: leader.party, votes: leaderVotes, pct: leaderPct } : null,
      runnerUp: runnerUp ? { name: runnerUp.name, votes: runnerUpVotes } : null,
      margin,
      isClose: !!runnerUp && total > 0 && margin <= 2
    };
  });

  const participation = activeVoters.length ? Math.round(votedVoters.length / activeVoters.length * 100) : 0;
  const status = isElectionActive(config) ? 'active' : 'inactive';

  return {
    hasData: candidates.length > 0 && votes.length > 0,
    candidates,
    votes,
    totalVotes: votes.length,
    activeVoters: activeVoters.length,
    votedVoters: votedVoters.length,
    participation,
    status,
    positionSummaries
  };
}

function buildSummaryReply(context) {
  const leaderLines = context.positionSummaries.map(item => {
    if (!item.leader) return null;
    return `- ${item.position}: ${item.leader.name} has ${item.leader.votes} vote${item.leader.votes !== 1 ? 's' : ''} (${item.leader.pct}%).`;
  }).filter(Boolean);

  const leadText = leaderLines.join('\n');
  return `Current snapshot:\n- Total ballots cast: ${context.totalVotes}\n- Registered active voters: ${context.activeVoters}\n- Participation: ${context.participation}%\n- Election status: ${context.status}\n\nLeading candidates:\n${leadText}`;
}

function buildLeaderReply(context) {
  const leaders = context.positionSummaries.map(item => {
    if (!item.leader) return null;
    return `${item.position}: ${item.leader.name} (${item.leader.votes} votes, ${item.leader.pct}%)`;
  }).filter(Boolean);

  return `Here are the current leaders:\n${leaders.join('\n')}`;
}

function buildTurnoutReply(context) {
  if (context.participation >= 70) {
    return `Turnout is strong at ${context.participation}%. Participation is looking healthy, and the election appears to be engaging voters well.`;
  }
  if (context.participation >= 40) {
    return `Turnout is moderate at ${context.participation}%. There is room to grow participation with a reminder campaign or an extra voter outreach push.`;
  }
  return `Turnout is low at ${context.participation}%. Consider sending reminders, extending awareness, or encouraging last-minute engagement to improve participation.`;
}

function buildRiskReply(context) {
  const closeRaces = context.positionSummaries.filter(item => item.isClose);
  if (closeRaces.length === 0) {
    return 'The current results do not show any especially tight races. Most positions appear to have a clear leader.';
  }

  const details = closeRaces.map(item => `- ${item.position}: ${item.leader.name} leads by ${item.margin} vote${item.margin !== 1 ? 's' : ''}.`).join('\n');
  return `A few races look competitive:\n${details}\n\nThese are worth monitoring closely if you want to confirm the final outcome.`;
}

function buildRecommendationReply(context) {
  let advice = 'Recommended next steps:\n';
  if (context.participation < 50) {
    advice += '- Increase outreach to improve turnout.\n';
  }
  if (context.positionSummaries.some(item => item.isClose)) {
    advice += '- Watch close races closely and verify final tallies before announcing results.\n';
  }
  advice += '- Keep sharing the latest totals with stakeholders so the outcome stays transparent.';
  return advice;
}

function buildGeneralReply(context, prompt) {
  return `Imbomah is reviewing the current election data. I can help with summaries, leaders, turnout, risks, or recommendations. Your question was: ${prompt}`;
}

// ── Utils ─────────────────────────────────────────────────────────────────

function toDateTimeLocal(ts) {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
