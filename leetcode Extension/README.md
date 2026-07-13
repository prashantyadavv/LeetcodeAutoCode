# LeetCode Streak Extension

A Chrome extension to track your LeetCode solving streak.

## Project Structure

```
LeetCode-Streak-Extension/
│
├── manifest.json    → Chrome extension configuration
├── popup.html       → Popup UI (shown on icon click)
├── popup.css        → Popup styles
├── popup.js         → Popup interactions
├── content.js       → Runs on LeetCode pages
├── background.js    → Background tasks & messaging
├── icons/           → Extension icons
│     ├── icon16.png
│     ├── icon48.png
│     └── icon128.png
└── README.md
```

## Getting Started

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this project folder
