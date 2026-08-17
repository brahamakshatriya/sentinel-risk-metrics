with open(r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics\app\services\risk_calculator.py", 'r') as f:
    lines = f.readlines()
    for i, line in enumerate(lines[175:220], 176):
        print(f'Line {i}: {repr(line[:80])}')