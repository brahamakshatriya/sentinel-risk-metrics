# Risk Metrics API - Phase 5 Deployment Checklist

## 📋 Pre-Deployment Checklist

### 1. Push Code to GitHub
- [ ] Ensure all changes are committed and pushed to your GitHub repository
- [ ] Verify the repository contains all modified files listed below

### 2. Render Backend Deployment

#### Step 2: Create Blueprint Instance
- [ ] Go to [dashboard.render.com](https://dashboard.render.com)
- [ ] Click "New" → "New Blueprint Instance"
- [ ] Select your GitHub repository
- [ ] Render will auto-detect `render.yaml` and create services

#### Step 3: Configure Environment Variables
Go to **Service → Environment** and add:

| Variable | Value | Notes |
|---|---|---|
| `ENVIRONMENT` | `production` | Required for CORS config |
| `LOG_LEVEL` | `INFO` | Controls log verbosity |
| `CORS_ALLOWED_ORIGINS` | `https://your-app.vercel.app` | Your Vercel frontend URL |
| `FRED_API_KEY` | `your_fred_api_key_here` | Get free key at https://fred.stlouisfed.org |
| `DATABASE_URL` | *Auto-injected from Postgres addon* | Or manually set Neon/Supabase connection string |

#### Step 4: Add PostgreSQL Database
- [ ] In Render dashboard, click "Add PostgreSQL"
- [ ] Select **Free tier** (90 days duration, then $7/mo)
- [ ] **Alternative for truly free**: Create a free Neon project at [neon.tech](https://neon.tech)
  - Copy the connection string from Neon dashboard
  - Add `DATABASE_URL` env var with the Neon connection string
  - Delete the `pserv` database section from `render.yaml`
  - This avoids the 90-day expiration limit

#### Step 5: Deploy
- [ ] Render auto-deploys on push to `main` branch
- [ ] Wait for build to complete (`pip install -r requirements.txt` + `uvicorn`)
- [ ] Verify build succeeds with no errors

#### Step 6: Test Health Endpoint
- [ ] Visit: `https://your-service.onrender.com/health`
- [ ] Should show: `{"status": "healthy", "database": "connected", "version": "1.0.0", "environment": "production"}`
- [ ] If database shows "disconnected", check DATABASE_URL config

#### Step 7: Set Up Custom Domain (Optional)
- [ ] In Render dashboard, add custom domain under "Settings"
- [ ] Update Vercel `NEXT_PUBLIC_API_URL` to point to new URL (see Vercel steps below)

---

## 🎨 Vercel Frontend Deployment

### Step 8: Create Vercel Project
- [ ] Go to [vercel.com](https://vercel.com) and log in
- [ ] Click "Add New..." → "Project"
- [ ] Import your GitHub repository
- [ ] Framework: **Next.js**
- [ ] Root Directory: leave as is (or `frontend` if your repo structure requires)
- [ ] Click "Import"

### Step 9: Configure Environment Variables
In Vercel Project Settings → **Environment Variables**, add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://your-service.onrender.com` | Must match Render service URL |

### Step 10: Deploy
- [ ] Vercel auto-deploys on push to main branch
- [ ] Wait for build to complete (`npm install` + `npm run build`)
- [ ] Verify deployment succeeds

### Step 11: Test Frontend
- [ ] Visit the Vercel preview URL
- [ ] Test core functionality:
  - [ ] Portfolio list loads without errors
  - [ ] Create new portfolio
  - [ ] Add holdings
  - [ ] View risk metrics
  - [ ] Run Monte Carlo simulation

---

## 🔄 Post-Deployment Validation

### Step 12: Verify CORS Configuration
- [ ] Try accessing API from different origins
- [ ] Production should reject `localhost:3000` if CORS is properly restricted
- [ ] Development mode (`ENVIRONMENT=development`) should allow `*`

### Step 13: Test Error Handling
- [ ] Try ingesting invalid ticker symbols
- [ ] Should return clear error messages, not 500 stack traces
- [ ] Test health endpoint confirms DB connectivity

### Step 14: Monitor Logs
- [ ] Check Render logs for ingestion failures, risk calc errors
- [ ] Verify structured logging is visible (not raw print statements)
- [ ] Confirm no sensitive data (API keys) in logs

---

## 📦 Files Created/Modified

### New Files
1. **`.env.example`** (root) - Production-ready environment config with all variables
2. **`frontend/.env.example`** - Frontend minimal config (just API URL)
3. **`render.yaml`** - Render Blueprint config for FastAPI + Postgres
4. **`frontend/vercel.json`** - Vercel config with rewrites and headers

### Modified Files
5. **`app/main.py`** - Global exception handler, health check with DB verification, env-dependent CORS
6. **`app/routers/ingestion.py`** - yfinance error handling, structured logging per symbol
7. **`frontend/src/lib/api.ts`** - Removed hardcoded `localhost:8001` fallback
8. **`frontend/src/lib/utils.ts`** - Added `formatRelativeTime()` utility
9. **`frontend/src/components/HoldingsTable.tsx`** - Added error state + "last updated" timestamp
10. **`frontend/src/components/CorrelationHeatmap.tsx`** - Added error state + "last updated" timestamp
11. **`frontend/src/components/MonteCarloChart.tsx`** - Added error state + "last updated" timestamp
12. **`frontend/src/app/portfolios/[id]/page.tsx`** - Pass error/lastUpdated props to components
13. **`frontend/next.config.js`** - Removed localhost fallback; throws if `NEXT_PUBLIC_API_URL` missing

---

## ⚠️ Important Notes

- **Free Tier Limits**: Render's free Postgres expires after 90 days. Use Neon (neon.tech) for truly free long-term.
- **FRED API Key**: Required for live risk-free rates. Sign up free at https://fred.stlouisfed.org/docs/api/api_key.html
- **CORS**: In production (`ENVIRONMENT=production`), CORS restricts to the Vercel frontend URL only. Dev mode (`ENVIRONMENT=development`) uses `*` wildcard.
- **No Hardcoded Localhost**: Frontend `NEXT_PUBLIC_API_URL` must be set via environment variable; no fallback to `localhost:8001`.
- **Health Check**: Always verify `database: connected` before relying on the API.
- **Logging**: All errors use Python's `logging` module; visible in Render's free log viewer.