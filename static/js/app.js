// Application State
let allUpdates = [];
let activeFilter = 'all';
let searchQuery = '';
let selectedUpdateId = null;

// DOM Elements
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
        }
        
        // Show cache warnings if server had to fallback
        if (result.warning) {
            feedStatus.textContent = `⚠️ Feed offline. Cached at ${timeStr}`;
        }
        
        // Reset selection
        selectedUpdateId = null;
        
        applyFilters();
    } catch (err) {
        console.error(err);
        errorMessage.textContent = err.message || 'An error occurred while connecting to the backend feed reader.';
        errorState.style.display = 'flex';
        loadingState.style.display = 'none';
        feedStatus.textContent = 'Connection failed';
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
    
    charCount.textContent = `${len} / ${limit}`;
    
    // Circle progress calculation (circumference is 100)
    const pct = Math.min((len / limit) * 100, 100);
    charProgressBar.setAttribute('stroke-dasharray', `${pct}, 100`);
    
    // Apply styling alerts
    charProgressBar.classList.remove('warning', 'danger');
    charCount.classList.remove('danger');
    postTweetBtn.disabled = false;
    
    if (len > limit) {
        charProgressBar.classList.add('danger');
        charCount.classList.add('danger');
        postTweetBtn.disabled = true;
    } else if (len > limit - 20) {
        charProgressBar.classList.add('warning');
    }
}

function closeComposer() {
    tweetModal.classList.remove('open');
    currentComposeUpdate = null;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch
    fetchReleases();
    
    // Refresh buttons
    refreshBtn.addEventListener('click', () => fetchReleases(true));
    retryBtn.addEventListener('click', () => fetchReleases(true));
    
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
