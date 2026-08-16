import sqlite3
import os

print('Current dir:', os.getcwd())
for f in os.listdir('.'):
    if f.endswith('.db'):
        print('DB file:', f)

conn = sqlite3.connect('riskmetrics.db')
c = conn.cursor()
c.execute('SELECT name FROM sqlite_master WHERE type="table"')
print('Tables:', c.fetchall())
c.execute('SELECT * FROM holdings')
print('Holdings:', c.fetchall())
c.execute('SELECT * FROM portfolios')
print('Portfolios:', c.fetchall())