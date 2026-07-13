/**
 * ForeFlight Weight & Balance Scraper Bookmarklet
 * 
 * Instructions:
 * 1. Create a new bookmark in your browser (e.g. Chrome, Edge, Safari).
 * 2. Name it "ForeFlight Scraper".
 * 3. Copy the URL-friendly version of this script (prefixed with 'javascript:') and paste it into the URL/Address field of the bookmark.
 * 4. Navigate to plan.foreflight.com and log in.
 * 5. Click the bookmark. It will display a progress overlay and download the `aircraft_wb_rows.csv` file automatically.
 */

(async function() {
    // 1. Create a simple overlay UI to show progress
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.backgroundColor = 'rgba(26, 32, 44, 0.95)';
    overlay.style.color = '#e2e8f0';
    overlay.style.padding = '20px';
    overlay.style.borderRadius = '12px';
    overlay.style.zIndex = '999999';
    overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    overlay.style.fontSize = '14px';
    overlay.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)';
    overlay.style.border = '1px solid #4a5568';
    overlay.style.minWidth = '280px';
    overlay.style.transition = 'all 0.3s ease';
    overlay.innerHTML = `
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 10px; color: #fff; display: flex; align-items: center;">
            <svg style="width: 20px; height: 20px; margin-right: 8px; fill: #3182ce;" viewBox="0 0 24 24">
                <path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6zm-1 4v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
            </svg>
            ForeFlight W&B Scraper
        </div>
        <div id="ff-status" style="margin-bottom: 12px; color: #cbd5e0;">Initializing...</div>
        <div id="ff-progress" style="width: 100%; height: 6px; background-color: #4a5568; border-radius: 3px; overflow: hidden; display: none;">
            <div id="ff-progress-bar" style="width: 0%; height: 100%; background-color: #3182ce; transition: width 0.2s ease;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const setStatus = (msg, percent = null) => {
        document.getElementById('ff-status').innerText = msg;
        console.log('[FF Scraper]', msg);
        if (percent !== null) {
            const progress = document.getElementById('ff-progress');
            const bar = document.getElementById('ff-progress-bar');
            progress.style.display = 'block';
            bar.style.width = `${percent}%`;
        }
    };

    try {
        // 2. Extract XSRF token from cookies
        const xsrfCookie = document.cookie.split('; ').find(row => row.startsWith('_xsrf='));
        if (!xsrfCookie) {
            throw new Error('XSRF token cookie (_xsrf) not found. Make sure you are logged into plan.foreflight.com');
        }
        const xsrfToken = decodeURIComponent(xsrfCookie.split('=')[1]);
        
        // 3. Resolve Account ID
        let accountId = null;
        const urlMatch = window.location.pathname.match(/\/aircraft\/([a-f0-9\-]{36})/);
        if (urlMatch) {
            accountId = urlMatch[1];
        } else {
            setStatus('Resolving ForeFlight Account ID...');
            const subResp = await fetch('/account/api/subscription/simple');
            if (!subResp.ok) throw new Error(`Failed to fetch subscription: ${subResp.statusText}`);
            const subData = await subResp.json();
            accountId = subData?.subscription?.accountId;
        }

        if (!accountId) {
            throw new Error('Could not resolve ForeFlight Account ID. Please navigate to the Aircraft page and try again.');
        }
        setStatus(`Account ID: ${accountId.substring(0, 8)}...`);

        // 4. Fetch Aircraft list
        setStatus('Fetching aircraft list...');
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
        setStatus(`Found ${aircraftList.length} aircraft. Fetching details...`, 0);

        // Helper functions matching the python logic
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
        
        // 5. Fetch details for each aircraft (in concurrent batches of 5 to avoid throttling)
        const batchSize = 5;
        for (let i = 0; i < aircraftList.length; i += batchSize) {
            const batch = aircraftList.slice(i, i + batchSize);
            const pct = Math.round((i / aircraftList.length) * 100);
            setStatus(`Fetching aircraft details (${i + 1} - ${Math.min(i + batchSize, aircraftList.length)} of ${aircraftList.length})...`, pct);
            
            await Promise.all(batch.map(async (ac) => {
                const acUuid = ac.uuid;
                try {
                    const detailResp = await fetch(`/aircraft/api/v2/${accountId}/${acUuid}`, {
                        headers: {
                            'accept': '*/*',
                            'x-xsrftoken': xsrfToken
                        }
                    });
                    if (!detailResp.ok) {
                        console.error(`Failed to fetch detail for ${acUuid}: ${detailResp.statusText}`);
                        return;
                    }
                    const data = await detailResp.json();
                    
                    const aircraft = data.aircraft || {};
                    const wbProfiles = data.wbProfiles || [];

                    const tailNumber = firstText(
                        aircraft.tailNumber,
                        aircraft.callSign,
                        aircraft.callsign,
                        findKey(data, 'tailNumber')
                    );
                    const registration = firstText(
                        aircraft.otherInfoReg,
                        aircraft.registration,
                        aircraft.aircraftRegistration,
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

        // 6. Generate CSV
        setStatus('Generating CSV...', 100);
        // Sort by tail number, then registration
        rows.sort((a, b) => {
            const tailCompare = a.tail_number.localeCompare(b.tail_number);
            if (tailCompare !== 0) return tailCompare;
            return a.registration.localeCompare(b.registration);
        });

        let csvContent = 'tail_number,registration,basic_empty_weight,basic_empty_arm_longitudinal\n';
        for (let row of rows) {
            csvContent += `"${row.tail_number}","${row.registration}",${row.basic_empty_weight},${row.basic_empty_arm_longitudinal}\n`;
        }

        // 7. Trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'aircraft_wb_rows.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setStatus(`Success! Exported ${rows.length} weight & balance profile(s).`, 100);
        
        // Success animation details
        const progress = document.getElementById('ff-progress-bar');
        progress.style.backgroundColor = '#38a169'; // Green success bar
        
        setTimeout(() => {
            overlay.remove();
        }, 4000);

    } catch (err) {
        setStatus(`Error: ${err.message}`);
        console.error(err);
        overlay.style.backgroundColor = 'rgba(116, 26, 26, 0.95)';
        overlay.style.border = '1px solid #e53e3e';
        const progress = document.getElementById('ff-progress');
        if (progress) progress.style.display = 'none';
        
        const closeBtn = document.createElement('button');
        closeBtn.innerText = 'Close';
        closeBtn.style.marginTop = '12px';
        closeBtn.style.padding = '4px 12px';
        closeBtn.style.backgroundColor = '#e53e3e';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.color = 'white';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => overlay.remove();
        overlay.appendChild(closeBtn);
    }
})();
