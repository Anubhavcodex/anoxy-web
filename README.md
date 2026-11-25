# Anoxy Cloud Schedular (Web Version for Vercel)

A 100% free, mobile-friendly 24/7 Cloud Drip-Feed Scheduler for SMM Panels. Runs your 12-hour and 24-hour schedules in the cloud even when your PC or phone is turned completely off.

---

## 🚀 How to Deploy to Vercel (100% Free)

### Method 1: Deploy with Vercel CLI (Takes 60 seconds)

1. Open PowerShell / Terminal in this folder:
   ```powershell
   cd d:\anoxy\anoxy-web
   ```
2. Run:
   ```powershell
   npx vercel
   ```
3. Follow the 3 prompts:
   - *Set up and deploy?* Press **Y**
   - *Which scope?* Select your account
   - *Link to existing project?* **N**
   - *Project name?* Press Enter (or type `anoxy-cloud`)
4. Done! Vercel gives you your live URL (e.g. `https://anoxy-cloud.vercel.app`).

---

### Method 2: Deploy via GitHub (1-Click)

1. Create a free repository on [github.com](https://github.com) named `anoxy-web`.
2. Push this folder to GitHub:
   ```powershell
   cd d:\anoxy\anoxy-web
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/anoxy-web.git
   git push -u origin main
   ```
3. Go to [vercel.com](https://vercel.com) → Click **"Add New Project"** → Select `anoxy-web` → Click **"Deploy"**.

---

## ⏰ How to Enable the Free 24/7 Timer (cron-job.org)

To make sure your orders execute every minute while your PC is off:

1. Go to [cron-job.org](https://cron-job.org) (100% free service).
2. Create an account and click **"Create Cronjob"**.
3. Fill in:
   - **Title**: `Anoxy Scheduler Check`
   - **URL**: `https://your-vercel-app-name.vercel.app/api/cron`
   - **Execution schedule**: Every **1 minute** (`* * * * *`).
4. Click **Create**.
5. Done! Now Google Cloud & Vercel will wake up every 1 minute 24/7/365 to dispatch due orders to your SMM panel!

---

## 💻 How to Test Locally on Your PC

Run:
```powershell
node d:\anoxy\anoxy-web\server.js
```
Open your browser to: `http://localhost:3000`
