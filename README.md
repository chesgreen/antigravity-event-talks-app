# BigQuery Release Pulse

**BigQuery Release Pulse** is a premium, responsive web dashboard built with Python Flask and vanilla HTML, CSS, and JavaScript. It aggregates, caches, and parses Google Cloud's official BigQuery release notes, delivering a clean interface with dynamic filtering, local search, CSV exporting, and social sharing capabilities.

---

## ✨ Features

- **⚡ Server-Side Caching & Fault Tolerance**: Fetches the official Atom XML feed and caches the parsed data for **5 minutes** in memory. If Google Cloud's servers are down or rate-limiting hits, it automatically serves the last cached copy with a warning indicator.
- **🔍 Client-Side Sub-Parsing**: GCP release entries bundle multiple updates (Features, Issues, Deprecations) under a single date block. The client parses these using the native browser `DOMParser` to isolate and highlight individual updates.
- **🏷️ Multi-Filter & Keyup Search**: Filter the timeline dynamically by category badges (Features, Issues, Deprecations, Changes) with active counters, or search by typing keywords.
- **📋 Copy to Clipboard**: Copy formatted release notes (`[Date] Type - Summary + Link`) directly to your clipboard. Features immediate checkmark visual feedback.
- **🐦 Social Share (X/Twitter Intent)**: Select any update to open a custom-designed X/Twitter composer modal. It auto-drafts the post, displays a circular character progress bar, and enforces the 280-character limit before opening X.
- **📥 Export to CSV**: Download the **currently filtered** timeline directly as a `.csv` spreadsheet file, containing date, update type, description, and link columns.
- **🌓 Light/Dark Theme Switcher**: Toggle the UI color scheme via a header switch. Theme preferences are persisted locally using `localStorage` so they remain active on page refreshes.

---

## 🛠️ Technology Stack

- **Backend**: Python Flask (3.1+)
- **Parser Engine**: Standard library `urllib.request` and `xml.etree.ElementTree` (zero external parsing dependencies)
- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Custom Variables, Flexbox/Grid layouts, Backdrop filters), and Vanilla ES6 JavaScript (DOMParser, Clipboard API)

---

## 📂 Project Structure

```bash
bq-releases-notes/
│
├── app.py                # Flask server, feed fetching, caching, and API routing
├── explain_app.py.md     # Detailed technical explanation of app.py
├── .gitignore            # Git exclusion rules (venv, pycache, OS files)
├── README.md             # Project documentation (this file)
│
├── templates/
│   └── index.html        # Main dashboard structure & Twitter composer modal
│
└── static/
    ├── css/
    │   └── style.css     # CSS variable stylesheet (Light/Dark themes, responsive panels)
    └── js/
        └── app.js        # Timeline parser, category filters, and modal controller
```

---

## 🚀 Getting Started

### 1. Prerequisites
Make sure you have **Python 3.x** and **Flask** installed:
```bash
pip install flask
```

### 2. Running the Application
1. Clone or navigate to the repository directory:
   ```bash
   cd D:\DataJourney\Kaggle\agy-cli-projects\bq-releases-notes
   ```
2. Start the local server:
   ```bash
   python app.py
   ```
3. Open your browser and navigate to:
   **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 📄 License
This project is open-source and available under the MIT License. Data feeds are parsed from Google Cloud Platform documentation.
