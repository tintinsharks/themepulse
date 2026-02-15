# ThemePulse

Leading Stocks in Leading Themes — interactive dashboard for momentum trading.

## Setup

```bash
cd themepulse
npm install
```

## Daily Update

After running your stock pipeline, copy the data file:

```bash
cp ~/stock-pipeline/output/dashboard_data.json public/
git add -A && git commit -m "data update $(date +%Y-%m-%d)" && git push
```

Vercel auto-deploys on push.

## Local Dev

```bash
npm run dev
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project" → Import your GitHub repo
4. Framework: Vite → Deploy

That's it. Every `git push` triggers a new deploy.

## Update Script

Run `update.sh` to refresh data and deploy in one command:

```bash
chmod +x update.sh
./update.sh
```
