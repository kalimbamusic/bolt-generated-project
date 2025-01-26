document.getElementById('extractHours').addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  
  try {
    const targetUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/Attendance/calendarpage.aspx?isOnSelf=true';
    const homeUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/ng/personal-file/home';
    const hrPortalUrl = 'https://hrm-portal.malam-payroll.com/timesheets/timesheets-report/calendar';
    
    // Function to wait for navigation
    const waitForNavigation = (tabId) => {
      return new Promise(resolve => {
        browser.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === 'complete') {
            browser.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    };

    // Check if we're on the correct page
    if (tab.url !== targetUrl) {
      console.log('Not on target page, redirecting...');
      await browser.tabs.update(tab.id, { url: targetUrl });
      
      // Wait for navigation to complete
      await waitForNavigation(tab.id);
      
      // If we land on the home page, redirect again
      const updatedTab = await browser.tabs.get(tab.id);
      if (updatedTab.url === homeUrl) {
        console.log('Landed on home page, redirecting to target...');
        await browser.tabs.update(tab.id, { url: targetUrl });
        await waitForNavigation(tab.id);
      }
      
      // Give the page a moment to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Step 1: Select all relevant days
    console.log('Step 1: Selecting days...');
    const selectionResult = await browser.tabs.executeScript(tab.id, {
      code: `(${selectHilanDays.toString()})()`
    });
    console.log('Selection completed:', selectionResult[0]);

    // Step 2: Wait for a moment and click the "Selected Days" button
    console.log('Step 2: Clicking Selected Days button...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await browser.tabs.executeScript(tab.id, {
      code: `(${clickSelectedDaysButton.toString()})()`
    });

    // Step 3: Wait for the table to load and then extract data
    console.log('Step 3: Waiting for table and extracting data...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await browser.tabs.executeScript(tab.id, {
      code: `(${extractDetailedHours.toString()})()`
    });
    
    console.log('Extraction completed:', result[0]);
    displayResults(result[0]);

    // Step 4: Navigate to HR Portal and inject data
    if (result[0] && result[0].length > 0) {
      console.log('Navigating to HR Portal...');
      await browser.tabs.update(tab.id, { url: hrPortalUrl });
      await waitForNavigation(tab.id);
      
      // Wait for the page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Inject and execute the data injection function
      await browser.tabs.executeScript(tab.id, {
        code: `(${injectHoursToHRPortal.toString()})(${JSON.stringify(result[0])})`
      });
    }
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('result').textContent = 'Error: ' + error.message;
  }
});

function displayResults(data) {
  const resultDiv = document.getElementById('result');
  console.log('Raw data:', data);
  
  if (!data || data.length === 0) {
    resultDiv.textContent = 'No hours found. Debug info: ' + JSON.stringify(data);
    return;
  }

  // Create a Map to store unique dates
  const uniqueDays = new Map();
  data.forEach(day => {
    const date = parseInt(day.date);
    if (!isNaN(date) && date <= 31 && !uniqueDays.has(date)) {
      uniqueDays.set(date, day);
    }
  });

  console.log('Unique days:', Array.from(uniqueDays.values()));

  // Convert Map to array and sort by date
  const sortedDays = Array.from(uniqueDays.values())
    .sort((a, b) => parseInt(a.date) - parseInt(b.date));

  // Get the year from the first entry (they should all be the same)
  const year = sortedDays[0]?.year || new Date().getFullYear().toString();

  const table = document.createElement('table');
  table.innerHTML = `
    <tr>
      <th colspan="4" style="text-align: center; background-color: #f8f9fa;">Year: ${year}</th>
    </tr>
    <tr>
      <th>Date</th>
      <th>Entrance</th>
      <th>Exit</th>
      <th>Total</th>
    </tr>
    ${sortedDays.map(day => `
      <tr>
        <td>${day.date}</td>
        <td>${day.entrance || '-'}</td>
        <td>${day.exit || '-'}</td>
        <td>${day.total || '-'}</td>
      </tr>
    `).join('')}
  `;
  
  resultDiv.innerHTML = '';
  resultDiv.appendChild(table);
}

function selectHilanDays() {
  // Find all date cells
  const dateCells = document.querySelectorAll('td[class*="calendarDayFireFox"]');
  let selectedCount = 0;

  dateCells.forEach(cell => {
    // Check if the cell has a valid time entry
    const timeCell = cell.querySelector('.cDM');
    const dateCell = cell.querySelector('.dTS');
    
    if (timeCell && timeCell.textContent.trim() !== '' && 
        dateCell && parseInt(dateCell.textContent.trim()) <= 31) {
      // If not already selected
      if (!cell.classList.contains('CSD')) {
        cell.click();
        selectedCount++;
      }
    }
  });

  return `Selected ${selectedCount} dates`;
}

function clickSelectedDaysButton() {
  const selectedDaysButton = document.getElementById('ctl00_mp_RefreshSelectedDays');
  if (selectedDaysButton) {
    console.log('Clicking selected days button');
    selectedDaysButton.click();
    return true;
  } else {
    console.error('Selected days button not found');
    return false;
  }
}

function extractDetailedHours() {
  const days = [];
  
  // Extract year from the month selector
  const monthSelector = document.getElementById('ctl00_mp_calendar_monthChanged');
  const yearMatch = monthSelector?.textContent.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
  
  // Get all rows from the detailed view
  const detailsTable = document.querySelector('table[id*="RG_Days_"]');
  if (!detailsTable) {
    console.error('Details table not found');
    return days;
  }

  const rows = detailsTable.querySelectorAll('tr[id*="_row_"]');
  console.log('Found detail rows:', rows.length);
  
  rows.forEach((row, index) => {
    try {
      // Get all cells in the row
      const cells = row.getElementsByTagName('td');
      console.log(`Processing row ${index}:`, cells.length, 'cells');
      
      if (cells.length >= 4) {
        const date = cells[0]?.textContent?.trim();
        
        // Extract entrance time (from the third column)
        const entranceInput = cells[5]?.querySelector('input[id*="ManualEntry"]');
        const entrance = entranceInput?.value || cells[5]?.getAttribute('ov') || '';
        
        // Extract exit time (from the fourth column)
        const exitInput = cells[6]?.querySelector('input[id*="ManualExit"]');
        const exit = exitInput?.value || cells[6]?.getAttribute('ov') || '';
        
        // Extract total time (from the first column after date)
        const totalCell = cells[7];
        let total = '';
        
        if (totalCell) {
          // Try to get total from span first
          const totalSpan = totalCell.querySelector('span[class*="ROC"]');
          if (totalSpan) {
            total = totalSpan.textContent.trim();
          } else {
            // Fallback to cell's ov attribute
            total = totalCell.getAttribute('ov') || '';
          }
        }
        
        console.log('Row data:', { date, entrance, exit, total, year });
        
        if (date && parseInt(date) <= 31) {
          days.push({
            date,
            entrance,
            exit,
            total,
            year
          });
        }
      }
    } catch (error) {
      console.error('Error processing row:', error);
    }
  });
  
  console.log('Extracted days:', days);
  return days;
}

function injectHoursToHRPortal(hoursData) {
  async function processDay(dayData) {
    try {
      // Format the date to ensure it's two digits (e.g., "1" becomes "01")
      const formattedDate = dayData.date.padStart(2, '0');
      
      // Get the current month (01-12)
      const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
      
      // Create the date format that matches the class (YYYY-MM-DD)
      const fullDateFormat = `${dayData.year}-${currentMonth}-${formattedDate}`;
      
      // Find the day element directly using the full date format
      const dayElement = document.querySelector(`div.cv-day[class*="d${fullDateFormat}"]`);
      
      if (!dayElement) {
        console.error(`Day element not found for date: ${fullDateFormat}`);
        return;
      }

      dayElement.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click the "Add Report" button
      const addButton = document.querySelector('span.v-btn__content i.far.fa-plus')?.closest('button');
      if (!addButton) {
        console.error('Add report button not found');
        return;
      }
      addButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fill in entrance time
      const entranceInput = document.querySelector('input[aria-label="שדה טקסט שעת כניסה"]');
      if (entranceInput && dayData.entrance) {
        entranceInput.value = dayData.entrance;
        entranceInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Fill in exit time
      const exitInput = document.querySelector('input[aria-label="שדה טקסט שעת יציאה"]');
      if (exitInput && dayData.exit) {
        exitInput.value = dayData.exit;
        exitInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Click save button
      const saveButton = Array.from(document.querySelectorAll('span.v-btn__content'))
        .find(span => span.textContent.includes('שמירה'))
        ?.closest('button');
      
      if (saveButton) {
        saveButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error('Save button not found');
      }
    } catch (error) {
      console.error(`Error processing day ${dayData.date}:`, error);
    }
  }

  // Process each day sequentially
  async function processAllDays() {
    for (const dayData of hoursData) {
      await processDay(dayData);
      // Wait between processing days to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Start processing
  processAllDays().then(() => {
    console.log('Finished processing all days');
  }).catch(error => {
    console.error('Error processing days:', error);
  });
}