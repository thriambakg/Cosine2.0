#!/usr/bin/env python3
"""
Startup script for Enhanced Cosine AI Chat Server
Automatically handles Python environment and starts the enhanced chat server
"""

import sys
import subprocess
import os
from pathlib import Path

def main():
    """Main startup function"""
    print("🚀 Starting Enhanced Cosine AI Chat Server...")
    print("=" * 50)
    
    # Get the directory where this script is located
    script_dir = Path(__file__).parent
    
    # Path to the enhanced chat server
    server_path = script_dir / "enhanced_chat_server.py"
    
    if not server_path.exists():
        print(f"❌ Error: Server file not found at {server_path}")
        return
    
    try:
        # Try to run with python3 first, then python
        python_cmd = "python3" if sys.platform != "win32" else "python"
        
        print(f"📂 Server location: {server_path}")
        print(f"🐍 Python command: {python_cmd}")
        print("🔄 Launching server...")
        print("=" * 50)
        
        # Launch the enhanced server
        subprocess.run([python_cmd, str(server_path)], check=True)
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running server: {e}")
        print("💡 Try running directly: python enhanced_chat_server.py")
    except KeyboardInterrupt:
        print("\n👋 Shutdown requested. Goodbye!")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()
