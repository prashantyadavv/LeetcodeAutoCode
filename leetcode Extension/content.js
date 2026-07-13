// ============================================
//  LeetCode Streak Tracker — Content Script
//  Runs on https://leetcode.com/*
//  - Injects solutions into the code editor
//  - Detects accepted submissions
// ============================================

(function() {
  'use strict';

  if (window.__leetcodeStreakInjected) return;
  window.__leetcodeStreakInjected = true;

  // ========================================
  //  Message Listener (from popup/background)
  // ========================================
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'INJECT_SOLUTION') {
      console.log('[LeetCode Streak] Received inject request, lang:', message.lang);

      // Select language first, then inject code
      selectLanguageThenInject(message.code, message.lang, function(result) {
        sendResponse(result);
      });

      return true; // async response
    }
  });

  // ========================================
  //  Language Selection + Code Injection
  // ========================================

  function selectLanguageThenInject(code, lang, callback) {
    // First try to select the language
    selectLanguage(lang);

    // Give time for language switch, then inject
    setTimeout(function() {
      var result = setEditorCode(code);
      callback(result);
    }, 2000);
  }

  function selectLanguage(lang) {
    if (!lang) return;

    var langMap = {
      'python3': ['Python3', 'Python'],
      'python': ['Python3', 'Python'],
      'java': ['Java'],
      'cpp': ['C++'],
      'javascript': ['JavaScript'],
      'typescript': ['TypeScript'],
      'c': ['C'],
      'go': ['Go'],
      'rust': ['Rust']
    };

    var targetNames = langMap[lang.toLowerCase()] || [lang];

    // Find the language selector button in the editor toolbar
    // LeetCode uses various selectors depending on the version
    var langBtn = document.querySelector('[class*="ant-select-selector"]') ||
                  document.querySelector('button[class*="lang"]') ||
                  findLangButton();

    if (langBtn) {
      langBtn.click();

      setTimeout(function() {
        // Find dropdown options
        var items = document.querySelectorAll(
          '.ant-select-item-option, [class*="option"], [role="option"], li[class*="select"]'
        );

        for (var i = 0; i < items.length; i++) {
          var itemText = items[i].textContent.trim();
          for (var j = 0; j < targetNames.length; j++) {
            if (itemText === targetNames[j]) {
              items[i].click();
              console.log('[LeetCode Streak] Selected language:', itemText);
              return;
            }
          }
        }

        // If dropdown didn't work, click elsewhere to close it
        document.body.click();
      }, 500);
    }
  }

  function findLangButton() {
    // Look for the language dropdown by searching for common language names
    var allButtons = document.querySelectorAll('button, div[role="button"], [class*="select"]');
    var langNames = ['Python3', 'Python', 'Java', 'C++', 'JavaScript', 'C', 'Go', 'TypeScript'];

    for (var i = 0; i < allButtons.length; i++) {
      var text = allButtons[i].textContent.trim();
      for (var j = 0; j < langNames.length; j++) {
        if (text === langNames[j]) {
          return allButtons[i];
        }
      }
    }
    return null;
  }

  // ========================================
  //  Set Code in Monaco Editor
  // ========================================

  function setEditorCode(code) {
    copyCodeToClipboard(code);
    return { success: false, error: 'Editor replacement failed. Code copied instead.' };
  }

  // ========================================
  //  Submission Detection
  // ========================================

  var lastDetectedUrl = '';
  var lastRecordedProblem = '';
  var observing = false;
  var lastAutoInjectedSlug = '';

  function initDetection() {
    setInterval(function() {
      if (location.href !== lastDetectedUrl) {
        lastDetectedUrl = location.href;
        if (/\/problems\//.test(location.pathname)) {
          startObserving();
        }
      }
      syncAutoCodeButton();
    }, 1000);
  }

  function syncAutoCodeButton() {
    var isProblemPage = /\/problems\/[^/]+/.test(location.pathname);
    var existing = document.getElementById('leetcode-streak-auto-code');

    if (!isProblemPage) {
      if (existing) existing.remove();
      return;
    }

    if (!existing) {
      createAutoCodeButton();
    }

    if (shouldAutoInject()) {
      var slug = getProblemSlug();
      if (slug && slug !== lastAutoInjectedSlug) {
        lastAutoInjectedSlug = slug;
        runAutoCode(document.getElementById('leetcode-streak-auto-code'));
      }
    }
  }

  function createAutoCodeButton() {
    var btn = document.createElement('button');
    btn.id = 'leetcode-streak-auto-code';
    btn.type = 'button';
    btn.textContent = 'Auto Code';
    btn.title = 'Fetch and insert the available solution';
    btn.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:24px',
      'z-index:2147483647',
      'border:0',
      'border-radius:10px',
      'padding:12px 16px',
      'font:600 14px Arial,sans-serif',
      'color:#111827',
      'background:linear-gradient(135deg,#fbbf24,#f97316)',
      'box-shadow:0 10px 30px rgba(0,0,0,.35)',
      'cursor:pointer'
    ].join(';');

    btn.addEventListener('click', function() {
      runAutoCode(btn);
    });

    document.documentElement.appendChild(btn);
  }

  function shouldAutoInject() {
    var params = new URLSearchParams(location.search);
    return params.get('lcAutoCode') === '1';
  }

  function getProblemSlug() {
    var match = location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : '';
  }

  function runAutoCode(btn) {
    var slug = getProblemSlug();
    if (!slug) return;

    var builtInSolution = getContentBuiltInSolution(slug);
    if (builtInSolution) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Inserting...';
        btn.style.opacity = '.75';
      }

      selectLanguage(builtInSolution.lang);
      setTimeout(function() {
        injectViaMainWorld(builtInSolution.code, function(result) {
          if (result && result.success) {
            setAutoCodeButtonState(btn, 'Inserted', false);
          } else {
            copyCodeToClipboard(builtInSolution.code);
            setAutoCodeButtonState(btn, 'Copied code', false);
            console.warn('[LeetCode Streak] Main-world inject failed:', result && result.error);
          }
        });
      }, 1200);
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Fetching...';
      btn.style.opacity = '.75';
    }

    chrome.runtime.sendMessage({
      type: 'GET_SOLUTION',
      titleSlug: slug
    }, function(response) {
      if (chrome.runtime.lastError) {
        setAutoCodeButtonState(btn, 'Reload extension', false);
        console.error('[LeetCode Streak] Auto Code error:', chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success && response.code) {
        if (btn) btn.textContent = 'Inserting...';
        selectLanguage(response.lang);
        setTimeout(function() {
          injectViaMainWorld(response.code, function(result) {
            if (result && result.success) {
              setAutoCodeButtonState(btn, 'Inserted', false);
            } else {
              copyCodeToClipboard(response.code);
              setAutoCodeButtonState(btn, 'Copied code', false);
              console.warn('[LeetCode Streak] Main-world inject failed:', result && result.error);
            }
          });
        }, 1200);
      } else {
        setAutoCodeButtonState(btn, 'No solution', false);
      }
    });
  }

  function injectViaMainWorld(code, callback) {
    chrome.runtime.sendMessage({
      type: 'INJECT_SOLUTION_MAIN',
      code: code
    }, function(result) {
      if (chrome.runtime.lastError) {
        callback({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      if (result && result.success) {
        callback(result);
        return;
      }

      var localResult = setEditorCode(code);
      callback(localResult && localResult.success ? localResult : result);
    });
  }

  function getContentBuiltInSolution(slug) {
    var solutions = {
      'sequential-digits': {
        lang: 'cpp',
        code: [
          'class Solution {',
          'public:',
          'vector<int> sequentialDigits(int low, int high) {',
          'vector<int> ans;',
          'for (int len = 2; len <= 9; len++) {',
          'for (int start = 1; start + len - 1 <= 9; start++) {',
          'int num = 0;',
          'for (int d = start; d < start + len; d++) {',
          'num = num * 10 + d;',
          '}',
          'if (num >= low && num <= high) ans.push_back(num);',
          '}',
          '}',
          'return ans;',
          '}',
          '};'
        ].join('\n')
      }
    };

    return solutions[slug] || null;
  }

  function copyCodeToClipboard(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(function() {});
      return;
    }

    var textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function setAutoCodeButtonState(btn, text, disabled) {
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '.75' : '1';

    setTimeout(function() {
      if (!btn || !document.documentElement.contains(btn)) return;
      btn.textContent = 'Auto Code';
      btn.disabled = false;
      btn.style.opacity = '1';
    }, 2500);
  }

  function startObserving() {
    if (observing) return;
    observing = true;

    var observer = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          if (added[n].nodeType === Node.ELEMENT_NODE) {
            checkForAcceptedNode(added[n]);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(checkForAccepted, 3000);
  }

  function checkForAcceptedNode(node) {
    var text = (node.textContent || '').toLowerCase().trim();
    if (text.includes('accepted')) {
      var cn = (node.className || '').toLowerCase();
      if (cn.includes('success') || cn.includes('accepted') || cn.includes('result')) {
        onAccepted();
      }
    }
  }

  function checkForAccepted() {
    var selectors = [
      '[data-e2e-locator="submission-result"]',
      '[class*="success"]',
      '[class*="accepted"]'
    ];

    for (var s = 0; s < selectors.length; s++) {
      try {
        var el = document.querySelector(selectors[s]);
        if (el && (el.textContent || '').toLowerCase().includes('accepted')) {
          onAccepted();
          return;
        }
      } catch (e) { /* invalid selector */ }
    }
  }

  function onAccepted() {
    var info = extractProblemInfo();
    var key = info.title + '|' + todayStr();
    if (key === lastRecordedProblem) return;
    lastRecordedProblem = key;

    chrome.runtime.sendMessage({
      type: 'PROBLEM_SOLVED',
      data: {
        title: info.title,
        difficulty: info.difficulty,
        url: location.href,
        timestamp: Date.now()
      }
    });

    console.log('[LeetCode Streak] ✅ Accepted:', info.title);
  }

  function extractProblemInfo() {
    var title = 'Unknown Problem';
    var difficulty = 'Medium';

    var titleEl = document.querySelector('[data-cy="question-title"]') ||
                  document.querySelector('div[class*="title"]');
    if (titleEl) {
      title = titleEl.textContent.trim();
    } else {
      var match = location.pathname.match(/\/problems\/([^/]+)/);
      if (match) {
        title = match[1].replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      }
    }

    var diffEl = document.querySelector('[class*="difficulty"]');
    if (diffEl) {
      var t = diffEl.textContent.toLowerCase();
      if (t.includes('easy')) difficulty = 'Easy';
      else if (t.includes('hard')) difficulty = 'Hard';
    }

    return { title: title, difficulty: difficulty };
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Boot
  initDetection();
})();
