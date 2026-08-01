import sqlite3
import json

DB_PATH = r'C:\Users\lzg14\.local\share\mimocode\mimocode.db'
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# Search for durable keywords in recent licode sessions (last 7 days)
# Focus on user decision statements
KEYWORDS = ['决定', '规则', '记住', '必须', '以后', '不要', '禁止', '改为', '修复', '解决', '方案', '架构', '内存泄露', 'skill', '安全', 'Bug']

LICODE_PROJECT = '63501c80-0c1c-4ef9-b086-0f2eae788e64'

# Get recent licode sessions (non-checkpoint, non-dream)
cursor = conn.execute("""
    SELECT id, title, time_created
    FROM session
    WHERE project_id = ?
      AND title NOT LIKE '%checkpoint-writer%'
      AND title NOT LIKE '%Auto Dream%'
      AND title NOT LIKE '%Auto Distill%'
    ORDER BY time_created DESC
    LIMIT 10
""", (LICODE_PROJECT,))

sessions = cursor.fetchall()

for s in sessions:
    sid = s['id']
    title = (s['title'] or 'N/A')[:80]
    
    # Get user messages with keywords
    for kw in KEYWORDS:
        user_cursor = conn.execute("""
            SELECT m.id, json_extract(p.data, '$.text') as text
            FROM message m
            JOIN part p ON p.message_id = m.id
            WHERE m.session_id = ?
              AND json_extract(m.data, '$.role') = 'user'
              AND json_extract(p.data, '$.type') = 'text'
              AND p.data LIKE ?
            ORDER BY m.time_created
            LIMIT 3
        """, (sid, f'%{kw}%'))
        
        for r in user_cursor.fetchall():
            text = (r['text'] or '')[:300]
            if text and len(text) > 20:
                print(f"\n[{sid[:12]}] [{kw}]")
                print(f"  {text}")

conn.close()
