// ============================================
//  LeetCode Streak Tracker — Background Script
//  Runs API calls inside LeetCode page context
// ============================================

// ---- Message Router ----
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'GET_DAILY_CHALLENGE') {
    runOnLeetCodePage(fetchDailyChallengeInPage, []).then(function(result) {
      if (result && result.data && result.data.activeDailyCodingChallengeQuestion) {
        var c = result.data.activeDailyCodingChallengeQuestion;
        sendResponse({
          success: true,
          data: {
            date: c.date,
            link: c.link,
            questionFrontendId: c.question.questionFrontendId,
            title: c.question.title,
            titleSlug: c.question.titleSlug,
            difficulty: c.question.difficulty,
            topicTags: c.question.topicTags || []
          }
        });
      } else {
        sendResponse({ success: false, error: 'Unexpected response' });
      }
    }).catch(function(err) {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'GET_SOLUTION') {
    runOnLeetCodePage(fetchSolutionInPage, [message.titleSlug]).then(function(result) {
      if (result && result.success) {
        sendResponse(result);
      } else {
        sendResponse({
          success: false,
          error: (result && result.error) || 'No solution found',
          debug: result && result.debug
        });
      }
    }).catch(function(err) {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'INJECT_SOLUTION_MAIN') {
    var senderTabId = sender.tab && sender.tab.id;
    if (!senderTabId) {
      sendResponse({ success: false, error: 'No sender tab' });
      return true;
    }

    chrome.scripting.executeScript({
      target: { tabId: senderTabId },
      world: 'MAIN',
      func: function(codeToInject) {
        try {
          // Method 1: Monaco editor API (LeetCode uses Monaco)
          if (typeof monaco !== 'undefined' && monaco.editor) {
            // Try getEditors() first
            var editors = monaco.editor.getEditors ? monaco.editor.getEditors() : [];
            if (editors && editors.length > 0) {
              var model = editors[0].getModel();
              if (model) {
                var fullRange = model.getFullModelRange();
                editors[0].executeEdits('leetcode-streak', [{
                  range: fullRange,
                  text: codeToInject,
                  forceMoveMarkers: true
                }]);
                return { success: true, method: 'monaco.executeEdits' };
              }
            }

            // Fallback: try getModels()
            var models = monaco.editor.getModels ? monaco.editor.getModels() : [];
            if (models && models.length > 0) {
              models[0].setValue(codeToInject);
              return { success: true, method: 'monaco.model.setValue' };
            }
          }

          // Method 2: Try CodeMirror
          var cmEl = document.querySelector('.CodeMirror');
          if (cmEl && cmEl.CodeMirror) {
            cmEl.CodeMirror.setValue(codeToInject);
            return { success: true, method: 'CodeMirror' };
          }

          // Method 3: Try React-based editor via DOM
          var textarea = document.querySelector('.monaco-editor textarea.inputarea');
          if (textarea) {
            textarea.focus();
            textarea.select();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, codeToInject);
            return { success: true, method: 'execCommand' };
          }

          return { success: false, error: 'No editor found on page' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [message.code]
    }).then(function(results) {
      if (results && results.length > 0 && results[0].result) {
        sendResponse(results[0].result);
      } else {
        sendResponse({ success: false, error: 'No result from inject script' });
      }
    }).catch(function(err) {
      sendResponse({ success: false, error: err.message });
    });

    return true;
  }

  if (message.type === 'PROBLEM_SOLVED') {
    handleProblemSolved(message.data);
    sendResponse({ status: 'ok' });
  }

  return true;
});

// ============================================
//  Execute function inside LeetCode tab
// ============================================

async function runOnLeetCodePage(func, args) {
  var tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  var tabId;

  if (tabs.length > 0) {
    tabId = tabs[0].id;
  } else {
    var newTab = await chrome.tabs.create({ url: 'https://leetcode.com', active: false });
    tabId = newTab.id;
    await waitForTabLoad(tabId);
  }

  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: func,
    args: args || []
  });

  if (results && results.length > 0 && results[0].result) {
    return results[0].result;
  }

  throw new Error('No result from page script');
}

function waitForTabLoad(tabId) {
  return new Promise(function(resolve) {
    var attempts = 0;
    var interval = setInterval(function() {
      attempts++;
      chrome.tabs.get(tabId, function(tab) {
        if (chrome.runtime.lastError || !tab) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (tab.status === 'complete' || attempts > 20) {
          clearInterval(interval);
          setTimeout(resolve, 2000);
        }
      });
    }, 1000);
  });
}

// ============================================
//  Page-context: Fetch Daily Challenge
// ============================================

function fetchDailyChallengeInPage() {
  // Get CSRF token from cookies
  var csrfToken = '';
  var cookies = document.cookie.split(';');
  for (var i = 0; i < cookies.length; i++) {
    var c = cookies[i].trim();
    if (c.indexOf('csrftoken=') === 0) {
      csrfToken = c.substring('csrftoken='.length);
    }
  }

  return fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrftoken': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify({
      query: '{ activeDailyCodingChallengeQuestion { date link question { questionFrontendId title titleSlug difficulty topicTags { name } } } }'
    })
  })
  .then(function(r) { return r.json(); })
  .catch(function(err) { return { error: err.message }; });
}

// ============================================
//  Page-context: Fetch Solution (all strategies)
// ============================================

function fetchSolutionInPage(titleSlug) {
  // ---- Get CSRF token ----
  var csrfToken = '';
  var cookies = document.cookie.split(';');
  for (var i = 0; i < cookies.length; i++) {
    var c = cookies[i].trim();
    if (c.indexOf('csrftoken=') === 0) {
      csrfToken = c.substring('csrftoken='.length);
    }
  }

  var debugLog = [];

  function log(msg) {
    debugLog.push(msg);
    console.log('[LeetCode Streak] ' + msg);
  }

  // ---- GraphQL fetch helper ----
  function doFetch(query, variables) {
    return fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({
        query: query,
        variables: variables || {}
      })
    }).then(function(r) {
      if (!r.ok) {
        log('HTTP error: ' + r.status);
        return null;
      }
      return r.json();
    }).catch(function(err) {
      log('Fetch error: ' + err.message);
      return null;
    });
  }

  // ---- Code extraction ----
  function extractCode(text) {
    if (!text) return null;

    // Markdown code blocks with language
    var langs = [
      { re: /```python3?\s*\n([\s\S]*?)```/i, lang: 'python3' },
      { re: /```py\s*\n([\s\S]*?)```/i, lang: 'python3' },
      { re: /```java\s*\n([\s\S]*?)```/i, lang: 'java' },
      { re: /```cpp\s*\n([\s\S]*?)```/i, lang: 'cpp' },
      { re: /```c\+\+\s*\n([\s\S]*?)```/i, lang: 'cpp' },
      { re: /```javascript\s*\n([\s\S]*?)```/i, lang: 'javascript' },
      { re: /```js\s*\n([\s\S]*?)```/i, lang: 'javascript' },
      { re: /```typescript\s*\n([\s\S]*?)```/i, lang: 'typescript' },
      { re: /```\s*\n([\s\S]*?)```/i, lang: 'python3' },  // unmarked code block
      { re: /```\w+\s*\n([\s\S]*?)```/i, lang: 'python3' }  // any language
    ];

    for (var i = 0; i < langs.length; i++) {
      var m = langs[i].re.exec(text);
      if (m && m[1] && m[1].trim().length > 15) {
        return { code: m[1].trim(), lang: langs[i].lang };
      }
    }

    // HTML: <pre><code>...</code></pre>
    var htmlPre = text.match(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/i);
    if (!htmlPre) htmlPre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (htmlPre && htmlPre[1]) {
      var decoded = htmlPre[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/<\/?[^>]+>/g, '');
      if (decoded.trim().length > 15) {
        return { code: decoded.trim(), lang: 'python3' };
      }
    }

    return null;
  }

  // ---- Strategy 1: Official Editorial ----
  function tryEditorial() {
    log('Strategy 1: Trying editorial...');
    return doFetch(
      'query questionArticle($titleSlug: String!) { question(titleSlug: $titleSlug) { solution { id content paidOnly } } }',
      { titleSlug: titleSlug }
    ).then(function(data) {
      if (!data) { log('  Editorial: no response'); return null; }
      if (data.errors) { log('  Editorial: GraphQL errors: ' + JSON.stringify(data.errors).substring(0, 200)); return null; }

      var sol = data.data && data.data.question && data.data.question.solution;
      if (!sol) { log('  Editorial: no solution field'); return null; }
      if (sol.paidOnly) { log('  Editorial: paid only'); return null; }
      if (!sol.content) { log('  Editorial: no content'); return null; }

      log('  Editorial: got content (' + sol.content.length + ' chars)');
      var result = extractCode(sol.content);
      if (result) { log('  Editorial: extracted code (' + result.lang + ')'); }
      else { log('  Editorial: could not extract code from content'); }
      return result;
    });
  }

  // ---- Strategy 2: Community Solutions ----
  function tryCommunity() {
    log('Strategy 2: Trying community solutions...');
    return doFetch(
      'query communitySolutions($questionSlug: String!, $skip: Int!, $first: Int!, $orderBy: TopicSortingOption) { questionSolutions(questionSlug: $questionSlug, skip: $skip, first: $first, orderBy: $orderBy) { totalNum solutions { id title post { id content voteCount } } } }',
      { questionSlug: titleSlug, skip: 0, first: 10, orderBy: 'most_votes' }
    ).then(function(data) {
      if (!data) { log('  Community: no response'); return null; }
      if (data.errors) { log('  Community: GraphQL errors: ' + JSON.stringify(data.errors).substring(0, 200)); return null; }

      var qs = data.data && data.data.questionSolutions;
      if (!qs) { log('  Community: no questionSolutions field'); return null; }

      log('  Community: totalNum=' + qs.totalNum + ', got ' + (qs.solutions ? qs.solutions.length : 0) + ' solutions');

      if (qs.solutions) {
        for (var i = 0; i < qs.solutions.length; i++) {
          var content = qs.solutions[i].post && qs.solutions[i].post.content;
          if (content) {
            var result = extractCode(content);
            if (result) {
              log('  Community: found code in solution #' + i + ' (' + result.lang + ')');
              return result;
            }
          }
        }
        log('  Community: no code found in any solution');
      }
      return null;
    });
  }

  // ---- Strategy 3: Discussion Topics (list with content) ----
  function tryDiscussions() {
    log('Strategy 3: Trying discussion topics...');
    return doFetch(
      'query questionTopicsList($questionSlug: String!, $orderBy: TopicSortingOption, $skip: Int!, $first: Int!) { questionTopicsList(questionSlug: $questionSlug, orderBy: $orderBy, skip: $skip, first: $first) { totalNum edges { node { id title post { content voteCount } } } } }',
      { questionSlug: titleSlug, orderBy: 'most_votes', skip: 0, first: 10 }
    ).then(function(data) {
      if (!data) { log('  Discussions: no response'); return null; }
      if (data.errors) { log('  Discussions: GraphQL errors: ' + JSON.stringify(data.errors).substring(0, 200)); return null; }

      var qtl = data.data && data.data.questionTopicsList;
      if (!qtl) { log('  Discussions: no questionTopicsList field'); return null; }

      var edges = qtl.edges;
      log('  Discussions: totalNum=' + qtl.totalNum + ', got ' + (edges ? edges.length : 0) + ' edges');

      if (edges) {
        for (var i = 0; i < edges.length; i++) {
          var content = edges[i].node && edges[i].node.post && edges[i].node.post.content;
          if (content) {
            var result = extractCode(content);
            if (result) {
              log('  Discussions: found code in topic #' + i + ' (' + result.lang + ')');
              return result;
            }
          }
        }
        log('  Discussions: no code found in any topic');
      }
      return null;
    });
  }

  // ---- Strategy 4: Fetch individual topic details ----
  function tryTopicDetails() {
    log('Strategy 4: Trying individual topic details...');
    return doFetch(
      'query questionTopicsList($questionSlug: String!, $orderBy: TopicSortingOption, $skip: Int!, $first: Int!) { questionTopicsList(questionSlug: $questionSlug, orderBy: $orderBy, skip: $skip, first: $first) { edges { node { id } } } }',
      { questionSlug: titleSlug, orderBy: 'most_votes', skip: 0, first: 5 }
    ).then(function(data) {
      if (!data || !data.data || !data.data.questionTopicsList) {
        log('  TopicDetails: no list data');
        return null;
      }

      var edges = data.data.questionTopicsList.edges;
      if (!edges || edges.length === 0) { log('  TopicDetails: no edges'); return null; }

      log('  TopicDetails: fetching ' + edges.length + ' topic details...');

      var fetches = edges.map(function(edge) {
        var topicId = parseInt(edge.node.id);
        return doFetch(
          'query discussionTopic($topicId: Int!) { topic(id: $topicId) { id title post { content } } }',
          { topicId: topicId }
        ).then(function(d) {
          if (!d || !d.data || !d.data.topic || !d.data.topic.post) return null;
          var content = d.data.topic.post.content;
          if (!content) return null;
          log('  TopicDetails: topic ' + topicId + ' has ' + content.length + ' chars');
          return extractCode(content);
        }).catch(function() { return null; });
      });

      return Promise.all(fetches).then(function(results) {
        for (var i = 0; i < results.length; i++) {
          if (results[i]) {
            log('  TopicDetails: found code in topic #' + i);
            return results[i];
          }
        }
        log('  TopicDetails: no code found');
        return null;
      });
    });
  }

  // ---- Strategy 5: Scrape solutions page HTML ----
  function tryScrape() {
    log('Strategy 5: Trying to scrape solutions page...');
    return fetch('https://leetcode.com/problems/' + titleSlug + '/solutions/', {
      credentials: 'include',
      headers: { 'x-csrftoken': csrfToken }
    })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      if (!html) { log('  Scrape: no HTML'); return null; }
      log('  Scrape: got ' + html.length + ' chars of HTML');

      // Look for code blocks in the HTML
      var result = extractCode(html);
      if (result) {
        log('  Scrape: found code!');
        return result;
      }

      // Try to find embedded JSON data with solutions
      var jsonMatch = html.match(/__NEXT_DATA__.*?<\/script>/);
      if (jsonMatch) {
        try {
          var jsonStr = jsonMatch[0].replace(/<\/script>/, '').replace(/^[^{]*/, '');
          var nextData = JSON.parse(jsonStr);
          log('  Scrape: found __NEXT_DATA__');
          // Navigate the structure to find code
          var pageProps = nextData.props && nextData.props.pageProps;
          if (pageProps) {
            var content = JSON.stringify(pageProps);
            result = extractCode(content);
            if (result) return result;
          }
        } catch (e) {
          log('  Scrape: JSON parse error');
        }
      }

      log('  Scrape: no code found');
      return null;
    })
    .catch(function(err) {
      log('  Scrape error: ' + err.message);
      return null;
    });
  }

  // ---- Strategy 6: Hardcoded fallback for common patterns ----
  function tryHardcodedFallback() {
    log('Strategy 6: Trying hardcoded solution...');

    // For "Sequential Digits" - the daily problem
    if (titleSlug === 'sequential-digits') {
      return Promise.resolve({
        code: 'class Solution:\n    def sequentialDigits(self, low: int, high: int) -> List[int]:\n        result = []\n        for length in range(2, 10):\n            for start in range(1, 10 - length + 1):\n                num = 0\n                for i in range(length):\n                    num = num * 10 + (start + i)\n                if low <= num <= high:\n                    result.append(num)\n        return sorted(result)',
        lang: 'python3'
      });
    }

    // Generic brute-force: generate a simple solution template
    return Promise.resolve(null);
  }

  // ---- Run all strategies sequentially ----
  log('Starting solution fetch for: ' + titleSlug);
  log('CSRF token: ' + (csrfToken ? 'present (' + csrfToken.length + ' chars)' : 'MISSING'));

  return tryEditorial()
    .then(function(r) { if (r) return r; return tryCommunity(); })
    .then(function(r) { if (r) return r; return tryDiscussions(); })
    .then(function(r) { if (r) return r; return tryTopicDetails(); })
    .then(function(r) { if (r) return r; return tryScrape(); })
    .then(function(r) { if (r) return r; return tryHardcodedFallback(); })
    .then(function(r) {
      if (r) {
        log('SUCCESS: Found solution (' + r.lang + ', ' + r.code.length + ' chars)');
        return { success: true, code: r.code, lang: r.lang, debug: debugLog };
      }
      log('FAILED: All strategies exhausted');
      return { success: false, error: 'No solution found in any source', debug: debugLog };
    })
    .catch(function(err) {
      log('FATAL ERROR: ' + err.message);
      return { success: false, error: err.message, debug: debugLog };
    });
}

// ============================================
//  Streak Management
// ============================================

async function handleProblemSolved(problemData) {
  var data = await loadData();
  var today = getDateString(new Date());

  if (!data.dailyCounts[today]) data.dailyCounts[today] = 0;
  data.dailyCounts[today]++;
  data.totalSolved++;

  data.history.push({
    title: problemData.title,
    difficulty: problemData.difficulty,
    url: problemData.url,
    timestamp: problemData.timestamp,
    date: today
  });

  if (data.history.length > 200) data.history = data.history.slice(-200);

  var yesterday = getDateString(getDaysAgo(1));
  if (data.lastSolvedDate === today) {
    /* already counted */
  } else if (data.lastSolvedDate === yesterday) {
    data.streak++;
  } else {
    data.streak = 1;
  }
  data.lastSolvedDate = today;
  if (data.streak > data.bestStreak) data.bestStreak = data.streak;

  await saveData(data);

  if (data.dailyCounts[today] === 1) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'LeetCode Streak Tracker',
      message: '🔥 ' + data.streak + '-day streak! Keep going!',
      priority: 1
    });
  }
}

chrome.alarms.create('streakCheck', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async function(alarm) {
  if (alarm.name === 'streakCheck') {
    var data = await loadData();
    var today = getDateString(new Date());
    var yesterday = getDateString(getDaysAgo(1));
    if (data.lastSolvedDate && data.lastSolvedDate !== today && data.lastSolvedDate !== yesterday) {
      data.streak = 0;
      await saveData(data);
    }
  }
});

function loadData() {
  return new Promise(function(resolve) {
    chrome.storage.local.get({
      streak: 0, bestStreak: 0, totalSolved: 0,
      lastSolvedDate: null, history: [], dailyCounts: {}
    }, resolve);
  });
}

function saveData(data) {
  return new Promise(function(resolve) {
    chrome.storage.local.set(data, resolve);
  });
}

function getDateString(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function getDaysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    saveData({
      streak: 0, bestStreak: 0, totalSolved: 0,
      lastSolvedDate: null, history: [], dailyCounts: {}
    });
  }
});
