// Application State
let allUpdates = [];
let visibleUpdates = [];
let activeFilter = 'all';
let searchQuery = '';
let selectedUpdateId = null;

// DOM Elements
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const filterChips = document.getElementById('filter-chips');
const refreshBtn = document.getElementById('refresh-btn');
const refreshIcon = document.getElementById('refresh-icon');
const feedStatus = document.getElementById('feed-status');
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const feedContainer = document.getElementById('feed-container');
const retryBtn = document.getElementById('retry-btn');
const clearFiltersBtn = document.getElementById('clear-filters-btn');

// Modal Elements
const tweetModal = document.getElementById('tweet-modal');
const tweetTextarea = document.getElementById('tweet-textarea');
const charProgressBar = document.getElementById('char-progress-bar');
const charCount = document.getElementById('char-count');
const postTweetBtn = document.getElementById('post-tweet-btn');
const closeModalBtn = document.getElementById('close-modal');
const tweetPreviewDate = document.getElementById('tweet-preview-date');

// Map HTML types to standard categories
function getBadgeClass(type) {
    const t = type.toLowerCase();
    if (t.includes('feature')) return 'feature';
    if (t.includes('issue') || t.includes('bug')) return 'issue';
    if (t.includes('deprecation') || t.includes('removal')) return 'deprecation';
    if (t.includes('change') || t.includes('update')) return 'change';
    return 'general';
}

// Parse feed entries into individual updates
function parseFeedEntries(entries) {
    const updates = [];
    let updateIndex = 0;
    
    entries.forEach((entry, entryIdx) => {
        const date = entry.date;
        const link = entry.link;
        const contentHtml = entry.content;
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${contentHtml}</div>`, 'text/html');
        const children = Array.from(doc.body.firstChild.childNodes);
        
        let currentUpdate = null;
        
        children.forEach(child => {
            // Check if element is an H3 header denoting a category (e.g. Feature, Issue)
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'H3') {
                if (currentUpdate) {
                    updates.push(currentUpdate);
                }
                currentUpdate = {
                    id: `upd-${entryIdx}-${updateIndex++}`,
                    date: date,
                    link: link,
                    type: child.textContent.trim(),
                    htmlContent: '',
                    textContent: ''
                };
            } else {
                // Handle text/nodes prior to any H3 tags (fallback to general update)
                if (!currentUpdate) {
                    const txt = child.textContent.trim();
                    if (txt.length > 0) {
                        currentUpdate = {
                            id: `upd-${entryIdx}-${updateIndex++}`,
                            date: date,
                            link: link,
                            type: 'Update',
                            htmlContent: '',
                            textContent: ''
                        };
                    }
                }
                if (currentUpdate) {
                    currentUpdate.htmlContent += child.outerHTML || child.textContent;
                    currentUpdate.textContent += child.textContent;
                }
            }
        });
        
        if (currentUpdate) {
            updates.push(currentUpdate);
        }
        
        // Fallback for feeds with content but no parsed items
        if (updates.filter(u => u.date === date).length === 0 && contentHtml.trim().length > 0) {
            updates.push({
                id: `upd-${entryIdx}-${updateIndex++}`,
                date: date,
                link: link,
                type: 'Update',
                htmlContent: contentHtml,
                textContent: doc.body.textContent.trim()
            });
        }
    });
    
    // Cleanup spacing and clean text content
    return updates.map(upd => {
        // Clean double-spaces, trim lines, remove consecutive newlines
        upd.textContent = upd.textContent.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
        return upd;
    });
}

// Fetch releases from Flask API
async function fetchReleases(force = false) {
    // Show spinner/loading state
    loadingState.style.display = 'flex';
    feedContainer.style.display = 'none';
    errorState.style.display = 'none';
    emptyState.style.display = 'none';
    refreshBtn.classList.add('loading');
    feedStatus.textContent = force ? 'Refreshing notes...' : 'Loading latest notes...';
    
    try {
        const url = `/api/releases${force ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch release notes.');
        }
        
        allUpdates = parseFeedEntries(result.data);
        
        // Show status summary
        const timeStr = new Date(result.last_fetched * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (result.from_cache) {
            feedStatus.textContent = `Cached at ${timeStr}`;
        } else {
            feedStatus.textContent = `Refreshed at ${timeStr}`;
            if (force) {
                showToast('Release notes updated successfully.', 'success');
            }
        }
        
        // Show cache warnings if server had to fallback
        if (result.warning) {
            feedStatus.textContent = `⚠️ Feed offline. Cached at ${timeStr}`;
            showToast(result.warning, 'warning');
        }
        
        // Reset selection
        selectedUpdateId = null;
        
        applyFilters();
        
        // Scroll to deep-link hash element if present
        const hash = window.location.hash;
        if (hash) {
            const targetId = hash.substring(1);
            setTimeout(() => {
                const element = document.getElementById(targetId);
                if (element) {
                    toggleRowSelection(targetId);
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    showToast('Navigated to shared update note.', 'success');
                }
            }, 500);
        }
    } catch (err) {
        console.error(err);
        errorMessage.textContent = err.message || 'An error occurred while connecting to the backend feed reader.';
        errorState.style.display = 'flex';
        loadingState.style.display = 'none';
        feedStatus.textContent = 'Connection failed';
        showToast('Failed to fetch release notes.', 'error');
    } finally {
        refreshBtn.classList.remove('loading');
    }
}

// Apply Active filters and searches
function applyFilters() {
    const query = searchQuery.toLowerCase().trim();
    const typeFilter = activeFilter.toLowerCase();
    
    const filtered = allUpdates.filter(upd => {
        // Filter by update type
        let matchesType = false;
        if (typeFilter === 'all') {
            matchesType = true;
        } else if (typeFilter === 'change') {
            // Group other general updates and "change" types together
            const badgeType = getBadgeClass(upd.type);
            matchesType = (badgeType === 'change' || badgeType === 'general');
        } else {
            matchesType = getBadgeClass(upd.type) === typeFilter;
        }
        
        // Filter by search query
        const matchesQuery = !query || 
            upd.textContent.toLowerCase().includes(query) ||
            upd.type.toLowerCase().includes(query) ||
            upd.date.toLowerCase().includes(query);
            
        return matchesType && matchesQuery;
    });
    
    visibleUpdates = filtered;
    if (exportCsvBtn) {
        if (visibleUpdates.length > 0) {
            exportCsvBtn.style.display = 'inline-flex';
        } else {
            exportCsvBtn.style.display = 'none';
        }
    }
    
    renderTimeline(filtered);
    updateCounts();
}

// Update badges counter counts in the UI
function updateCounts() {
    const counts = { all: allUpdates.length, feature: 0, issue: 0, deprecation: 0, change: 0 };
    
    allUpdates.forEach(upd => {
        const badgeType = getBadgeClass(upd.type);
        if (badgeType === 'general') {
            counts['change']++;
        } else if (counts.hasOwnProperty(badgeType)) {
            counts[badgeType]++;
        }
    });
    
    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-feature').textContent = counts.feature;
    document.getElementById('count-issue').textContent = counts.issue;
    document.getElementById('count-deprecation').textContent = counts.deprecation;
    document.getElementById('count-change').textContent = counts.change;
    
    // Update sidebar stat counters
    const uniqueDates = new Set(allUpdates.map(upd => upd.date)).size;
    document.getElementById('stat-total-notes').textContent = uniqueDates;
    document.getElementById('stat-total-updates').textContent = allUpdates.length;
}

// Render filtered timeline notes
function renderTimeline(filteredUpdates) {
    loadingState.style.display = 'none';
    
    if (filteredUpdates.length === 0) {
        feedContainer.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    
    emptyState.style.display = 'none';
    feedContainer.style.display = 'flex';
    feedContainer.innerHTML = '';
    
    // Group updates back by Date to show a clean grouped history UI
    const groups = {};
    filteredUpdates.forEach(upd => {
        if (!groups[upd.date]) {
            groups[upd.date] = {
                date: upd.date,
                link: upd.link,
                updates: []
            };
        }
        groups[upd.date].updates.push(upd);
    });
    
    Object.values(groups).forEach(group => {
        const dayCard = document.createElement('article');
        dayCard.className = 'day-card';
        
        const dayHeader = document.createElement('header');
        dayHeader.className = 'day-header';
        dayHeader.innerHTML = `
            <div class="day-title-wrap">
                <svg class="day-icon" viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M19,4H18V2a1,1,0,0,0-2,0V4H8V2A1,1,0,0,0,6,2V4H5A3,3,0,0,0,2,7V19a3,3,0,0,0,3,3H19a3,3,0,0,0,3-3V7A3,3,0,0,0,19,4Zm1,15a1,1,0,0,1-1,1H5a1,1,0,0,1-1-1V9H20ZM20,7H4V7A1,1,0,0,1,5,6H19a1,1,0,0,1,1,1Z"/>
                </svg>
                <h3 class="day-date">${group.date}</h3>
            </div>
            <a href="${group.link}" target="_blank" rel="noopener noreferrer" class="day-link" title="Open official documentation">
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M19,19H5V5h7V3H5a2,2,0,0,0-2,2V19a2,2,0,0,0,2,2H19a2,2,0,0,0,2-2V12H19ZM14,3v2h3.59L8.83,13.76l1.41,1.41L19,6.41V10h2V3Z"/>
                </svg>
            </a>
        `;
        dayCard.appendChild(dayHeader);
        
        const listDiv = document.createElement('div');
        listDiv.className = 'day-updates-list';
        
        group.updates.forEach(upd => {
            const updateItem = document.createElement('div');
            updateItem.className = 'update-item';
            if (selectedUpdateId === upd.id) {
                updateItem.classList.add('selected');
            }
            updateItem.id = upd.id;
            
            const badgeClass = getBadgeClass(upd.type);
            
            updateItem.innerHTML = `
                <div class="update-select-area">
                    <button class="select-checkbox" aria-label="Select update row" tabindex="0">
                        <svg viewBox="0 0 24 24" width="12" height="12">
                            <path fill="none" stroke="currentColor" stroke-width="3.5" d="M5 12l5 5L20 7" class="select-check-icon"/>
                        </svg>
                    </button>
                </div>
                <div class="update-body">
                    <div class="update-meta">
                        <span class="badge ${badgeClass}">${upd.type}</span>
                    </div>
                    <div class="update-content">${upd.htmlContent}</div>
                    <div class="update-actions">
                        <button class="btn-copy" aria-label="Copy update text to clipboard">
                            <svg viewBox="0 0 24 24" width="14" height="14" class="icon-copy">
                                <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                            </svg>
                            <span>Copy</span>
                        </button>
                        <button class="btn-share-link" aria-label="Copy deep link to this update">
                            <svg viewBox="0 0 24 24" width="14" height="14">
                                <path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                            </svg>
                            <span>Link</span>
                        </button>
                        <button class="btn-tweet" aria-label="Tweet this specific update">
                            <svg viewBox="0 0 24 24" width="14" height="14">
                                <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                            </svg>
                            <span>Tweet</span>
                        </button>
                    </div>
                </div>
            `;
            
            // Wire card selection interaction
            updateItem.addEventListener('click', (e) => {
                // Ignore clicks on anchors and elements inside anchors to allow hyperlink navigation
                if (e.target.tagName === 'A' || e.target.closest('a')) {
                    return;
                }
                
                // If they click the Copy button, copy the text to clipboard
                const copyBtn = e.target.closest('.btn-copy');
                if (copyBtn) {
                    e.stopPropagation();
                    copyUpdateToClipboard(upd, copyBtn);
                    return;
                }
                
                // If they click the Share Link button, copy deep link to clipboard
                const shareLinkBtn = e.target.closest('.btn-share-link');
                if (shareLinkBtn) {
                    e.stopPropagation();
                    copyDeepLink(upd, shareLinkBtn);
                    return;
                }
                
                // Toggle row selection on click
                toggleRowSelection(upd.id);
                
                // If they click the Tweet button or its children, open the Tweet Composer Modal
                if (e.target.closest('.btn-tweet')) {
                    e.stopPropagation();
                    openTweetComposer(upd);
                }
            });
            
            // Support keyboard navigation on select checkbox
            const checkbox = updateItem.querySelector('.select-checkbox');
            checkbox.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleRowSelection(upd.id);
                }
            });
            
            listDiv.appendChild(updateItem);
        });
        
        dayCard.appendChild(listDiv);
        feedContainer.appendChild(dayCard);
    });
    
    // Apply keyword search highlighting if query is active
    const q = searchQuery.trim();
    if (q.length > 0) {
        document.querySelectorAll('.update-content').forEach(element => {
            highlightSearchTerm(element, q);
        });
    }
}

// Select/highlight rows
function toggleRowSelection(id) {
    const selectedItem = document.getElementById(id);
    
    if (selectedUpdateId === id) {
        // Toggle selection off if already selected
        selectedUpdateId = null;
        if (selectedItem) selectedItem.classList.remove('selected');
    } else {
        // Clear previous selection
        if (selectedUpdateId) {
            const prev = document.getElementById(selectedUpdateId);
            if (prev) prev.classList.remove('selected');
        }
        selectedUpdateId = id;
        if (selectedItem) selectedItem.classList.add('selected');
    }
}

// Tweet Composer Logic
let currentComposeUpdate = null;

function openTweetComposer(upd) {
    currentComposeUpdate = upd;
    
    // Generate draft tweet content
    const header = `📢 BigQuery Update [${upd.date}]\n`;
    const footer = `\n\nRead details: ${upd.link}`;
    
    // URL character limit counts as 23 characters for Twitter.
    // Calculate space available for the body.
    const twitterUrlLength = 23;
    const spacingBuffer = header.length + 2 + twitterUrlLength + 5; // spacing + "Read details: " + t.co URL + buffer
    const maxBodyLen = 280 - spacingBuffer;
    
    let body = `${upd.type}: ${upd.textContent}`;
    if (body.length > maxBodyLen) {
        body = body.substring(0, maxBodyLen - 3) + '...';
    }
    
    tweetTextarea.value = `${header}${body}${footer}`;
    tweetPreviewDate.textContent = upd.date;
    
    // Open modal with smooth fade
    tweetModal.classList.add('open');
    tweetTextarea.focus();
    updateCharCounter();
}

function updateCharCounter() {
    const text = tweetTextarea.value;
    const len = text.length;
    const limit = 280;
    
    // Circle progress calculation (circumference is 100)
    const pct = Math.min((len / limit) * 100, 100);
    charProgressBar.setAttribute('stroke-dasharray', `${pct}, 100`);
    
    // Apply styling alerts
    charProgressBar.classList.remove('warning', 'danger');
    charCount.classList.remove('danger');
    postTweetBtn.disabled = false;
    
    if (len > limit) {
        charCount.textContent = `-${len - limit} characters over`;
        charProgressBar.classList.add('danger');
        charCount.classList.add('danger');
        postTweetBtn.disabled = true;
    } else {
        charCount.textContent = `${len} / ${limit}`;
        if (len > limit - 20) {
            charProgressBar.classList.add('warning');
        }
    }
}

function closeComposer() {
    tweetModal.classList.remove('open');
    currentComposeUpdate = null;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Theme Switcher
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        updateThemeToggleIcon();
    }
    
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('light-theme');
            const isLight = document.body.classList.contains('light-theme');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            updateThemeToggleIcon();
        });
    }

    // Initial fetch
    fetchReleases();
    
    // Refresh buttons
    refreshBtn.addEventListener('click', () => fetchReleases(true));
    retryBtn.addEventListener('click', () => fetchReleases(true));
    
    // Export CSV button
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => exportToCSV(visibleUpdates));
    }
    
    // Search input handlers
    let searchDebounce;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounce);
        searchQuery = e.target.value;
        
        // Show/hide clear button
        clearSearchBtn.style.display = searchQuery ? 'flex' : 'none';
        
        searchDebounce = setTimeout(() => {
            applyFilters();
        }, 150);
    });
    
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.style.display = 'none';
        applyFilters();
        searchInput.focus();
    });
    
    // Category chips click handler
    filterChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        
        activeFilter = chip.dataset.type;
        applyFilters();
    });
    
    // Clear filters empty state helper
    clearFiltersBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.style.display = 'none';
        
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.chip[data-type="all"]').classList.add('active');
        activeFilter = 'all';
        
        applyFilters();
    });
    
    // Tweet Composer key listener & buttons
    tweetTextarea.addEventListener('input', updateCharCounter);
    
    // Add Ctrl+Enter shortcut to send tweet
    tweetTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            if (!postTweetBtn.disabled) {
                e.preventDefault();
                postTweetBtn.click();
            }
        }
    });
    
    closeModalBtn.addEventListener('click', closeComposer);
    
    // Close modal when clicking outside card area
    tweetModal.addEventListener('click', (e) => {
        if (e.target === tweetModal) {
            closeComposer();
        }
    });
    
    // Press ESC to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tweetModal.classList.contains('open')) {
            closeComposer();
        }
    });
    
    // Tweet Post action (Twitter Web Intent)
    postTweetBtn.addEventListener('click', () => {
        if (!currentComposeUpdate) return;
        const text = tweetTextarea.value;
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        window.open(tweetUrl, '_blank', 'noopener,noreferrer');
        closeComposer();
    });
});

// Helper: Copy individual update to clipboard
function copyUpdateToClipboard(upd, btn) {
    const textToCopy = `[BigQuery Release Note - ${upd.date}]\nType: ${upd.type}\n\n${upd.textContent}\n\nRead details: ${upd.link}`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        const origContent = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="none" stroke="currentColor" stroke-width="3.5" d="M5 12l5 5L20 7"/>
            </svg>
            <span>Copied!</span>
        `;
        showToast('Update details copied to clipboard.', 'success');
        
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = origContent;
        }, 1500);
    }).catch(err => {
        console.error('Could not copy update text to clipboard: ', err);
        showToast('Failed to copy. Please copy manually.', 'error');
    });
}

// Helper: Copy deep link to clipboard
function copyDeepLink(upd, btn) {
    const deepLink = `${window.location.origin}${window.location.pathname}#${upd.id}`;
    
    navigator.clipboard.writeText(deepLink).then(() => {
        const origContent = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="none" stroke="currentColor" stroke-width="3.5" d="M5 12l5 5L20 7"/>
            </svg>
            <span>Copied!</span>
        `;
        showToast('Deep link copied to clipboard.', 'success');
        
        // Update URL hash without reload
        history.replaceState(null, null, `#${upd.id}`);
        
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = origContent;
        }, 1500);
    }).catch(err => {
        console.error('Could not copy deep link to clipboard: ', err);
        showToast('Failed to copy link.', 'error');
    });
}

// Helper: Export currently visible updates to CSV
function exportToCSV(updates) {
    if (!updates || updates.length === 0) {
        showToast('No updates to export.', 'warning');
        return;
    }
    
    const headers = ['Date', 'Type', 'Description', 'Link'];
    const rows = updates.map(upd => [
        upd.date,
        upd.type,
        upd.textContent.replace(/"/g, '""'), // Escape double-quotes for CSV compliance
        upd.link
    ]);
    
    // Construct CSV String
    const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(val => `"${val}"`).join(','))
    ].join('\n');
    
    // Trigger download
    try {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `bigquery_release_notes_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(`Exported ${updates.length} release notes to CSV.`, 'success');
    } catch (err) {
        console.error(err);
        showToast('Failed to export CSV.', 'error');
    }
}

// Helper: Update theme icon on switcher button
function updateThemeToggleIcon() {
    if (!themeToggleBtn) return;
    const isLight = document.body.classList.contains('light-theme');
    if (isLight) {
        // Show Moon Icon (for switching to dark mode)
        themeToggleBtn.innerHTML = `
            <svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12.3,2a10,10,0,0,0-1.9.2,1,1,0,0,0-.7,1.2,1,1,0,0,0,1.2.7A8,8,0,0,1,12,18a8,8,0,0,1-7-4.1,1,1,0,0,0-1.2-.5,1,1,0,0,0-.7,1.2,10,10,0,0,0,19.2,1.7,1,1,0,0,0-.6-1.2,1,1,0,0,0-1.2.6A8,8,0,0,1,12.3,2Z"/>
            </svg>
        `;
        themeToggleBtn.setAttribute('title', 'Switch to Dark Theme');
    } else {
        // Show Sun Icon (for switching to light mode)
        themeToggleBtn.innerHTML = `
            <svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12,7a5,5,0,1,0,5,5A5,5,0,0,0,12,7Zm0,8a3,3,0,1,1,3-3A3,3,0,0,1,12,15Zm0-11a1,1,0,0,0,1-1V2a1,1,0,0,0-2,0V3A1,1,0,0,0,12,4Zm0,16a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V21A1,1,0,0,0,12,20ZM20,11H19a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2ZM5,11H4a1,1,0,0,0,0,2H5a1,1,0,0,0,0-2Zm13.22-4.8a1,1,0,0,0,1.41-1.41l-.71-.71a1,1,0,1,0-1.41,1.41ZM6.5,16.09a1,1,0,0,0-1.41,1.41l.71.71a1,1,0,0,0,1.41-1.41ZM18.22,16.09a1,1,0,0,0-1.41,1.41l.71.71a1,1,0,0,0,1.41-1.41ZM6.5,5.69a1,1,0,0,0,1.41-1.41l-.71-.71A1,1,0,0,0,5.79,5l.71.71Z"/>
            </svg>
        `;
        themeToggleBtn.setAttribute('title', 'Switch to Light Theme');
    }
}

// Helper: Show floating toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Trigger reflow to animate
    toast.offsetHeight;
    toast.classList.add('show');
    
    // Automatically remove after 3.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, 3500);
}

// Helper: Highlight matching query keywords in text nodes
function highlightSearchTerm(element, query) {
    if (!query) return;
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const nodesToReplace = [];
    while (node = walk.nextNode()) {
        const parent = node.parentNode;
        if (parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE' && parent.tagName !== 'MARK' && node.nodeValue.match(regex)) {
            nodesToReplace.push(node);
        }
    }
    
    nodesToReplace.forEach(node => {
        const parent = node.parentNode;
        const text = node.nodeValue;
        const temp = document.createElement('span');
        temp.innerHTML = text.replace(regex, '<mark class="highlight">$1</mark>');
        
        while (temp.firstChild) {
            parent.insertBefore(temp.firstChild, node);
        }
        parent.removeChild(node);
    });
}

// Helper: Escape Regex special characters
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
