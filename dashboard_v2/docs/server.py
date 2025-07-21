#!/usr/bin/env python3
"""
Simple HTTP server for the Amazon Dashboard v2
Serves files from the parent directory to avoid CORS issues
"""

import http.server
import socketserver
import os
import sys
from pathlib import Path

# Change to parent directory so we can access all files
parent_dir = Path(__file__).parent.parent
os.chdir(parent_dir)

PORT = 8080

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP Request Handler with CORS support"""
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

def main():
    try:
        with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
            print(f"🌳 Amazon Dashboard v2 Server")
            print(f"📁 Serving files from: {os.getcwd()}")
            print(f"🌐 Server running at: http://localhost:{PORT}")
            print(f"📊 Dashboard URL: http://localhost:{PORT}/dashboard_v2/")
            print(f"⚡ Press Ctrl+C to stop the server")
            print("-" * 50)
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n🛑 Server stopped by user")
        sys.exit(0)
    except OSError as e:
        if e.errno == 48:  # Address already in use
            print(f"❌ Port {PORT} is already in use!")
            print(f"💡 Try stopping other servers or use a different port")
        else:
            print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()