import sqlite3
import os
for f in ['riskmetrics.db', 'app/riskmetrics.db', '../riskmetrics.db']:
    if os.path.exists(f):
        conn = sqlite3.connect(f)
        c = conn.cursor()
        c.execute('SELECT name FROM sqlite_master WHERE type="table"')
        tables = c.fetchall()
        print(f + ': tables=' + str(tables))