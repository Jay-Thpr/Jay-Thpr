/**
 * app.js — GitHub activity analytics dashboard
 * Fetches public data from the GitHub REST API (unauthenticated, rate‑limited
 * to 60 req/hr per IP).  All charts are rendered with Chart.js.
 */

const USERNAME = 'Jay-Thpr';
const API      = 'https://api.github.com';

// ── language colour palette (subset of github/linguist colours) ──────────────
const LANG_COLORS = {
  JavaScript : '#f1e05a', TypeScript : '#3178c6', Python    : '#3572A5',
  'C++'      : '#f34b7d', C          : '#555555', Java      : '#b07219',
  HTML       : '#e34c26', CSS        : '#563d7c', Shell     : '#89e051',
  Go         : '#00ADD8', Rust       : '#dea584', Ruby      : '#701516',
  Swift      : '#F05138', Kotlin     : '#A97BFF', Dart      : '#00B4AB',
  Other      : '#8b949e',
};

function langColor(name) {
  return LANG_COLORS[name] ?? LANG_COLORS.Other;
}

// ── shared Chart.js defaults ─────────────────────────────────────────────────
Chart.defaults.color          = '#8b949e';
Chart.defaults.borderColor    = '#30363d';
Chart.defaults.font.family    = "'JetBrains Mono', 'Fira Code', monospace";
Chart.defaults.font.size      = 11;

// ── helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

function setLoading(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  if (active) {
    el.innerHTML = `<div class="loading"><div class="spinner"></div> loading…</div>`;
  }
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="error-msg">${msg}</div>`;
}

// ── stat tiles ────────────────────────────────────────────────────────────────

async function loadUserStats() {
  try {
    const user = await apiFetch(`/users/${USERNAME}`);
    document.getElementById('stat-repos').textContent   = user.public_repos ?? '—';
    document.getElementById('stat-followers').textContent = user.followers ?? '—';
    document.getElementById('stat-following').textContent = user.following ?? '—';
  } catch (e) {
    ['stat-repos','stat-followers','stat-following'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
  }
}

// ── repos ─────────────────────────────────────────────────────────────────────

async function loadRepos() {
  const tableId = 'repo-table-body';
  const countId = 'stat-commits';
  setLoading('repos-section-inner', true);

  try {
    // fetch up to 100 repos sorted by push date
    const repos = await apiFetch(
      `/users/${USERNAME}/repos?sort=pushed&per_page=100`
    );

    // ── top‑repos table ──────────────────────────────────────────────────────
    const top = [...repos]
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 10);

    const tbody = document.getElementById(tableId);
    tbody.innerHTML = top.map(r => `
      <tr>
        <td class="repo-name"><a href="${r.html_url}" target="_blank" rel="noopener">${r.name}</a></td>
        <td class="repo-desc">${r.description ?? ''}</td>
        <td>
          ${r.language
            ? `<span class="lang-dot" style="background:${langColor(r.language)}"></span>${r.language}`
            : '<span style="color:#8b949e">—</span>'}
        </td>
        <td class="stars">★ ${r.stargazers_count}</td>
      </tr>
    `).join('');

    // ── language breakdown chart ─────────────────────────────────────────────
    const langBytes = {};
    repos.forEach(r => {
      if (r.language) langBytes[r.language] = (langBytes[r.language] ?? 0) + 1;
    });

    const sortedLangs = Object.entries(langBytes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    renderLanguageChart(
      sortedLangs.map(([l]) => l),
      sortedLangs.map(([, v]) => v)
    );

    // ── activity‑over‑time chart (push dates) ────────────────────────────────
    renderActivityChart(repos);

    // ── commit frequency (last 52 weeks) ─────────────────────────────────────
    await loadCommitFrequency(repos);

    // update star count tile
    const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
    document.getElementById('stat-stars').textContent = totalStars;

  } catch (e) {
    setError('repos-section-inner', 'Could not load repository data.');
    console.error(e);
  }
}

// ── language doughnut chart ───────────────────────────────────────────────────

function renderLanguageChart(labels, data) {
  const canvas = document.getElementById('lang-chart');
  if (!canvas) return;
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map(langColor),
        borderColor     : '#161b22',
        borderWidth     : 3,
        hoverOffset     : 6,
      }],
    },
    options: {
      cutout   : '65%',
      plugins  : {
        legend : { position: 'right', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} repos`,
          },
        },
      },
    },
  });
}

// ── activity over time (monthly push count) ───────────────────────────────────

function renderActivityChart(repos) {
  const canvas = document.getElementById('activity-chart');
  if (!canvas) return;

  // bucket repos by year‑month of last push
  const monthly = {};
  repos.forEach(r => {
    if (!r.pushed_at) return;
    const ym = r.pushed_at.slice(0, 7); // "YYYY-MM"
    monthly[ym] = (monthly[ym] ?? 0) + 1;
  });

  // fill last 18 months
  const labels = [];
  const counts = [];
  const now    = new Date();

  for (let i = 17; i >= 0; i--) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(ym.slice(0, 7));   // same key
    counts.push(monthly[ym] ?? 0);
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label           : 'repo pushes',
        data            : counts,
        backgroundColor : 'rgba(63, 185, 80, 0.5)',
        borderColor     : '#3fb950',
        borderWidth     : 1,
        borderRadius    : 3,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales : {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// ── commit frequency (weekly, last 52 weeks) ──────────────────────────────────

async function loadCommitFrequency(repos) {
  const canvas = document.getElementById('commit-chart');
  if (!canvas) return;

  // pick the most‑recently pushed repo to sample commit activity
  const target = repos.find(r => !r.fork) ?? repos[0];
  if (!target) return;

  try {
    const stats = await apiFetch(
      `/repos/${USERNAME}/${target.name}/stats/participation`
    );

    const weeks  = stats.owner ?? [];
    const labels = weeks.map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (51 - i) * 7);
      return `wk ${i + 1}`;
    });

    // update commits tile
    const total = weeks.reduce((s, v) => s + v, 0);
    document.getElementById('stat-commits').textContent = total;

    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label           : 'commits / week',
          data            : weeks,
          fill            : true,
          backgroundColor : 'rgba(88, 166, 255, 0.12)',
          borderColor     : '#58a6ff',
          borderWidth     : 2,
          pointRadius     : 0,
          tension         : 0.35,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales : {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  } catch {
    // participation stats may return 202 (computing) — silently skip
  }
}

// ── top‑repos bar chart ───────────────────────────────────────────────────────

async function loadTopReposChart() {
  const canvas = document.getElementById('repos-chart');
  if (!canvas) return;

  try {
    const repos = await apiFetch(
      `/users/${USERNAME}/repos?sort=stars&per_page=10`
    );

    const top = repos
      .filter(r => r.stargazers_count > 0 || r.forks_count > 0)
      .slice(0, 8);

    if (!top.length) return;

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map(r => r.name),
        datasets: [
          {
            label           : 'stars',
            data            : top.map(r => r.stargazers_count),
            backgroundColor : 'rgba(210, 168, 255, 0.6)',
            borderColor     : '#d2a8ff',
            borderWidth     : 1,
            borderRadius    : 3,
          },
          {
            label           : 'forks',
            data            : top.map(r => r.forks_count),
            backgroundColor : 'rgba(63, 185, 80, 0.5)',
            borderColor     : '#3fb950',
            borderWidth     : 1,
            borderRadius    : 3,
          },
        ],
      },
      options: {
        plugins: { legend: { position: 'top' } },
        scales : {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  } catch (e) {
    console.error(e);
  }
}

// ── boot ─────────────────────────────────────────────────────────────────────

(async function init() {
  await Promise.allSettled([
    loadUserStats(),
    loadRepos(),
    loadTopReposChart(),
  ]);
})();
