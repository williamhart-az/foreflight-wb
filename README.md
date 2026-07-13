# ForeFlight Weight & Balance Exporter

A lightweight set of tools to extract aircraft weight and balance (W&B) profiles from your ForeFlight Web account (`plan.foreflight.com`) and export them into a standardized CSV file. 

This repository contains three methods for performing the export, ranging from a zero-install browser console script to a full Edge/Chrome browser extension and a Python backend script.

---

## 📋 Table of Contents
1. [Overview & Security Details](#overview--security-details)
2. [Method 1: Edge/Chrome Extension (Recommended)](#method-1-edgechrome-extension-recommended)
3. [Method 2: DevTools Console Script (Zero-Install)](#method-2-devtools-console-script-zero-install)
4. [Method 3: Python Scraper Script](#method-3-python-scraper-script)
5. [CSV Output Schema](#csv-output-schema)

---

## 🔒 Overview & Security Details

ForeFlight implements strict security controls to protect user data, including a strict **Content Security Policy (CSP)**. The server specifies a `script-src 'strict-dynamic'` header with a session `nonce`. This means:
*   **No Bookmarklets:** Standard browser bookmarklets are blocked by the browser when run on `plan.foreflight.com` because they lack the cryptographic nonce.
*   **Cookie Authentication:** All API requests require valid session cookies and an `x-xsrftoken` header.
*   **HAR Privacy Warning:** If you capture network traffic via a HAR file to debug API requests, **do not share it publicly**. HAR files often contain sensitive headers or session tokens, even if cookie values are stripped by default in some browsers. Always use `.gitignore` to prevent committing `.har` or `.csv` files containing actual tail numbers and weights.

---

## 🧩 Method 1: Edge/Chrome Extension (Recommended)

Browser extensions run in a privileged sandbox context. The browser exempts them from the website's CSP, making this the most robust, CSP-immune method to extract the data with a single click.

### 📥 Installation Instructions
1.  Download or clone this repository.
2.  Open your browser and navigate to the extensions page:
    *   **Microsoft Edge:** Navigate to `edge://extensions/`
    *   **Google Chrome:** Navigate to `chrome://extensions/`
3.  Turn **ON** the **Developer mode** toggle (usually in the bottom-left or top-right corner).
4.  Click the **Load unpacked** button.
5.  Select the `foreflight-extension` directory from this repository.

### 🚀 How to Use
1.  Go to [plan.foreflight.com](https://plan.foreflight.com) and log in.
2.  Click the **puzzle piece / extensions icon** in the browser toolbar and select **ForeFlight W&B Scraper**.
3.  Click the **Export W&B to CSV** button.
4.  The extension will fetch the aircraft list, parse the W&B profiles in concurrent batches, and automatically download `aircraft_wb_rows.csv` to your computer.

---

## 💻 Method 2: DevTools Console Script (Zero-Install)

If you do not want to install a browser extension, you can execute the raw scraping script directly in the browser's DevTools console. The browser permits manually pasted script execution regardless of the page's CSP.

### 🚀 How to Use
1.  Navigate to [plan.foreflight.com](https://plan.foreflight.com) and log in.
2.  Open Developer Tools:
    *   Press **`F12`** (or `Ctrl+Shift+I` on Windows, `Cmd+Opt+I` on Mac).
    *   Click on the **Console** tab.
3.  *(First-time use only)* If your browser prevents pasting for security reasons, type **`allow pasting`** and press **Enter** to unlock the console.
4.  Copy the contents of the [foreflight_scraper_bookmarklet.js](foreflight_scraper_bookmarklet.js) file.
5.  Paste it into the console and press **Enter**.
6.  A status overlay will appear in the top-right corner of the page, fetch the details, and automatically trigger a download of the CSV.

---

## 🐍 Method 3: Python Scraper Script

A standalone Python script is provided in [foreflight_wb_sync_sanitized.py](foreflight_wb_sync_sanitized.py) for environments where you want to automate the scrape outside of a browser.

### 🚀 How to Use
1.  Log in to [plan.foreflight.com](https://plan.foreflight.com) in your browser.
2.  Open your browser's Developer Tools (F12) -> Network tab, and find any request to the `aircraft/api` endpoint.
3.  Copy the following values from the request headers:
    *   `Cookie` request header
    *   `x-xsrf-token` (or `x-xsrftoken`) header
    *   `Account ID` (visible in the API endpoint path: `/aircraft/api/v2/{account_id}/...`)
4.  Set these values as environment variables:
    ```bash
    export FOREFLIGHT_ACCOUNT_ID="your-account-uuid"
    export FOREFLIGHT_COOKIE_HEADER="your-full-cookie-string"
    export FOREFLIGHT_XSRF_TOKEN="your-xsrf-token-value"
    ```
    *(On Windows PowerShell, use `$env:FOREFLIGHT_ACCOUNT_ID="your-account-uuid"`, etc.)*
5.  Run the script:
    ```bash
    python foreflight_wb_sync_sanitized.py --output aircraft_wb_rows.csv
    ```

---

## 📊 CSV Output Schema

The exporter generates a CSV containing the following columns:

| Column | Type | Description |
| :--- | :--- | :--- |
| `tail_number` | `string` | The aircraft tail number or callsign (e.g. `VAR402`). |
| `registration` | `string` | The aircraft registration number (e.g. `N402AV`). |
| `basic_empty_weight` | `decimal` | The basic empty weight of the aircraft (e.g. `2201.00000000`). |
| `basic_empty_arm_longitudinal` | `decimal` | The longitudinal center of gravity (CG) arm (e.g. `143.90000000`). |

---

## ⚖️ License

This project is for educational and personal use only. ForeFlight is a registered trademark of ForeFlight, LLC. This project is not affiliated with, sponsored by, or endorsed by ForeFlight, LLC.
