/**
 * results.js — Election Results
 * ============================================================
 * Tallies votes, displays winners and percentages per position.
 * Accessible to both logged-in voters and admins.
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', async () => {

  const mainContent = document.getElementById('results-main');
  const titleEl     = document.getElementById('results-title');

  const [config, candidates, votes] = await Promise.all([
    getElectionConfig(), getAllCandidates(), getAllVotes()
  ]);

  if (config.title) titleEl.textContent = config.title + ' — Results';

  if (candidates.length === 0 || votes.length === 0) {
    mainContent.innerHTML = `
      <div class="card text-center" style="max-width:480px;margin:3rem auto">
        <div style="font-size:3rem;margin-bottom:1rem">📊</div>
        <h2>No Results Yet</h2>
        <p class="mt-2">Either no candidates have been added or no votes have been cast.</p>
      </div>`;
    return;
  }

  // Group candidates by position
  const byPosition = {};
  candidates.forEach(c => {
    if (!byPosition[c.position]) byPosition[c.position] = [];
    byPosition[c.position].push(c);
  });

  // Count votes per candidate
  const voteCounts = {};
  votes.forEach(v => { voteCounts[v.candidateId] = (voteCounts[v.candidateId] || 0) + 1; });

  const live = isElectionActive(config);

  // Summary banner
  const totalVotes = votes.length;
  const totalVoters = (await getAllVoters()).filter(v => !v.isAdmin).length;
  const participation = totalVoters ? Math.round(totalVotes / Object.keys(voteCounts).length / totalVoters * 100) : 0;

  const summaryEl = document.getElementById('results-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stats-grid" style="max-width:700px;margin:0 auto 2rem">
        <div class="stat-card">
          <div class="stat-icon gold">🗳</div>
          <div class="stat-info">
            <div class="stat-value">${totalVotes}</div>
            <div class="stat-label">Total Votes Cast</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">👥</div>
          <div class="stat-info">
            <div class="stat-value">${totalVoters}</div>
            <div class="stat-label">Registered Voters</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📋</div>
          <div class="stat-info">
            <div class="stat-value">${candidates.length}</div>
            <div class="stat-label">Candidates</div>
          </div>
        </div>
      </div>`;
  }

  // Render results for each position
  mainContent.innerHTML = '';

  Object.entries(byPosition).forEach(([position, cands]) => {
    const sorted = [...cands]
      .sort((a, b) => (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0));

    const total  = sorted.reduce((s, c) => s + (voteCounts[c.id] || 0), 0);
    const winner = sorted[0];
    const winnerVotes = voteCounts[winner.id] || 0;

    const maxVotes = Math.max(...sorted.map(c => voteCounts[c.id] || 0), 0);

    const section = document.createElement('div');
    section.className = 'mb-4';
    section.innerHTML = `
      <div class="position-title">${sanitize(position)}</div>
      <div style="display:grid;grid-template-columns:minmax(220px, 0.9fr) 1.4fr;gap:1.5rem;align-items:start">

        ${!live ? `
        <div class="winner-card">
          <div class="candidate-avatar" style="width:60px;height:60px;margin:0 auto 0.75rem;font-size:1.5rem">
            ${winner.photo ? `<img src="${winner.photo}" alt="">` : sanitize(winner.name[0])}
          </div>
          <div class="winner-name">${sanitize(winner.name)}</div>
          <div class="winner-meta">${sanitize(winner.party)}</div>
          <div class="winner-votes">${winnerVotes} vote${winnerVotes !== 1 ? 's' : ''}</div>
        </div>` : `
        <div class="card card-sm text-center">
          <div style="font-size:2rem;margin-bottom:0.5rem">🔴</div>
          <div style="font-size:0.85rem;color:var(--gray)">Live — winner shown after polls close</div>
        </div>`}

        <div class="card card-sm">
          <div class="results-chart-header">
            <div>
              <div class="results-chart-title">Vote Distribution</div>
              <p class="results-chart-subtitle">The tallest bar shows the current leader.</p>
            </div>
            <div class="results-chart-pill">${live ? 'Live tally' : `Leader: ${sanitize(winner.name)}`}</div>
          </div>
          <div class="results-chart">
            ${sorted.map((c, index) => {
              const count = voteCounts[c.id] || 0;
              const pct   = total ? Math.round(count / total * 100) : 0;
              const height = maxVotes ? Math.max(10, Math.round((count / maxVotes) * 100)) : 0;
              const isWinner = !live && count === winnerVotes && winnerVotes > 0;
              const colors = ['#2f7bf5', '#24a66b', '#ff8a3d', '#a66cff', '#ff5d7a', '#00c2d1'];
              const color = colors[index % colors.length];
              return `
                <div class="results-chart-bar ${isWinner ? 'winner' : ''}">
                  <div class="results-chart-track">
                    <div class="results-chart-fill" style="height:${height}%;background-color:${color};background-image:linear-gradient(180deg, ${color}, ${color})"></div>
                  </div>
                  <div class="results-chart-labels">
                    <span class="results-chart-name">${isWinner ? '🏆 ' : ''}${sanitize(c.name)}</span>
                    <span class="results-chart-meta">${count} votes • ${pct}%</span>
                  </div>
                </div>`;
            }).join('')}
          </div>
          <p class="text-sm text-gray mt-2">Total ballots: ${total}</p>
        </div>
      </div>`;

    mainContent.appendChild(section);
  });

  // Responsive: stack on small screens
  mainContent.querySelectorAll('[style*="grid-template-columns"]').forEach(el => {
    if (window.innerWidth < 640) el.style.gridTemplateColumns = '1fr';
  });
});
