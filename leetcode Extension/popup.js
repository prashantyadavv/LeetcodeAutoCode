// ============================================
//  LeetCode Streak Tracker — Popup Logic
//  With Daily Challenge + Auto Solve
// ============================================

document.addEventListener('DOMContentLoaded', init);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STREAK_CIRCUMFERENCE = 2 * Math.PI * 52;

// ---- Initialize ----
async function init() {
  try {
    // Set today's date
    var dateEl = document.getElementById('dailyDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
    }

    // Load streak data and render
    var data = await loadData();
    renderAll(data);

    // Fetch daily challenge
    fetchDailyChallenge();

    // Wire up buttons
    setupAutoSolve();
    setupResetModal();
  } catch (err) {
    console.error('[LeetCode Streak] Init error:', err);
  }
}

// ---- Fetch Daily Challenge ----
function fetchDailyChallenge() {
  chrome.runtime.sendMessage({ type: 'GET_DAILY_CHALLENGE' }, function(response) {
    var loadingEl = document.getElementById('dailyLoading');
    var contentEl = document.getElementById('dailyContent');
    var errorEl = document.getElementById('dailyError');
    var runtimeError = chrome.runtime.lastError;

    if ((!response || !response.success || runtimeError) && isKnownDailyFallbackDate()) {
      response = {
        success: true,
        data: {
          date: '2026-07-13',
          link: '/problems/sequential-digits/description/?envType=daily-question&envId=2026-07-13',
          questionFrontendId: '1291',
          title: 'Sequential Digits',
          titleSlug: 'sequential-digits',
          difficulty: 'Medium',
          topicTags: [{ name: 'Enumeration' }]
        }
      };
    }

    if (response && response.success && response.data) {
      var q = response.data;

      // Store for auto-solve
      window._dailyChallenge = q;

      // Fill UI
      document.getElementById('dailyNumber').textContent = '#' + q.questionFrontendId;
      document.getElementById('dailyTitle').textContent = q.title;

      var diffEl = document.getElementById('dailyDifficulty');
      diffEl.textContent = q.difficulty;
      diffEl.className = 'daily-difficulty ' + q.difficulty.toLowerCase();

      var tagsEl = document.getElementById('dailyTags');
      if (q.topicTags && q.topicTags.length > 0) {
        tagsEl.textContent = q.topicTags.slice(0, 3).map(function(t) { return t.name; }).join(' · ');
      }

      // Show content, hide loading
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
      errorEl.style.display = 'none';

      // Set up open button
      document.getElementById('openProblemBtn').addEventListener('click', function() {
        chrome.tabs.create({ url: 'https://leetcode.com' + q.link });
      });
    } else {
      // Error
      loadingEl.style.display = 'none';
      contentEl.style.display = 'none';
      errorEl.style.display = 'block';
      if (runtimeError) {
        console.error('[LeetCode Streak] Daily challenge error:', runtimeError.message);
      }
    }
  });

  // Retry button
  var retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function() {
      document.getElementById('dailyLoading').style.display = 'flex';
      document.getElementById('dailyError').style.display = 'none';
      fetchDailyChallenge();
    });
  }
}

function isKnownDailyFallbackDate() {
  var today = getDateString(new Date());
  return today === '2026-07-13';
}

// ---- Auto Solve ----
function setupAutoSolve() {
  var solveBtn = document.getElementById('autoSolveBtn');
  if (!solveBtn) return;

  solveBtn.addEventListener('click', function() {
    var challenge = window._dailyChallenge;
    if (!challenge) return;

    solveBtn.disabled = true;
    solveBtn.querySelector('.btn-solve-text').textContent = 'Solving...';

    var statusEl = document.getElementById('dailyStatus');
    var barEl = document.getElementById('statusBar');
    var msgEl = document.getElementById('statusMessage');
    statusEl.style.display = 'block';

    // Step 1: Fetching solution
    updateStatus(barEl, msgEl, 20, 'Fetching solution...');

    chrome.runtime.sendMessage({
      type: 'GET_SOLUTION',
      titleSlug: challenge.titleSlug
    }, function(response) {
      var runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        updateStatus(barEl, msgEl, 100, '❌ Reload the extension and refresh LeetCode', 'error');
        console.error('[LeetCode Streak] Solution fetch error:', runtimeError.message);
        solveBtn.disabled = false;
        solveBtn.querySelector('.btn-solve-text').textContent = 'Retry';
        return;
      }

      if (response && response.success && response.code) {
        // Step 2: Got solution, now open problem page and inject
        updateStatus(barEl, msgEl, 50, 'Opening problem page...');

        var problemUrl = 'https://leetcode.com/problems/' + challenge.titleSlug + '/';

        // Find or create tab with the problem
        chrome.tabs.query({ url: 'https://leetcode.com/*' }, function(tabs) {
          if (tabs && tabs.length > 0) {
            // Use existing LeetCode tab
            var tab = tabs[0];
            chrome.tabs.update(tab.id, { url: problemUrl, active: true }, function(updatedTab) {
              // Wait for page to load, then inject
              waitForTabAndInject(updatedTab.id, response.code, response.lang, barEl, msgEl, solveBtn);
            });
          } else {
            // Open new tab
            chrome.tabs.create({ url: problemUrl, active: true }, function(newTab) {
              waitForTabAndInject(newTab.id, response.code, response.lang, barEl, msgEl, solveBtn);
            });
          }
        });
      } else {
        var errMsg = (response && response.error) ? response.error : 'Unknown error';
        updateStatus(barEl, msgEl, 100, '❌ ' + errMsg, 'error');
        // Log debug info from background
        if (response && response.debug) {
          console.log('[LeetCode Streak] Debug log from solution fetch:');
          response.debug.forEach(function(line) { console.log('  ' + line); });
        }
        solveBtn.disabled = false;
        solveBtn.querySelector('.btn-solve-text').textContent = 'Retry';
      }
    });
  });
}

function waitForTabAndInject(tabId, code, lang, barEl, msgEl, solveBtn) {
  updateStatus(barEl, msgEl, 60, 'Waiting for page to load...');

  // Poll for tab to finish loading
  var attempts = 0;
  var maxAttempts = 30;

  var checkInterval = setInterval(function() {
    attempts++;

    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError || !tab) {
        clearInterval(checkInterval);
        updateStatus(barEl, msgEl, 100, '❌ Tab error', 'error');
        resetSolveBtn(solveBtn);
        return;
      }

      if (tab.status === 'complete') {
        clearInterval(checkInterval);
        updateStatus(barEl, msgEl, 75, 'Injecting solution...');

        // Give the page a moment to fully render
        setTimeout(function() {
          injectSolution(tabId, code, lang, barEl, msgEl, solveBtn);
        }, 3000);
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        updateStatus(barEl, msgEl, 100, '❌ Page took too long to load', 'error');
        resetSolveBtn(solveBtn);
      }
    });
  }, 1000);
}

function injectSolution(tabId, code, lang, barEl, msgEl, solveBtn) {
  // Send message to content script to inject the code
  chrome.tabs.sendMessage(tabId, {
    type: 'INJECT_SOLUTION',
    code: code,
    lang: lang
  }, function(response) {
    if (chrome.runtime.lastError) {
      // Content script not ready, try via scripting API
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: injectCodeDirectly,
        args: [code, lang]
      }, function(results) {
        if (chrome.runtime.lastError) {
          updateStatus(barEl, msgEl, 100, '❌ Could not inject code. Try pasting manually.', 'error');
        } else {
          updateStatus(barEl, msgEl, 100, '✅ Solution injected! Review & submit.', 'success');
        }
        resetSolveBtn(solveBtn);
      });
      return;
    }

    if (response && response.success) {
      updateStatus(barEl, msgEl, 100, '✅ Solution injected! Review & submit.', 'success');
    } else {
      updateStatus(barEl, msgEl, 100, '⚠️ Injected but verify the code editor.', 'success');
    }
    resetSolveBtn(solveBtn);
  });
}

// This function runs in the page context via chrome.scripting.executeScript
function injectCodeDirectly(code, lang) {
  // Try to find Monaco editor and set value
  try {
    // Method 1: Monaco API
    if (typeof monaco !== 'undefined' && monaco.editor) {
      var models = monaco.editor.getModels();
      if (models.length > 0) {
        models[0].setValue(code);
        return { success: true };
      }
    }

    // Method 2: Find CodeMirror
    var cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) {
      cm.CodeMirror.setValue(code);
      return { success: true };
    }

    return { success: false, error: 'Editor model not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateStatus(barEl, msgEl, percent, message, type) {
  if (barEl) barEl.style.width = percent + '%';
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.className = 'status-message' + (type ? ' ' + type : '');
  }
}

function resetSolveBtn(btn) {
  if (btn) {
    btn.disabled = false;
    btn.querySelector('.btn-solve-text').textContent = 'Auto Solve';
  }
}

// ---- Data Layer ----
function loadData() {
  return new Promise(function(resolve) {
    chrome.storage.local.get({
      streak: 0,
      bestStreak: 0,
      totalSolved: 0,
      lastSolvedDate: null,
      history: [],
      dailyCounts: {}
    }, function(result) { resolve(result); });
  });
}

function saveData(data) {
  return new Promise(function(resolve) {
    chrome.storage.local.set(data, resolve);
  });
}

// ---- Render Everything ----
function renderAll(data) {
  renderStreak(data.streak);
  renderStats(data);
  renderHeatmap(data.dailyCounts);
  renderActivity(data.history);
  renderTodayStatus(data.dailyCounts);
}

// ---- Streak Ring ----
function renderStreak(streak) {
  var countEl = document.getElementById('streakCount');
  var ringEl = document.getElementById('streakRing');

  if (countEl) animateNumber(countEl, streak);

  if (ringEl) {
    var progress = Math.min(streak / 30, 1);
    var offset = STREAK_CIRCUMFERENCE * (1 - progress);
    ringEl.style.strokeDasharray = STREAK_CIRCUMFERENCE;
    ringEl.style.strokeDashoffset = offset;
  }
}

function animateNumber(el, target) {
  if (target === 0) { el.textContent = '0'; return; }
  var duration = 600;
  var start = performance.now();

  function tick(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- Stats ----
function renderStats(data) {
  var today = getDateString(new Date());
  setStatValue('todayCount', data.dailyCounts[today] || 0);
  setStatValue('bestStreak', data.bestStreak);
  setStatValue('totalSolved', data.totalSolved);
  setStatValue('weekCount', getThisWeekCount(data.dailyCounts));
}

function setStatValue(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getThisWeekCount(dailyCounts) {
  var now = new Date();
  var dayOfWeek = now.getDay();
  var total = 0;
  for (var i = 0; i <= dayOfWeek; i++) {
    var d = new Date(now);
    d.setDate(d.getDate() - (dayOfWeek - i));
    total += (dailyCounts[getDateString(d)] || 0);
  }
  return total;
}

// ---- Heatmap ----
function renderHeatmap(dailyCounts) {
  var container = document.getElementById('heatmap');
  if (!container) return;
  container.innerHTML = '';
  var today = new Date();

  for (var i = 6; i >= 0; i--) {
    var d = new Date(today);
    d.setDate(d.getDate() - i);
    var key = getDateString(d);
    var count = dailyCounts[key] || 0;
    var isToday = i === 0;

    var dayEl = document.createElement('div');
    dayEl.className = 'heatmap-day';

    var cell = document.createElement('div');
    cell.className = 'heatmap-cell' + (count > 0 ? ' active' : '') + (isToday ? ' today' : '');
    cell.textContent = count > 0 ? count : '';
    cell.title = key + ': ' + count + ' problem' + (count !== 1 ? 's' : '');

    var label = document.createElement('span');
    label.className = 'heatmap-day-label';
    label.textContent = DAY_NAMES[d.getDay()];

    dayEl.appendChild(cell);
    dayEl.appendChild(label);
    container.appendChild(dayEl);
  }
}

// ---- Activity ----
function renderActivity(history) {
  var container = document.getElementById('activityList');
  if (!container) return;

  if (!history || history.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📝</span>' +
        '<p>No problems solved yet.<br>Head to <a href="https://leetcode.com/problemset/" target="_blank">LeetCode</a> and start solving!</p>' +
      '</div>';
    return;
  }

  var recent = history.slice().reverse().slice(0, 10);
  container.innerHTML = '';

  recent.forEach(function(item) {
    var el = document.createElement('div');
    el.className = 'activity-item';

    var dot = document.createElement('span');
    dot.className = 'activity-difficulty ' + (item.difficulty || 'easy').toLowerCase();

    var name = document.createElement('span');
    name.className = 'activity-name';
    name.textContent = item.title;

    var time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = getTimeAgo(item.timestamp);

    el.appendChild(dot);
    el.appendChild(name);
    el.appendChild(time);
    container.appendChild(el);
  });
}

// ---- Today Status ----
function renderTodayStatus(dailyCounts) {
  var today = getDateString(new Date());
  var count = dailyCounts[today] || 0;
  var statusEl = document.getElementById('todayStatus');
  if (!statusEl) return;

  var dot = statusEl.querySelector('.status-dot');
  var text = statusEl.querySelector('.status-text');

  if (count > 0) {
    dot.className = 'status-dot complete';
    text.textContent = '✅ ' + count + ' problem' + (count !== 1 ? 's' : '') + ' solved today!';
    text.style.color = 'var(--green)';
  } else {
    dot.className = 'status-dot incomplete';
    text.textContent = 'No problem solved today';
    text.style.color = '';
  }
}

// ---- Reset Modal ----
function setupResetModal() {
  var modal = document.getElementById('resetModal');
  var resetBtn = document.getElementById('resetBtn');
  var cancelBtn = document.getElementById('cancelReset');
  var confirmBtn = document.getElementById('confirmReset');

  if (resetBtn) resetBtn.addEventListener('click', function() { modal.classList.add('visible'); });
  if (cancelBtn) cancelBtn.addEventListener('click', function() { modal.classList.remove('visible'); });
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async function() {
      await saveData({ streak: 0, bestStreak: 0, totalSolved: 0, lastSolvedDate: null, history: [], dailyCounts: {} });
      modal.classList.remove('visible');
      renderAll(await loadData());
    });
  }
  if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('visible'); });
}

// ---- Helpers ----
function getDateString(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function getTimeAgo(timestamp) {
  if (!timestamp) return '';
  var seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  var days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  return Math.floor(days / 7) + 'w ago';
}

// Listen for real-time updates
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local') {
    loadData().then(renderAll);
  }
});
