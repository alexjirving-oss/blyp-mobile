import time
import pyperclip
import os
import sys
from datetime import datetime

"""
Conversation Manager (Ping-Pong Protocol)
Bridges clipboard (Boss) and VS Code agent via two files:
  from_boss.md  (agent reads instructions)
  to_boss.md    (agent writes replies)

Basic cycle:
  1. Detect clipboard change containing prefix 'BOSS:' -> write instruction file.
  2. Detect agent output file change (non-empty) -> copy to clipboard with prefix 'AGENT REPORT:' and beep.

Notes / Enhancements:
  - Added timestamp logging.
  - Safe atomic writes (temp file then replace) to reduce partial read risk.
  - Configurable POLL_INTERVAL via env.
  - Graceful KeyboardInterrupt exit.
  - Optional basic size guard to avoid accidental huge pastes (>500KB).
"""

BOSS_INPUT_FILE = "from_boss.md"
AGENT_OUTPUT_FILE = "to_boss.md"
POLL_INTERVAL = float(os.environ.get("PING_PONG_POLL_INTERVAL", "1.0"))
MAX_CLIPBOARD_SIZE = 500_000  # bytes

last_clipboard = ""
last_agent_msg = ""

print("🤖 CONVERSATION LOOP ACTIVE")
print("1. Copy a message starting with 'BOSS:' from browser.")
print(f"2. Agent will write replies to '{AGENT_OUTPUT_FILE}'.")
print("3. Reply auto-copied; paste back into chat.")
print("-------------------------------------------------------")

# Ensure output file exists
if not os.path.exists(AGENT_OUTPUT_FILE):
    with open(AGENT_OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("")

# Helper: atomic write

def atomic_write(path: str, content: str):
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp_path, path)

try:
    while True:
        try:
            # 1. Clipboard -> Boss instruction file
            current_clipboard = pyperclip.paste()
            if current_clipboard != last_clipboard and current_clipboard.startswith("BOSS:"):
                if len(current_clipboard.encode("utf-8")) > MAX_CLIPBOARD_SIZE:
                    print("[WARN] Clipboard content too large; ignoring.")
                else:
                    last_clipboard = current_clipboard
                    instruction = current_clipboard.split("BOSS:", 1)[1].strip()
                    print(f"\n[{datetime.utcnow().isoformat()}] Incoming BOSS instruction.")
                    atomic_write(BOSS_INPUT_FILE, instruction + "\n")
                    print(f"--> Wrote to {BOSS_INPUT_FILE}")

            # 2. Agent output file -> clipboard
            if os.path.exists(AGENT_OUTPUT_FILE):
                with open(AGENT_OUTPUT_FILE, "r", encoding="utf-8") as f:
                    current_agent_msg = f.read()
                if current_agent_msg != last_agent_msg and current_agent_msg.strip():
                    last_agent_msg = current_agent_msg
                    payload = f"AGENT REPORT:\n{current_agent_msg}".strip()
                    pyperclip.copy(payload)
                    print(f"\n[{datetime.utcnow().isoformat()}] Agent replied. Copied to clipboard.")
                    # Beep (may not work in all terminals; fallback print)\n                    try:
                        print('\a', end='')
                    except Exception:
                        pass
                    print("--> Paste into browser now.")
        except KeyboardInterrupt:
            print("\nStopping (KeyboardInterrupt).")
            break
        except Exception as e:
            print(f"[ERROR] {e}")
        time.sleep(POLL_INTERVAL)
except SystemExit:
    pass
except Exception as e:
    print(f"Fatal error: {e}")
    sys.exit(1)
