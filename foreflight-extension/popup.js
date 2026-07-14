// Load saved settings and status on open
document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('recipient-email');
  const reminderToggle = document.getElementById('reminder-toggle');
  const lastExportDisplay = document.getElementById('last-export-display');

  // Load from local storage
  chrome.storage.local.get(['recipientEmail', 'reminderEnabled', 'lastExportDate'], (result) => {
    if (result.recipientEmail) {
      emailInput.value = result.recipientEmail;
    }
    reminderToggle.checked = result.reminderEnabled !== false; // default to true
    
    if (result.lastExportDate) {
      lastExportDisplay.innerText = formatDate(result.lastExportDate);
    }
  });

  // Save email when input loses focus
  emailInput.addEventListener('blur', () => {
    chrome.storage.local.set({ recipientEmail: emailInput.value });
  });

  // Save email on enter key
  emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      chrome.storage.local.set({ recipientEmail: emailInput.value });
      emailInput.blur();
    }
  });

  // Save toggle state when changed
  reminderToggle.addEventListener('change', () => {
    chrome.storage.local.set({ reminderEnabled: reminderToggle.checked });
  });

  // Test notification button
  document.getElementById('test-reminder-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'trigger-test-reminder' });
  });
});

// Helper to format date
function formatDate(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Action Buttons
document.getElementById('download-btn').addEventListener('click', () => {
  runScraper('download');
});

document.getElementById('email-btn').addEventListener('click', () => {
  const recipient = document.getElementById('recipient-email').value.trim();
  runScraper('email', recipient);
});

async function runScraper(actionType, recipientEmail = '') {
  const downloadBtn = document.getElementById('download-btn');
  const emailBtn = document.getElementById('email-btn');
  const statusContainer = document.getElementById('status-container');
  const statusText = document.getElementById('status-text');
  const progressBar = document.getElementById('progress-bar');
  const errorBox = document.getElementById('error-box');
  const successBox = document.getElementById('success-box');

  // Disable actions during run
  downloadBtn.disabled = true;
  emailBtn.disabled = true;
  errorBox.style.display = 'none';
  successBox.style.display = 'none';
  statusContainer.style.display = 'block';
  statusText.innerText = 'Checking active tab...';
  progressBar.style.width = '0%';
  progressBar.style.backgroundColor = '#3182ce';

  const messageListener = (message) => {
    if (message.type === 'progress') {
      statusText.innerText = message.message;
      if (message.percent !== undefined) {
        progressBar.style.width = `${message.percent}%`;
      }
    } else if (message.type === 'success') {
      const now = Date.now();
      chrome.storage.local.set({ lastExportDate: now }, () => {
        document.getElementById('last-export-display').innerText = formatDate(now);
      });

      statusText.innerText = `Success! Exported ${message.rowCount} W&B profiles.`;
      progressBar.style.width = '100%';
      progressBar.style.backgroundColor = '#48bb78'; // green
      
      if (actionType === 'email') {
        successBox.innerText = `Exported ${message.rowCount} profiles. Data copied to clipboard & opened mail client.`;
      } else {
        successBox.innerText = `Exported ${message.rowCount} profiles and downloaded CSV file.`;
      }
      successBox.style.display = 'block';
      
      downloadBtn.disabled = false;
      emailBtn.disabled = false;
      chrome.runtime.onMessage.removeListener(messageListener);
    } else if (message.type === 'error') {
      statusContainer.style.display = 'none';
      errorBox.innerText = `Error: ${message.message}`;
      errorBox.style.display = 'block';
      
      downloadBtn.disabled = false;
      emailBtn.disabled = false;
      chrome.runtime.onMessage.removeListener(messageListener);
    }
  };

  chrome.runtime.onMessage.addListener(messageListener);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active browser tab found.');

    const url = new URL(tab.url);
    if (url.hostname !== 'plan.foreflight.com') {
      throw new Error('Please open plan.foreflight.com in the active tab before running this scraper.');
    }

    statusText.innerText = 'Injecting scraping engine...';

    // Inject scraper with arguments
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeForeFlightTab,
      args: [actionType, recipientEmail]
    });

  } catch (err) {
    chrome.runtime.onMessage.removeListener(messageListener);
    statusContainer.style.display = 'none';
    errorBox.innerText = err.message;
    errorBox.style.display = 'block';
    downloadBtn.disabled = false;
    emailBtn.disabled = false;
  }
}

// Injected scraping logic running in plan.foreflight.com context
async function scrapeForeFlightTab(actionType, recipientEmail) {
  try {
    // 1. Extract XSRF token
    const xsrfCookie = document.cookie.split('; ').find(row => row.startsWith('_xsrf='));
    if (!xsrfCookie) {
      throw new Error('XSRF token cookie (_xsrf) not found. Are you logged in?');
    }
    const xsrfToken = decodeURIComponent(xsrfCookie.split('=')[1]);
    
    // 2. Resolve Account ID
    let accountId = null;
    const urlMatch = window.location.pathname.match(/\/aircraft\/([a-f0-9\-]{36})/);
    if (urlMatch) {
      accountId = urlMatch[1];
    } else {
      chrome.runtime.sendMessage({ type: 'progress', message: 'Resolving Account ID...' });
      const subResp = await fetch('/account/api/subscription/simple');
      if (!subResp.ok) throw new Error(`Failed to resolve subscription state: ${subResp.statusText}`);
      const subData = await subResp.json();
      accountId = subData?.subscription?.accountId;
    }

    if (!accountId) {
      throw new Error('Could not resolve ForeFlight Account ID. Try clicking the "Aircraft" tab first.');
    }

    chrome.runtime.sendMessage({ type: 'progress', message: 'Fetching aircraft list...', percent: 5 });

    // 3. Fetch Aircraft List
    const listResp = await fetch(`/aircraft/api/v2/${accountId}/list?includeSharedObjects=true`, {
      method: 'PUT',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'x-xsrftoken': xsrfToken
      },
      body: JSON.stringify({ filter: {} })
    });
    if (!listResp.ok) throw new Error(`Failed to fetch aircraft list: ${listResp.statusText}`);
    const listData = await listResp.json();
    const aircraftList = listData?.aircraft || [];
    
    chrome.runtime.sendMessage({ 
      type: 'progress', 
      message: `Found ${aircraftList.length} aircraft. Fetching details...`, 
      percent: 10 
    });

    // Helpers
    const findKey = (obj, key) => {
      if (obj && typeof obj === 'object') {
        if (key in obj) return obj[key];
        if (Array.isArray(obj)) {
          for (let child of obj) {
            let found = findKey(child, key);
            if (found !== undefined) return found;
          }
        } else {
          for (let child of Object.values(obj)) {
            let found = findKey(child, key);
            if (found !== undefined) return found;
          }
        }
      }
      return undefined;
    };

    const firstText = (...values) => {
      for (let val of values) {
        let text = String(val || '').trim();
        if (text) return text;
      }
      return '';
    };

    const parseNumber = (val) => {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number') return val;
      let clean = String(val).trim().replace(/,/g, '');
      let num = parseFloat(clean);
      return isNaN(num) ? null : num;
    };

    const formatNumber = (val) => {
      if (val === null || val === undefined) return '';
      return Number(val).toFixed(8).replace(/\.?0+$/, '');
    };

    const rows = [];
    const batchSize = 5;

    // 4. Fetch details in concurrent batches
    for (let i = 0; i < aircraftList.length; i += batchSize) {
      const batch = aircraftList.slice(i, i + batchSize);
      const pct = Math.round(10 + (i / aircraftList.length) * 80);
      chrome.runtime.sendMessage({
        type: 'progress',
        message: `Fetching aircraft details (${i + 1} - ${Math.min(i + batchSize, aircraftList.length)} of ${aircraftList.length})...`,
        percent: pct
      });

      await Promise.all(batch.map(async (ac) => {
        const acUuid = ac.uuid;
        try {
          const detailResp = await fetch(`/aircraft/api/v2/${accountId}/${acUuid}`, {
            headers: {
              'accept': '*/*',
              'x-xsrftoken': xsrfToken
            }
          });
          if (!detailResp.ok) return;
          const data = await detailResp.json();
          
          const aircraftDetail = data.aircraft || {};
          const wbProfiles = data.wbProfiles || [];

          const tailNumber = firstText(
            aircraftDetail.tailNumber,
            aircraftDetail.callSign,
            aircraftDetail.callsign,
            findKey(data, 'tailNumber')
          );
          const registration = firstText(
            aircraftDetail.otherInfoReg,
            aircraftDetail.registration,
            aircraftDetail.aircraftRegistration,
            findKey(data, 'otherInfoReg')
          );

          const profiles = wbProfiles.length > 0 ? wbProfiles : [null];

          for (let wbProfile of profiles) {
            const profileJson = wbProfile?.profileJson || data;
            const basicInfo = profileJson?.weightBalanceData?.basicInfo || {};

            let basicEmptyWeight = parseNumber(basicInfo.basicEmptyWeight);
            if (basicEmptyWeight === null) {
              basicEmptyWeight = parseNumber(findKey(profileJson, 'basicEmptyWeight'));
            }

            let basicEmptyArm = parseNumber(basicInfo.basicEmptyArm?.longitudinalCgArm);
            if (basicEmptyArm === null) {
              basicEmptyArm = parseNumber(findKey(profileJson, 'longitudinalCgArm'));
            }

            if (basicEmptyWeight === null && basicEmptyArm === null) {
              continue;
            }

            rows.push({
              tail_number: tailNumber,
              registration: registration,
              basic_empty_weight: formatNumber(basicEmptyWeight),
              basic_empty_arm_longitudinal: formatNumber(basicEmptyArm)
            });
          }
        } catch (e) {
          console.error(`Error processing aircraft ${acUuid}:`, e);
        }
      }));
    }

    chrome.runtime.sendMessage({ type: 'progress', message: 'Generating CSV...', percent: 95 });

    // 5. Generate CSV
    rows.sort((a, b) => {
      const tailCompare = a.tail_number.localeCompare(b.tail_number);
      if (tailCompare !== 0) return tailCompare;
      return a.registration.localeCompare(b.registration);
    });

    let csvContent = 'tail_number,registration,basic_empty_weight,basic_empty_arm_longitudinal\n';
    for (let row of rows) {
      csvContent += `"${row.tail_number}","${row.registration}",${row.basic_empty_weight},${row.basic_empty_arm_longitudinal}\n`;
    }

    // 6. Execute action
    if (actionType === 'email') {
      chrome.runtime.sendMessage({ type: 'progress', message: 'Copying data & opening email...', percent: 98 });
      
      // Copy to Clipboard
      try {
        await navigator.clipboard.writeText(csvContent);
      } catch (err) {
        // Fallback for clipboard writing
        const textarea = document.createElement('textarea');
        textarea.value = csvContent;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      // Generate mailto link
      const emailSubject = encodeURIComponent('Monthly ForeFlight Weight & Balance Data');
      
      // Write email body with instructions and inline data (which might get truncated if extremely long, hence clipboard backup)
      const emailBody = encodeURIComponent(
        `Hi,\n\n` +
        `Here is the monthly ForeFlight Weight & Balance data CSV.\n\n` +
        `NOTE: The complete CSV data has also been automatically copied to your clipboard. If the text below appears truncated, you can simply clear the block below and paste (Ctrl+V) directly into this email.\n\n` +
        `=== CSV DATA START ===\n` +
        csvContent +
        `=== CSV DATA END ===\n\n` +
        `Best regards,\n` +
        `ForeFlight Exporter extension`
      );

      const mailtoUrl = `mailto:${recipientEmail}?subject=${emailSubject}&body=${emailBody}`;
      
      // Trigger mail client launch safely without redirecting page
      const mailLink = document.createElement('a');
      mailLink.href = mailtoUrl;
      mailLink.target = '_self';
      document.body.appendChild(mailLink);
      mailLink.click();
      document.body.removeChild(mailLink);

    } else {
      // Standard local CSV download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'aircraft_wb_rows.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    chrome.runtime.sendMessage({ type: 'success', rowCount: rows.length });

  } catch (err) {
    chrome.runtime.sendMessage({ type: 'error', message: err.message });
  }
}
