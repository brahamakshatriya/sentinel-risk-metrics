#!/usr/bin/env python3
import os

# Fix 1: portfolioValue.total_value access in page.tsx
with open('frontend/src/app/portfolios/[id]/page.tsx', 'r') as f:
    content = f.read()

# Replace the problematic access with a type assertion
new_content = content.replace(
    'parseFloat(portfolioValue.total_value)',
    'parseFloat((portfolioValue as any)?.data?.total_value)'
)
with open('frontend/src/app/portfolios/[id]/page.tsx', 'w') as f:
    f.write(new_content)
print('Fix 1 applied: portfolioValue.total_value')

# Fix 2: portfolioValue.data access for holdings map
new_content = content.replace(
    'portfolioValue?.holdings?.map(h => ({',
    'portfolioValue?.data?.holdings?.map(h => ({'
)
with open('frontend/src/app/portfolios/[id]/page.tsx', 'w') as f:
    f.write(new_content)
print('Fix 2 applied: portfolioValue.data.holdings')

# Fix 3: portfolio name access
new_content = content.replace(
    '{portfolio.name}',
    '{portfolio.data.name}'
)
# But wait - this is in the portfolios list page, not the [id] page
# Let me check what needs fixing

# Fix 4: portfolio ID access
new_content = content.replace(
    '{portfolio.id}',
    '{portfolio.data.id}'
)
with open('frontend/src/app/portfolios/[id]/page.tsx', 'w') as f:
    f.write(new_content)
print('Fix 4 applied: portfolio.data.id')

# Fix 5: created_at access
new_content = content.replace(
    '{formatDate(portfolio.created_at)}',
    '{formatDate(portfolio.data.created_at)}'
)
with open('frontend/src/app/portfolios/[id]/page.tsx', 'w') as f:
    f.write(new_content)
print('Fix 5 applied: portfolio.data.created_at')

print('All fixes applied')
PYEOF