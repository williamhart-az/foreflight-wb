// Set up alarm check when extension is installed or browser restarts
chrome.runtime.onInstalled.addListener(() => {
  // Create an alarm to check daily (every 1440 minutes)
  // For development/testing, we also check immediately
  chrome.alarms.create('foreflight-export-check', { periodInMinutes: 1440 });
  checkReminderStatus();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'foreflight-export-check') {
    checkReminderStatus();
  }
});

// Open plan.foreflight.com when the user clicks the notification
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'foreflight-monthly-reminder') {
    chrome.tabs.create({ url: 'https://plan.foreflight.com' });
    chrome.notifications.clear(notificationId);
  }
});

// Listen for a manual trigger message from the popup for testing
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'trigger-test-reminder') {
    showReminderNotification();
  }
});

async function checkReminderStatus() {
  chrome.storage.local.get(['lastExportDate', 'reminderEnabled'], (result) => {
    const lastExport = result.lastExportDate || 0;
    const reminderEnabled = result.reminderEnabled !== false; // default to true

    if (!reminderEnabled) return;

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (now - lastExport >= thirtyDaysMs) {
      showReminderNotification();
    }
  });
}

function showReminderNotification() {
  chrome.notifications.create('foreflight-monthly-reminder', {
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'ForeFlight W&B Reminder',
    message: 'It has been over 30 days since your last aircraft Weight & Balance export. Click here to go to plan.foreflight.com and run it now.',
    priority: 2,
    requireInteraction: true
  });
}
