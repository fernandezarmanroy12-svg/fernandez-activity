/**
 * SwitchGuard — Dead Man's Switch for Scheduled Tasks
 * High-Precision Client-Side Engine
 * Inspired by Healthchecks.io
 */

// ==========================================================================
// 1. Initial State & Showcase Preset Data
// ==========================================================================

const STORAGE_KEY = 'switchguard_checks_v1';
const AUDIO_STORAGE_KEY = 'switchguard_sound_enabled';
const OFFSET_STORAGE_KEY = 'switchguard_time_offset';

const DEFAULT_CHECKS = [
  {
    id: 'chk_101',
    uuid: '7d4f9b2a-8c11-4a92-bf35-9e32a67bc01',
    name: 'PostgreSQL Database Nightly Dump (S3)',
    desc: 'Runs pg_dumpall, encrypts with GPG, and pushes archive to AWS S3 Glacier',
    tags: ['database', 'backup', 'aws', 'production'],
    period: 86400, // 24 hours
    grace: 3600,   // 1 hour
    status: 'up',
    lastPing: Date.now() - (4 * 3600 * 1000), // 4 hours ago
    startedAt: null,
    channels: ['email', 'slack'],
    pings: generateMockPings(20, 'up', 'Postgres backup completed: 4.8 GB archived in 3m 42s')
  },
  {
    id: 'chk_102',
    uuid: 'b4a8e10c-552d-49f3-8b71-2f08a9c8002',
    name: "Let's Encrypt SSL Wildcard Auto-Renewal",
    desc: 'Certbot renewal script using Cloudflare DNS-01 challenge verification',
    tags: ['ssl', 'security', 'certs'],
    period: 604800, // 7 days
    grace: 86400,  // 24 hours
    status: 'up',
    lastPing: Date.now() - (2 * 86400 * 1000), // 2 days ago
    startedAt: null,
    channels: ['email', 'discord'],
    pings: generateMockPings(18, 'up', 'All certificates up to date; renew skipped')
  },
  {
    id: 'chk_103',
    uuid: '3e99b24f-c77a-4b92-91f0-0081bbdf003',
    name: 'Stripe Daily Settlement Reconciliation',
    desc: 'Reconciles Stripe transactions, webhooks, and ledger entries with internal DB',
    tags: ['finance', 'stripe', 'cron'],
    period: 86400, // 24 hours
    grace: 1800,   // 30 min grace
    status: 'grace', // Currently running late
    lastPing: Date.now() - (86400 * 1000 + 600 * 1000), // 24h + 10m ago (inside grace)
    startedAt: null,
    channels: ['email', 'slack', 'pagerduty'],
    pings: generateMockPings(22, 'grace', 'Settlement sync delay: waiting for Stripe webhook queue batch')
  },
  {
    id: 'chk_104',
    uuid: 'fa99321e-01cd-4389-9fa0-109033cd004',
    name: 'Customer Invoice Email Dispatch Worker',
    desc: 'Background queue processor generating monthly invoices and billing receipts',
    tags: ['billing', 'worker', 'email'],
    period: 3600, // Every 1 hour
    grace: 900,   // 15 minutes grace
    status: 'down', // Dead man's switch tripped!
    lastPing: Date.now() - (3600 * 1000 + 1200 * 1000), // Past grace deadline!
    startedAt: null,
    channels: ['email', 'slack', 'pagerduty'],
    pings: generateMockPings(20, 'down', 'FATAL: SMTP server connection timed out (port 587)')
  },
  {
    id: 'chk_105',
    uuid: '8c221190-aa33-4f51-b0e2-899144ef005',
    name: 'Redis Cache Memory Flush & Prune',
    desc: 'Cleans expired transient sessions and rolls cache keys',
    tags: ['cache', 'redis', 'maintenance'],
    period: 900,  // Every 15 mins
    grace: 300,   // 5 mins grace
    status: 'up',
    lastPing: Date.now() - (3 * 60 * 1000), // 3 mins ago
    startedAt: null,
    channels: ['discord'],
    pings: generateMockPings(25, 'up', 'OK: Evicted 1,420 keys in 12ms')
  },
  {
    id: 'chk_106',
    uuid: '6f332211-bb44-4001-a1d3-777255aa006',
    name: 'ElasticSearch Index Snapshot to Cloud',
    desc: 'Cluster health snapshot and cluster index optimization',
    tags: ['elasticsearch', 'search', 'backup'],
    period: 43200, // 12 hours
    grace: 3600,   // 1 hour
    status: 'started', // Currently executing!
    lastPing: Date.now() - (11 * 3600 * 1000),
    startedAt: Date.now() - (85 * 1000), // started 85 seconds ago
    channels: ['email', 'slack'],
    pings: generateMockPings(19, 'started', 'Snapshot repository cluster_backup_s3: snapshot_20261029 in progress')
  }
];

function generateMockPings(count, currentStatus, latestPayload) {
  const list = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    let type = 'success';
    if (i === 0 && currentStatus === 'down') type = 'fail';
    else if (i === 0 && currentStatus === 'grace') type = 'timeout';
    else if (i === 0 && currentStatus === 'started') type = 'start';
    else if (i % 7 === 0 && i !== 0) type = 'success';

    const durSec = (Math.random() * 14 + 1.2).toFixed(1);
    list.push({
      timestamp: now - (i * 3600 * 1000 * 1.5),
      type: type,
      duration: durSec + 's',
      remoteIp: '192.168.1.' + Math.floor(Math.random() * 80 + 10),
      payload: (i === 0 && latestPayload) ? latestPayload : `Job run completed successfully. Exit code: 0`
    });
  }
  return list;
}

// ==========================================================================
// 2. Global State Variables
// ==========================================================================

let checks = [];
let timeOffsetMs = 0;
let soundEnabled = true;
let currentFilter = 'all';
let currentTagFilter = null;
let searchQuery = '';
let activeModalCheckId = null;
let codeSnippetLang = 'bash';

// Web Audio API Context (Lazily created on user interaction)
let audioCtx = null;

// ==========================================================================
// 3. Audio Tone Synthesizer (Zero Dependencies)
// ==========================================================================

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
}

function playTone(type) {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const t = audioCtx.currentTime;

    if (type === 'ping' || type === 'success') {
      // Pleasant high double chime (880Hz -> 1760Hz)
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1760, t + 0.12);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    } 
    else if (type === 'start') {
      // Soft ascending tone
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, t); // C5
      osc.frequency.linearRampToValueAtTime(659.25, t + 0.15); // E5
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    else if (type === 'warning' || type === 'grace') {
      // Amber warning pulse
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.setValueAtTime(370, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
    else if (type === 'alarm' || type === 'down') {
      // Emergency two-tone siren
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(750, t);
      osc.frequency.setValueAtTime(500, t + 0.15);
      osc.frequency.setValueAtTime(750, t + 0.3);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    }
  } catch (err) {
    console.warn('Audio tone error:', err);
  }
}

// ==========================================================================
// 4. Persistence & Simulated Time
// ==========================================================================

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      checks = JSON.parse(raw);
    } else {
      checks = DEFAULT_CHECKS;
      saveState();
    }

    const rawSound = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (rawSound !== null) {
      soundEnabled = JSON.parse(rawSound);
    }

    const rawOffset = localStorage.getItem(OFFSET_STORAGE_KEY);
    if (rawOffset !== null) {
      timeOffsetMs = parseInt(rawOffset, 10) || 0;
    }
  } catch (e) {
    console.error('Failed to load state from localStorage', e);
    checks = DEFAULT_CHECKS;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(soundEnabled));
    localStorage.setItem(OFFSET_STORAGE_KEY, timeOffsetMs.toString());
  } catch (e) {
    console.error('Failed to save state to localStorage', e);
  }
}

function getSimTime() {
  return Date.now() + timeOffsetMs;
}

function updateSimTimeDisplay() {
  const simNow = new Date(getSimTime());
  const formatted = simNow.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const el = document.getElementById('current-sim-time');
  if (el) el.textContent = formatted;

  const warpBadge = document.getElementById('time-warp-badge');
  if (warpBadge) {
    if (timeOffsetMs === 0) {
      warpBadge.classList.add('hidden');
    } else {
      warpBadge.classList.remove('hidden');
      const totalMins = Math.round(timeOffsetMs / 60000);
      if (Math.abs(totalMins) >= 1440) {
        warpBadge.textContent = `${(totalMins / 1440).toFixed(1)}d`;
      } else if (Math.abs(totalMins) >= 60) {
        warpBadge.textContent = `+${(totalMins / 60).toFixed(1)}h`;
      } else {
        warpBadge.textContent = `+${totalMins}m`;
      }
    }
  }
}

// Time Machine warp controls
function warpTime(minutes) {
  initAudio();
  timeOffsetMs += minutes * 60 * 1000;
  saveState();
  updateSimTimeDisplay();
  evaluateAllDeadlines(true);
  renderChecks();
  renderStats();
  showToast(`Time warped by +${minutes >= 60 ? (minutes / 60) + 'h' : minutes + 'm'}`, 'info');
  logTelemetry('TIME_WARP', `Fast-forwarded simulated clock by ${minutes} minutes`);
}

function resetTime() {
  timeOffsetMs = 0;
  saveState();
  updateSimTimeDisplay();
  evaluateAllDeadlines(true);
  renderChecks();
  renderStats();
  showToast('Clock reset to real time', 'info');
  logTelemetry('TIME_RESET', 'Clock synchronizer restored to local hardware clock');
}

// ==========================================================================
// 5. Dead Man's Switch State Machine Engine
// ==========================================================================

function evaluateCheckStatus(chk) {
  if (chk.status === 'paused') return 'paused';
  if (!chk.lastPing) return 'new';

  const now = getSimTime();
  const periodMs = chk.period * 1000;
  const graceMs = chk.grace * 1000;

  const expectedTime = chk.lastPing + periodMs;
  const graceDeadline = expectedTime + graceMs;

  if (now <= expectedTime) {
    return chk.startedAt ? 'started' : 'up';
  } else if (now <= graceDeadline) {
    return 'grace';
  } else {
    return 'down';
  }
}

function evaluateAllDeadlines(forceSound = false) {
  let downTransitionDetected = false;
  let graceTransitionDetected = false;

  checks.forEach(chk => {
    if (chk.status === 'paused') return;

    const oldStatus = chk.status;
    const newStatus = evaluateCheckStatus(chk);

    if (oldStatus !== newStatus) {
      chk.status = newStatus;
      chk.stateChangedAt = getSimTime();

      if (newStatus === 'grace') {
        graceTransitionDetected = true;
        logTelemetry('GRACE_WARNING', `Check "${chk.name}" missed expected ping deadline. Grace countdown active.`);
        showToast(`Grace warning: "${chk.name}" is late!`, 'warning');
      } else if (newStatus === 'down') {
        downTransitionDetected = true;
        // Record missed ping in history
        if (!chk.pings) chk.pings = [];
        chk.pings.unshift({
          timestamp: getSimTime(),
          type: 'timeout',
          duration: '0s',
          remoteIp: 'system.switchguard',
          payload: `DEAD MAN'S SWITCH TRIPPED: Missed expected period (${formatDuration(chk.period)}) + grace (${formatDuration(chk.grace)})`
        });
        if (chk.pings.length > 30) chk.pings.pop();

        logTelemetry('SWITCH_TRIPPED', `DEAD MAN'S SWITCH TRIPPED on "${chk.name}"! Alert channels notified.`);
        showToast(`ALERT: Dead Man's Switch tripped on "${chk.name}"!`, 'danger');
      }
    }
  });

  if (downTransitionDetected && (soundEnabled || forceSound)) {
    playTone('alarm');
  } else if (graceTransitionDetected && (soundEnabled || forceSound)) {
    playTone('warning');
  }

  saveState();
}

// ==========================================================================
// 6. Formatting & Helper Functions
// ==========================================================================

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const now = getSimTime();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatExactDate(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function getCountdownDetails(chk) {
  if (chk.status === 'paused') {
    return { label: 'PAUSED', text: 'Monitoring off', cls: 'paused' };
  }
  if (!chk.lastPing) {
    return { label: 'NEW', text: 'Waiting for 1st ping', cls: 'up' };
  }

  const now = getSimTime();
  const periodMs = chk.period * 1000;
  const graceMs = chk.grace * 1000;
  const expectedTime = chk.lastPing + periodMs;
  const graceDeadline = expectedTime + graceMs;

  if (chk.status === 'started') {
    const elapsedSec = Math.floor((now - (chk.startedAt || chk.lastPing)) / 1000);
    return { label: 'RUNNING', text: `Elapsed: ${formatDuration(elapsedSec)}`, cls: 'started' };
  }

  if (now <= expectedTime) {
    const remainingSec = Math.max(0, Math.floor((expectedTime - now) / 1000));
    return { label: 'EXPECTED IN', text: formatDuration(remainingSec), cls: 'up' };
  } else if (now <= graceDeadline) {
    const graceRemainingSec = Math.max(0, Math.floor((graceDeadline - now) / 1000));
    return { label: 'GRACE ENDS IN', text: formatDuration(graceRemainingSec), cls: 'grace' };
  } else {
    const overdueSec = Math.floor((now - graceDeadline) / 1000);
    return { label: 'TRIPPED OVERDUE', text: `+${formatDuration(overdueSec)}`, cls: 'down' };
  }
}

// Generate unique base Ping URL
function getBasePingUrl(uuid) {
  const loc = window.location;
  // If served via http://localhost/track/
  if (loc.protocol.startsWith('http')) {
    const path = loc.pathname.replace(/\/[^/]*$/, '/');
    return `${loc.origin}${path}ping.html?uuid=${uuid}`;
  }
  // Fallback for file:// preview
  return `http://localhost/track/ping.html?uuid=${uuid}`;
}

// ==========================================================================
// 7. Telemetry & Toast Notifications
// ==========================================================================

function logTelemetry(type, message) {
  const feed = document.getElementById('live-telemetry-feed');
  if (!feed) return;

  const simNow = new Date(getSimTime());
  const timeStr = simNow.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let badgeCls = 'badge-success';
  if (type === 'SWITCH_TRIPPED' || type === 'FAIL') badgeCls = 'badge-fail';
  else if (type === 'GRACE_WARNING') badgeCls = 'badge-grace';
  else if (type === 'START') badgeCls = 'badge-start';
  else if (type === 'TIME_WARP' || type === 'TIME_RESET') badgeCls = 'badge-grace';

  const row = document.createElement('div');
  row.className = 'log-line';
  row.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-tag-badge ${badgeCls}">${type}</span>
    <span class="log-text">${escapeHtml(message)}</span>
  `;

  feed.prepend(row);

  // Keep feed bounded to 60 rows
  while (feed.children.length > 60) {
    feed.removeChild(feed.lastChild);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  let title = 'Information';
  if (type === 'success') { icon = '✅'; title = 'Success'; }
  else if (type === 'warning') { icon = '⚠️'; title = 'Warning'; }
  else if (type === 'danger') { icon = '🚨'; title = 'Emergency Alert'; }

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// 8. Ping Actions & Simulation
// ==========================================================================

function triggerPing(chkId, actionType = 'success', customPayload = null) {
  initAudio();
  const chk = checks.find(c => c.id === chkId);
  if (!chk) return;

  const now = getSimTime();

  if (actionType === 'start') {
    chk.startedAt = now;
    chk.status = 'started';
    playTone('start');

    if (!chk.pings) chk.pings = [];
    chk.pings.unshift({
      timestamp: now,
      type: 'start',
      duration: 'running...',
      remoteIp: '127.0.0.1',
      payload: customPayload || 'Task started signal received (/start)'
    });
    logTelemetry('START', `Signal /start received for "${chk.name}"`);
    showToast(`Started signal logged for "${chk.name}"`, 'info');
  } 
  else if (actionType === 'fail') {
    chk.status = 'down';
    playTone('alarm');

    if (!chk.pings) chk.pings = [];
    chk.pings.unshift({
      timestamp: now,
      type: 'fail',
      duration: chk.startedAt ? `${((now - chk.startedAt) / 1000).toFixed(1)}s` : '0s',
      remoteIp: '127.0.0.1',
      payload: customPayload || 'Task failed with non-zero exit code (exit status 1)'
    });
    chk.startedAt = null;
    logTelemetry('FAIL', `Explicit failure signal received for "${chk.name}"`);
    showToast(`Failure signal recorded for "${chk.name}"`, 'danger');
  } 
  else {
    // Regular Success Ping
    let duration = '0.4s';
    if (chk.startedAt) {
      duration = `${((now - chk.startedAt) / 1000).toFixed(1)}s`;
    }

    chk.lastPing = now;
    chk.startedAt = null;
    chk.status = 'up';
    playTone('ping');

    if (!chk.pings) chk.pings = [];
    chk.pings.unshift({
      timestamp: now,
      type: 'success',
      duration: duration,
      remoteIp: '127.0.0.1',
      payload: customPayload || 'Ping received. HTTP 200 OK.'
    });
    logTelemetry('SUCCESS', `Dead Man's Switch ping received for "${chk.name}" (${duration})`);
    showToast(`Ping registered: "${chk.name}" is healthy!`, 'success');
  }

  if (chk.pings.length > 30) {
    chk.pings.pop();
  }

  saveState();
  renderChecks();
  renderStats();
}

function pingAllActive() {
  initAudio();
  checks.forEach(chk => {
    if (chk.status !== 'paused') {
      const now = getSimTime();
      chk.lastPing = now;
      chk.startedAt = null;
      chk.status = 'up';
      if (!chk.pings) chk.pings = [];
      chk.pings.unshift({
        timestamp: now,
        type: 'success',
        duration: '0.8s',
        remoteIp: '127.0.0.1',
        payload: 'Batch ping all signal received'
      });
      if (chk.pings.length > 30) chk.pings.pop();
    }
  });

  playTone('ping');
  saveState();
  renderChecks();
  renderStats();
  showToast('All active switches pinged successfully!', 'success');
  logTelemetry('BATCH_PING', 'Simulated batch ping dispatched to all active checks');
}

// ==========================================================================
// 9. Rendering Dashboard UI
// ==========================================================================

function renderStats() {
  const counts = { up: 0, grace: 0, down: 0, paused: 0, total: checks.length };

  checks.forEach(c => {
    if (c.status === 'up' || c.status === 'started') counts.up++;
    else if (c.status === 'grace') counts.grace++;
    else if (c.status === 'down') counts.down++;
    else if (c.status === 'paused') counts.paused++;
  });

  document.getElementById('count-up').textContent = counts.up;
  document.getElementById('count-grace').textContent = counts.grace;
  document.getElementById('count-down').textContent = counts.down;
  document.getElementById('count-total').textContent = counts.total;

  document.getElementById('tab-count-all').textContent = counts.total;
  document.getElementById('tab-count-up').textContent = counts.up;
  document.getElementById('tab-count-grace').textContent = counts.grace;
  document.getElementById('tab-count-down').textContent = counts.down;
  document.getElementById('tab-count-paused').textContent = counts.paused;

  // Render Tag Chips
  renderTagChips();
}

function renderTagChips() {
  const container = document.getElementById('tag-chips-container');
  if (!container) return;

  const tagSet = new Set();
  checks.forEach(c => {
    if (c.tags && Array.isArray(c.tags)) {
      c.tags.forEach(t => tagSet.add(t.toLowerCase().trim()));
    }
  });

  container.innerHTML = '';
  
  const allChip = document.createElement('button');
  allChip.className = `tag-chip ${currentTagFilter === null ? 'active' : ''}`;
  allChip.textContent = 'All Tags';
  allChip.addEventListener('click', () => {
    currentTagFilter = null;
    renderChecks();
    renderTagChips();
  });
  container.appendChild(allChip);

  Array.from(tagSet).sort().forEach(tag => {
    const chip = document.createElement('button');
    chip.className = `tag-chip ${currentTagFilter === tag ? 'active' : ''}`;
    chip.textContent = `#${tag}`;
    chip.addEventListener('click', () => {
      currentTagFilter = (currentTagFilter === tag) ? null : tag;
      renderChecks();
      renderTagChips();
    });
    container.appendChild(chip);
  });
}

function renderChecks() {
  const listEl = document.getElementById('checks-list');
  const emptyEl = document.getElementById('empty-state');
  if (!listEl) return;

  // Filter checks
  const filtered = checks.filter(chk => {
    // Status filter
    if (currentFilter === 'up' && chk.status !== 'up' && chk.status !== 'started') return false;
    if (currentFilter === 'grace' && chk.status !== 'grace') return false;
    if (currentFilter === 'down' && chk.status !== 'down') return false;
    if (currentFilter === 'paused' && chk.status !== 'paused') return false;

    // Tag filter
    if (currentTagFilter && (!chk.tags || !chk.tags.map(t => t.toLowerCase()).includes(currentTagFilter))) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = chk.name.toLowerCase().includes(q);
      const matchDesc = chk.desc && chk.desc.toLowerCase().includes(q);
      const matchUuid = chk.uuid && chk.uuid.toLowerCase().includes(q);
      const matchTags = chk.tags && chk.tags.some(t => t.toLowerCase().includes(q));
      if (!matchName && !matchDesc && !matchUuid && !matchTags) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.innerHTML = '';

  filtered.forEach(chk => {
    const card = document.createElement('div');
    card.className = `check-card status-${chk.status}`;
    card.dataset.id = chk.id;

    const countdown = getCountdownDetails(chk);

    // Render Timeline 20-run ribbon slices
    const pings = chk.pings || [];
    const ribbonSlots = 20;
    let ribbonHtml = '';

    for (let i = ribbonSlots - 1; i >= 0; i--) {
      const p = pings[i];
      if (p) {
        let sliceCls = 'slice-up';
        if (p.type === 'fail' || p.type === 'timeout') sliceCls = 'slice-down';
        else if (p.type === 'grace') sliceCls = 'slice-grace';
        else if (p.type === 'start') sliceCls = 'slice-start';

        ribbonHtml += `
          <div class="timeline-slice ${sliceCls}" 
               title="${formatExactDate(p.timestamp)} | ${p.type.toUpperCase()} | Duration: ${p.duration}">
          </div>
        `;
      } else {
        ribbonHtml += `<div class="timeline-slice slice-empty" title="No recorded run"></div>`;
      }
    }

    // Render Tag Badges
    const tagsHtml = (chk.tags || []).map(t => `<span class="check-tag-badge">#${escapeHtml(t)}</span>`).join('');

    card.innerHTML = `
      <!-- Status Column -->
      <div class="col-status-cell">
        <div class="status-radar" title="Status: ${chk.status.toUpperCase()}">
          <div class="status-radar-center"></div>
          ${chk.status !== 'paused' ? '<div class="status-radar-ring"></div>' : ''}
        </div>
        <span class="status-badge-mini status-${chk.status}">${chk.status}</span>
      </div>

      <!-- Info Column -->
      <div class="col-info-cell">
        <div class="check-title-row">
          <a href="#" class="check-name" data-action="open-integ">${escapeHtml(chk.name)}</a>
        </div>
        <div class="check-desc">${escapeHtml(chk.desc || 'No description provided.')}</div>
        <div class="check-tags-row">${tagsHtml}</div>
      </div>

      <!-- Schedule & Grace Column -->
      <div class="col-schedule-cell">
        <span class="schedule-period">Every ${formatDuration(chk.period)}</span>
        <span class="schedule-grace">Grace: ${formatDuration(chk.grace)}</span>
      </div>

      <!-- Last Ping Column -->
      <div class="col-lastping-cell">
        <span class="lastping-relative">${formatRelativeTime(chk.lastPing)}</span>
        <span class="lastping-absolute">${formatExactDate(chk.lastPing)}</span>
      </div>

      <!-- Dead Man's Switch Countdown Column -->
      <div class="col-countdown-cell">
        <div class="countdown-box ${countdown.cls}">
          <span class="countdown-status-lbl">${countdown.label}</span>
          <span class="countdown-digits">${countdown.text}</span>
        </div>
      </div>

      <!-- Recent 20 Runs Timeline Column -->
      <div class="col-timeline-cell">
        <div class="ping-ribbon-bar">
          ${ribbonHtml}
        </div>
        <div class="ribbon-summary">
          <span>&larr; Older</span>
          <span>Latest &rarr;</span>
        </div>
      </div>

      <!-- Actions Column -->
      <div class="col-actions-cell">
        <button class="action-btn-ping" data-action="quick-ping" title="Send a successful ping now">
          Ping
        </button>
        <button class="action-btn-integ" data-action="open-integ" title="View Code Snippets & URL">
          Code
        </button>
        <button class="action-btn-more" data-action="open-logs" title="View Ping Logs & Payload Audit">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
        </button>
        <button class="action-btn-more" data-action="edit-check" title="Edit check settings">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      </div>
    `;

    // Event delegation on card buttons
    card.querySelector('[data-action="quick-ping"]').addEventListener('click', (e) => {
      e.stopPropagation();
      triggerPing(chk.id, 'success');
    });

    card.querySelectorAll('[data-action="open-integ"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openIntegrationModal(chk.id);
      });
    });

    card.querySelector('[data-action="open-logs"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openLogsModal(chk.id);
    });

    card.querySelector('[data-action="edit-check"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditCheckModal(chk.id);
    });

    listEl.appendChild(card);
  });
}

// ==========================================================================
// 10. Modals Management & Code Generator
// ==========================================================================

function openModal(modalId) {
  initAudio();
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('hidden');
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
}

// ---------------------------------------------------------
// Integration Guide & Code Snippets Modal
// ---------------------------------------------------------

function openIntegrationModal(chkId) {
  const chk = checks.find(c => c.id === chkId);
  if (!chk) return;
  activeModalCheckId = chkId;

  document.getElementById('modal-integ-name').textContent = chk.name;
  const pingUrl = getBasePingUrl(chk.uuid);
  document.getElementById('integ-ping-url').textContent = pingUrl;

  updateCodeSnippet(chk, codeSnippetLang);
  openModal('modal-integration');
}

function updateCodeSnippet(chk, lang) {
  const pingUrl = getBasePingUrl(chk.uuid);
  const codeBlock = document.getElementById('code-snippet-display');
  const descBlock = document.getElementById('code-snippet-desc');

  let snippet = '';
  let desc = '';

  switch (lang) {
    case 'bash':
      desc = 'Simple exit-code based ping in Bash / Shell:';
      snippet = `# 1. Signal task completed successfully:
/path/to/backup.sh && curl -fsS -m 10 --retry 5 -o /dev/null "${pingUrl}"

# 2. Or capture job duration (measure start to finish):
curl -fsS -m 10 -o /dev/null "${pingUrl}&action=start"
/path/to/backup.sh
if [ $? -eq 0 ]; then
    curl -fsS -m 10 -o /dev/null "${pingUrl}&action=success"
else
    curl -fsS -m 10 -o /dev/null "${pingUrl}&action=fail"
fi

# 3. Sending stdout/stderr execution log snippet:
LOG=$(/path/to/backup.sh 2>&1)
curl -fsS -m 10 --data-raw "$LOG" "${pingUrl}"`;
      break;

    case 'python':
      desc = 'Python zero-dependency standard library snippet:';
      snippet = `import urllib.request
import time

# 1. Signal start (optional: measures execution duration)
try:
    urllib.request.urlopen("${pingUrl}&action=start", timeout=10)
except Exception as e:
    pass

# Execute your critical payload
try:
    print("Executing scheduled task...")
    # ... your core logic here ...
    
    # Signal success
    urllib.request.urlopen("${pingUrl}&action=success", timeout=10)
    print("Healthcheck reported: OK")
except Exception as err:
    # Signal task failure
    urllib.request.urlopen("${pingUrl}&action=fail", timeout=10)
    raise err`;
      break;

    case 'powershell':
      desc = 'Windows PowerShell scheduled task command:';
      snippet = `# PowerShell 5.1 / 7+ compatible snippet:
try {
    # Run your task
    & "C:\\Scripts\\NightlyBackup.ps1"
    
    # Ping Dead Man's Switch on success
    Invoke-RestMethod -Uri "${pingUrl}" -Method Get -TimeoutSec 10
    Write-Host "Dead Man's Switch reported OK"
} catch {
    # Report failure
    Invoke-RestMethod -Uri "${pingUrl}&action=fail" -Method Get -TimeoutSec 10
    throw $_
}`;
      break;

    case 'node':
      desc = 'Node.js modern async/await snippet:';
      snippet = `// Node.js 18+ native fetch
async function runMonitoredTask() {
  const pingUrl = "${pingUrl}";

  try {
    // Notify task started
    await fetch(pingUrl + "&action=start");

    // Execute background worker logic
    await performHeavyJob();

    // Signal healthy completion
    await fetch(pingUrl + "&action=success");
  } catch (error) {
    // Signal failure
    await fetch(pingUrl + "&action=fail");
    console.error("Job failed:", error);
    process.exit(1);
  }
}

runMonitoredTask();`;
      break;

    case 'cron':
      desc = 'Direct crontab entry for Linux/macOS:';
      snippet = `# Edit with: crontab -e
# Runs every day at 03:00 AM, and pings switch on success (exit code 0):
0 3 * * * /usr/local/bin/backup.sh && curl -fsS -m 10 --retry 3 "${pingUrl}" > /dev/null 2>&1`;
      break;

    case 'docker':
      desc = 'Docker Container HEALTHCHECK directive:';
      snippet = `# Add to your Dockerfile:
HEALTHCHECK --interval=${formatDuration(chk.period)} --timeout=10s --retries=3 \\
  CMD curl -fsS "${pingUrl}" || exit 1`;
      break;
  }

  descBlock.textContent = desc;
  codeBlock.textContent = snippet;
}

// ---------------------------------------------------------
// Ping History Logs Modal
// ---------------------------------------------------------

function openLogsModal(chkId) {
  const chk = checks.find(c => c.id === chkId);
  if (!chk) return;
  activeModalCheckId = chkId;

  document.getElementById('modal-logs-name').textContent = chk.name;

  const pings = chk.pings || [];
  document.getElementById('log-stat-count').textContent = pings.length;
  document.getElementById('log-stat-last-status').textContent = chk.status.toUpperCase();
  
  // Calculate avg duration
  let sumDur = 0;
  let validDurs = 0;
  let failures = 0;
  pings.forEach(p => {
    if (p.type === 'fail' || p.type === 'timeout') failures++;
    const durMatch = parseFloat(p.duration);
    if (!isNaN(durMatch)) {
      sumDur += durMatch;
      validDurs++;
    }
  });

  document.getElementById('log-stat-avg-duration').textContent = validDurs ? `${(sumDur / validDurs).toFixed(1)}s` : '—';
  document.getElementById('log-stat-failures').textContent = failures;

  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';

  if (pings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No ping events recorded yet.</td></tr>`;
  } else {
    pings.forEach(p => {
      const tr = document.createElement('tr');
      let typeBadge = `<span class="log-tag-badge badge-success">SUCCESS</span>`;
      if (p.type === 'start') typeBadge = `<span class="log-tag-badge badge-start">START</span>`;
      else if (p.type === 'fail') typeBadge = `<span class="log-tag-badge badge-fail">FAIL</span>`;
      else if (p.type === 'timeout') typeBadge = `<span class="log-tag-badge badge-down">TIMEOUT</span>`;

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); color: var(--text-muted);">${formatExactDate(p.timestamp)}</td>
        <td>${typeBadge}</td>
        <td style="font-family: var(--font-mono);">${escapeHtml(p.duration || '0s')}</td>
        <td style="font-family: var(--font-mono);">${escapeHtml(p.remoteIp || '127.0.0.1')}</td>
        <td style="font-family: var(--font-mono); font-size: 0.74rem;">${escapeHtml(p.payload || 'OK')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  openModal('modal-logs');
}

// ---------------------------------------------------------
// Add / Edit Check Modal
// ---------------------------------------------------------

function openNewCheckModal() {
  document.getElementById('modal-check-title').textContent = "Add New Dead Man's Switch";
  document.getElementById('modal-check-icon').textContent = '➕';
  document.getElementById('input-check-id').value = '';
  document.getElementById('input-check-name').value = '';
  document.getElementById('input-check-desc').value = '';
  document.getElementById('input-check-tags').value = '';
  document.getElementById('input-check-period').value = '86400';
  document.getElementById('input-check-grace').value = '900';
  document.getElementById('custom-period-wrap').classList.add('hidden');
  document.getElementById('custom-grace-wrap').classList.add('hidden');

  openModal('modal-check');
}

function openEditCheckModal(chkId) {
  const chk = checks.find(c => c.id === chkId);
  if (!chk) return;

  document.getElementById('modal-check-title').textContent = "Edit Dead Man's Switch";
  document.getElementById('modal-check-icon').textContent = '⚙️';
  document.getElementById('input-check-id').value = chk.id;
  document.getElementById('input-check-name').value = chk.name;
  document.getElementById('input-check-desc').value = chk.desc || '';
  document.getElementById('input-check-tags').value = (chk.tags || []).join(', ');

  const periodSelect = document.getElementById('input-check-period');
  if (['60', '300', '900', '1800', '3600', '21600', '43200', '86400', '604800'].includes(chk.period.toString())) {
    periodSelect.value = chk.period.toString();
    document.getElementById('custom-period-wrap').classList.add('hidden');
  } else {
    periodSelect.value = 'custom';
    document.getElementById('custom-period-wrap').classList.remove('hidden');
    document.getElementById('input-custom-period').value = chk.period;
  }

  const graceSelect = document.getElementById('input-check-grace');
  if (['60', '300', '900', '1800', '3600', '7200', '86400'].includes(chk.grace.toString())) {
    graceSelect.value = chk.grace.toString();
    document.getElementById('custom-grace-wrap').classList.add('hidden');
  } else {
    graceSelect.value = 'custom';
    document.getElementById('custom-grace-wrap').classList.remove('hidden');
    document.getElementById('input-custom-grace').value = chk.grace;
  }

  openModal('modal-check');
}

function saveCheckForm(e) {
  e.preventDefault();

  const idInput = document.getElementById('input-check-id').value;
  const name = document.getElementById('input-check-name').value.trim();
  const desc = document.getElementById('input-check-desc').value.trim();
  const tagsRaw = document.getElementById('input-check-tags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  let period = parseInt(document.getElementById('input-check-period').value, 10);
  if (isNaN(period)) {
    period = parseInt(document.getElementById('input-custom-period').value, 10) || 86400;
  }

  let grace = parseInt(document.getElementById('input-check-grace').value, 10);
  if (isNaN(grace)) {
    grace = parseInt(document.getElementById('input-custom-grace').value, 10) || 900;
  }

  if (idInput) {
    // Edit existing
    const chk = checks.find(c => c.id === idInput);
    if (chk) {
      chk.name = name;
      chk.desc = desc;
      chk.tags = tags;
      chk.period = period;
      chk.grace = grace;
      showToast(`Updated check "${name}"`, 'success');
      logTelemetry('CONFIG', `Updated configuration for "${name}"`);
    }
  } else {
    // Create new
    const newId = 'chk_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const newUuid = generateUuid();
    const newCheck = {
      id: newId,
      uuid: newUuid,
      name: name,
      desc: desc,
      tags: tags,
      period: period,
      grace: grace,
      status: 'up',
      lastPing: getSimTime(),
      startedAt: null,
      channels: ['email', 'slack'],
      pings: [{
        timestamp: getSimTime(),
        type: 'success',
        duration: '0.1s',
        remoteIp: '127.0.0.1',
        payload: 'Switch initialized and operational'
      }]
    };
    checks.unshift(newCheck);
    showToast(`Created new Dead Man's Switch "${name}"`, 'success');
    logTelemetry('CREATED', `Initialized new switch "${name}" with period ${formatDuration(period)}`);
  }

  saveState();
  closeModal('modal-check');
  renderChecks();
  renderStats();
}

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================================================
// 11. Event Listeners Setup
// ==========================================================================

function setupEventListeners() {
  // Sound toggle button
  const soundBtn = document.getElementById('btn-sound-toggle');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      initAudio();
      soundEnabled = !soundEnabled;
      document.getElementById('icon-sound-on').classList.toggle('hidden', !soundEnabled);
      document.getElementById('icon-sound-off').classList.toggle('hidden', soundEnabled);
      saveState();
      if (soundEnabled) playTone('ping');
      showToast(`Audio alerts ${soundEnabled ? 'enabled' : 'muted'}`, 'info');
    });
  }

  // Time Machine Warping
  document.getElementById('btn-warp-5m').addEventListener('click', () => warpTime(5));
  document.getElementById('btn-warp-1h').addEventListener('click', () => warpTime(60));
  document.getElementById('btn-warp-1d').addEventListener('click', () => warpTime(1440));
  document.getElementById('btn-reset-time').addEventListener('click', resetTime);

  // New Check Button
  document.getElementById('btn-new-check').addEventListener('click', openNewCheckModal);

  // Alert Channels Modal Button
  document.getElementById('btn-channels-modal').addEventListener('click', () => {
    openModal('modal-channels');
  });

  // Test Channels
  document.querySelectorAll('.btn-channel-test').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.test;
      showToast(`Simulated dispatch to ${type.toUpperCase()} successful!`, 'success');
      logTelemetry('DISPATCH_TEST', `Test notification payload delivered to channel: ${type}`);
    });
  });

  // Batch Ping All
  document.getElementById('btn-quick-ping-all').addEventListener('click', pingAllActive);

  // Reset Demo Data
  document.getElementById('btn-reset-demo').addEventListener('click', () => {
    if (confirm('Reset checks back to initial showcase demo data?')) {
      checks = DEFAULT_CHECKS;
      timeOffsetMs = 0;
      saveState();
      renderChecks();
      renderStats();
      updateSimTimeDisplay();
      showToast('Demo data restored', 'info');
      logTelemetry('RESET_DEMO', 'Restored default showcase Dead Man\'s Switches');
    }
  });

  // Clear Feed
  document.getElementById('btn-clear-feed').addEventListener('click', () => {
    const feed = document.getElementById('live-telemetry-feed');
    if (feed) feed.innerHTML = '';
  });

  // Search Input
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      searchClearBtn.classList.toggle('hidden', !searchQuery);
      renderChecks();
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchQuery = '';
      searchInput.value = '';
      searchClearBtn.classList.add('hidden');
      renderChecks();
    });
  }

  // Filter Tabs
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderChecks();
    });
  });

  // Empty state clear filter
  document.getElementById('btn-empty-clear').addEventListener('click', () => {
    currentFilter = 'all';
    currentTagFilter = null;
    searchQuery = '';
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-all').classList.add('active');
    renderChecks();
    renderTagChips();
  });

  // Check Form submit
  document.getElementById('form-check').addEventListener('submit', saveCheckForm);

  // Custom period/grace select triggers
  document.getElementById('input-check-period').addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('custom-period-wrap').classList.toggle('hidden', !isCustom);
  });
  document.getElementById('input-check-grace').addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('custom-grace-wrap').classList.toggle('hidden', !isCustom);
  });

  // Code Tab switching in Integration modal
  document.querySelectorAll('.code-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      codeSnippetLang = tab.dataset.lang;
      const chk = checks.find(c => c.id === activeModalCheckId);
      if (chk) updateCodeSnippet(chk, codeSnippetLang);
    });
  });

  // Copy Endpoint URL
  document.getElementById('btn-copy-url').addEventListener('click', () => {
    const url = document.getElementById('integ-ping-url').textContent;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Ping URL copied to clipboard!', 'info');
    });
  });

  // Copy Code Snippet
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('code-snippet-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Code snippet copied to clipboard!', 'info');
    });
  });

  // Sandbox Buttons in Integration modal
  document.getElementById('btn-sandbox-success').addEventListener('click', () => {
    if (activeModalCheckId) triggerPing(activeModalCheckId, 'success', 'Sandbox manual success ping');
  });
  document.getElementById('btn-sandbox-start').addEventListener('click', () => {
    if (activeModalCheckId) triggerPing(activeModalCheckId, 'start', 'Sandbox manual job start signal');
  });
  document.getElementById('btn-sandbox-fail').addEventListener('click', () => {
    if (activeModalCheckId) triggerPing(activeModalCheckId, 'fail', 'Sandbox manual job crash / fail signal');
  });
  document.getElementById('btn-sandbox-force-down').addEventListener('click', () => {
    const chk = checks.find(c => c.id === activeModalCheckId);
    if (!chk) return;
    // Set lastPing far into past
    const overdue = (chk.period + chk.grace + 120) * 1000;
    chk.lastPing = getSimTime() - overdue;
    evaluateAllDeadlines(true);
    renderChecks();
    renderStats();
    showToast(`Tripped Dead Man's Switch for "${chk.name}"!`, 'danger');
  });

  // Clear Task Logs button
  document.getElementById('btn-clear-task-logs').addEventListener('click', () => {
    const chk = checks.find(c => c.id === activeModalCheckId);
    if (chk) {
      chk.pings = [];
      saveState();
      openLogsModal(chk.id);
      renderChecks();
      showToast('Logs cleared for this switch', 'info');
    }
  });

  // Modal Close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close modals on clicking backdrop
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeAllModals();
    });
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // Listen to Storage events from external ping receiver (e.g. ping.html)
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      loadState();
      renderChecks();
      renderStats();
      logTelemetry('REMOTE_PING', 'External HTTP ping registered via ping receiver endpoint');
    }
  });
}

// ==========================================================================
// 12. Main Ticker Loop & Initialization
// ==========================================================================

function startTicker() {
  // Real-time evaluation loop every 1000ms
  setInterval(() => {
    updateSimTimeDisplay();
    evaluateAllDeadlines(false);
    renderChecks();
    renderStats();
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  setupEventListeners();
  updateSimTimeDisplay();
  evaluateAllDeadlines(false);
  renderChecks();
  renderStats();
  startTicker();

  // Initial welcome telemetry
  logTelemetry('INIT', 'SwitchGuard Dead Man\'s Switch Engine started. Listening for incoming pings.');
});
