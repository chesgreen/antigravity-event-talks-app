import os
import urllib.request
import xml.etree.ElementTree as ET
import time
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Cache setup: Cache release notes for 5 minutes (300 seconds) to prevent redundant external API hits
CACHE_DURATION = 300
cache = {
    "data": None,
    "last_fetched": 0
}

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"

def fetch_and_parse_feed():
    try:
        # Use urllib.request with a standard browser User-Agent to avoid potential blocks
        req = urllib.request.Request(
            FEED_URL,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        
        # Atom Feed Namespace
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        
        entries = []
        for entry in root.findall('atom:entry', ns):
            title_node = entry.find('atom:title', ns)
            date_str = title_node.text if title_node is not None else "Unknown Date"
            
            updated_node = entry.find('atom:updated', ns)
            updated_str = updated_node.text if updated_node is not None else ""
            
            # Find the alternate link (pointing to the actual Google Cloud documentation page)
            link_href = ""
            for link in entry.findall('atom:link', ns):
                if link.attrib.get('rel') == 'alternate':
                    link_href = link.attrib.get('href', '')
                    break
            if not link_href:
                link_node = entry.find('atom:link', ns)
                if link_node is not None:
                    link_href = link_node.attrib.get('href', '')
                    
            content_node = entry.find('atom:content', ns)
            content_html = content_node.text if content_node is not None else ""
            
            entries.append({
                "date": date_str,
                "updated": updated_str,
                "link": link_href,
                "content": content_html
            })
            
        return entries, None
    except Exception as e:
        return None, str(e)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    now = time.time()
    
    if force_refresh or not cache["data"] or (now - cache["last_fetched"]) > CACHE_DURATION:
        data, error = fetch_and_parse_feed()
        if error:
            # Fall back to cache if available when feed fetch fails
            if cache["data"]:
                return jsonify({
                    "success": True,
                    "from_cache": True,
                    "warning": f"Could not fetch latest feed ({error}). Using cached data.",
                    "data": cache["data"],
                    "last_fetched": cache["last_fetched"]
                })
            return jsonify({"success": False, "error": error}), 500
        
        cache["data"] = data
        cache["last_fetched"] = now
        
    return jsonify({
        "success": True,
        "from_cache": not force_refresh and (now - cache["last_fetched"]) <= CACHE_DURATION,
        "data": cache["data"],
        "last_fetched": cache["last_fetched"]
    })

if __name__ == '__main__':
    print("Starting BigQuery Release Notes App on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
