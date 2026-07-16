/**
 * vote.js — Voting Module
 * ============================================================
 * Displays candidates grouped by position, enforces one-vote-
 * per-position per voter, and submits ballots to IndexedDB.
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', async () => {

  const sess = requireAuth();
  if (!sess) return;

  // Update nav with voter info
  const navName = document.getElementById('nav-voter-name');
  const navId   = document.getElementById('nav-voter-id');
  if (navName) navName.textContent = sess.fullName;
  if (navId)   navId.textContent   = sess.voterId;

  const mainContent = document.getElementById('vote-main');
  const statusBox   = document.getElementById('vote-status');

  // Load election config
  const config = await getElectionConfig();
  renderTimer(config);

  if (!isElectionActive(config)) {
    showStatus(config);
    return;
  }

  // Load voter and candidates
  const [voter, candidates] = await Promise.all([
    getVoter(sess.voterId),
    getAllCandidates()
  ]);

  if (!voter) { window.location.href = 'login.html'; return; }

  if (candidates.length === 0) {
    mainContent.innerHTML = `
      <div class="alert alert-info">
        <span>ℹ</span> No candidates have been added yet. Please check back later.
      </div>`;
    return;
  }

  // Group candidates by position
  const byPosition = {};
  candidates.forEach(c => {
    if (!byPosition[c.position]) byPosition[c.position] = [];
    byPosition[c.position].push(c);
  });

  // Track selections { position: candidateId }
  const selections = {};

  // Render each position section
  mainContent.innerHTML = '';
  Object.entries(byPosition).forEach(([position, cands]) => {
    const alreadyVoted = voter.hasVoted && voter.hasVoted[position];

    const section = document.createElement('section');
    section.className = 'position-section';
    section.innerHTML = `
      <div class="position-title">${sanitize(position)}</div>
      ${alreadyVoted
        ? `<div class="alert alert-success">
             <span>✓</span> You have already cast your vote for this position.
           </div>`
        : `<div class="candidates-grid" id="grid-${position.replace(/\s+/g,'_')}"></div>`
      }`;
    mainContent.appendChild(section);

    if (!alreadyVoted) {
      const grid = section.querySelector('.candidates-grid');
      cands.forEach(c => {
        const card = buildCandidateCard(c, position, selections, alreadyVoted);
        grid.appendChild(card);
      });
    }
  });

  // Submit button
  const submitWrap = document.createElement('div');
  submitWrap.className = 'flex-center mt-4 mb-4';
  submitWrap.innerHTML = `
    <button class="btn btn-primary btn-lg" id="submit-votes">
      🗳 Submit My Ballot
    </button>`;
  mainContent.appendChild(submitWrap);

  document.getElementById('submit-votes').addEventListener('click', () => submitBallot(voter, selections, byPosition));

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearSession();
    window.location.href = 'login.html';
  });
});

// ── Build candidate card DOM element ─────────────────────────────────────

function buildCandidateCard(candidate, position, selections, disabled) {
  const card = document.createElement('div');
  card.className = 'candidate-card';
  card.dataset.id = candidate.id;

  const photoHTML = candidate.photo
    ? `<img src="${candidate.photo}" alt="${sanitize(candidate.name)}">`
    : `<span>${sanitize(candidate.name[0])}</span>`;

  card.innerHTML = `
    <div class="flex gap-2" style="align-items:flex-start">
      <div class="candidate-avatar">${photoHTML}</div>
      <div class="candidate-info">
        <div class="candidate-name">${sanitize(candidate.name)}</div>
        <div class="candidate-party">${sanitize(candidate.party)}</div>
      </div>
    </div>
    <p class="candidate-manifesto">${sanitize(candidate.manifesto || 'No manifesto provided.')}</p>
    <div class="vote-check">✓</div>`;

  if (!disabled) {
    card.addEventListener('click', () => {
      // Deselect siblings in same grid
      const grid = card.closest('.candidates-grid');
      grid.querySelectorAll('.candidate-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selections[position] = candidate.id;
    });
  }

  return card;
}

// ── Submit all votes ──────────────────────────────────────────────────────

async function submitBallot(voter, selections, byPosition) {
  const positions = Object.keys(byPosition);
  const pending   = positions.filter(p => !(voter.hasVoted && voter.hasVoted[p]));

  // Check all pending positions have a selection
  const unselected = pending.filter(p => !selections[p]);
  if (unselected.length > 0) {
    showToast(`Please select a candidate for: ${unselected.join(', ')}`, 'error', 5000);
    return;
  }

  const btn = document.getElementById('submit-votes');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting…';

  try {
    for (const position of pending) {
      const candidateId = selections[position];
      await castVote(voter.voterId, candidateId, position);
      voter.hasVoted = voter.hasVoted || {};
      voter.hasVoted[position] = candidateId;
    }

    // Persist updated voter record (hasVoted map)
    await updateVoter(voter);

    showToast('Your ballot has been cast successfully! 🗳', 'success', 4000);
    setTimeout(() => window.location.href = 'results.html', 1800);

  } catch (err) {
    // IndexedDB unique constraint violation = duplicate vote attempt
    if (err.name === 'ConstraintError') {
      showToast('Duplicate vote detected. Your vote was already recorded.', 'error');
    } else {
      showToast('Error submitting ballot. Please try again.', 'error');
      console.error(err);
    }
    btn.disabled = false;
    btn.innerHTML = '🗳 Submit My Ballot';
  }
}

// ── Election timer rendering ──────────────────────────────────────────────

function renderTimer(config) {
  const timerEl = document.getElementById('election-timer');
  if (!timerEl) return;

  function update() {
    const now = Date.now();
    let diff, label, dotClass = '';

    if (!config.startTime) {
      timerEl.innerHTML = `<span class="timer-label">No election scheduled</span>`;
      return;
    }

    if (now < config.startTime) {
      diff  = config.startTime - now;
      label = 'Election starts in';
      dotClass = 'inactive';
    } else if (now <= config.endTime) {
      diff  = config.endTime - now;
      label = 'Voting closes in';
    } else {
      timerEl.innerHTML = `<span class="timer-label">Election has ended</span>`;
      return;
    }

    const d  = Math.floor(diff / 86400000);
    const h  = Math.floor((diff % 86400000) / 3600000);
    const m  = Math.floor((diff % 3600000)  / 60000);
    const s  = Math.floor((diff % 60000)    / 1000);

    timerEl.innerHTML = `
      <span class="timer-label">${label}</span>
      <div class="timer-segments">
        ${d ? `<span class="timer-seg">${d}d</span><span class="timer-colon">:</span>` : ''}
        <span class="timer-seg">${String(h).padStart(2,'0')}h</span>
        <span class="timer-colon">:</span>
        <span class="timer-seg">${String(m).padStart(2,'0')}m</span>
        <span class="timer-colon">:</span>
        <span class="timer-seg">${String(s).padStart(2,'0')}s</span>
      </div>
      <span class="timer-dot ${dotClass}"></span>`;
  }

  update();
  setInterval(update, 1000);
}

function showStatus(config) {
  const main = document.getElementById('vote-main');
  const now  = Date.now();
  let msg;

  if (!config.startTime) {
    msg = { icon: '🗓', title: 'No Election Scheduled',
      text: 'No election is currently scheduled. Please check back later.' };
  } else if (now < config.startTime) {
    const start = new Date(config.startTime).toLocaleString();
    msg = { icon: '⏳', title: 'Voting Not Yet Open',
      text: `The election opens on <strong>${start}</strong>. Please return then to cast your vote.` };
  } else {
    msg = { icon: '🏁', title: 'Voting Has Closed',
      text: 'The election period has ended. View the <a href="results.html">results here</a>.' };
  }

  main.innerHTML = `
    <div class="card text-center" style="max-width:480px;margin:3rem auto">
      <div style="font-size:3.5rem;margin-bottom:1rem">${msg.icon}</div>
      <h2>${msg.title}</h2>
      <p class="mt-2">${msg.text}</p>
    </div>`;
}
