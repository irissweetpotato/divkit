# 1. Installation

```bash
# Go to project directory
cd /path/to/divkit-server

# Install Node.js dependencies
# (better-sqlite3 compiles native code — needs build tools: gcc, make, python3)
# On Ubuntu/Debian if not installed:
#   sudo apt install -y build-essential python3
npm install

# Verify it starts
node server.js
# Expected output: "DivKit backend started on port 3000"
# Ctrl+C to stop
```

## Run with PM2

```bash
# Start
pm2 start server.js --name divkit-backend

# Check status
pm2 status

# View logs
pm2 logs divkit-backend

# Restart after changes
pm2 restart divkit-backend

# Auto-start on server reboot
pm2 save
pm2 startup
```

## Environment variables

Create `.env` file or pass via PM2 ecosystem file. Only 4 variables needed:

```bash
PORT=3000                      # Server port (default: 3000)
ADMIN_LOGIN=admin              # Admin panel login
ADMIN_PASSWORD=your_password   # Admin panel password
COOKIE_SECRET=random_string    # Any random string for cookie signing
```

### Option A: .env file (not supported out of the box — no dotenv)

If you prefer `.env`, install dotenv:
```bash
npm install dotenv
```
Then add to the top of `server.js`:
```js
require("dotenv").config();
```

### Option B: PM2 ecosystem file (recommended)

Create `ecosystem.config.js`:
```js
module.exports = {
  apps: [{
    name: "divkit-backend",
    script: "server.js",
    env: {
      PORT: 3000,
      ADMIN_LOGIN: "admin",
      ADMIN_PASSWORD: "your_password",
      COOKIE_SECRET: "random_string_here"
    }
  }]
};
```

Then start with:
```bash
pm2 start ecosystem.config.js
```

## Nginx (reverse proxy to DivKit backend)

```nginx
server {
    listen 80;
    server_name divkit-domain1.example.com divkit-domain2.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

All DivKit domains point to the same Node.js process. The backend distinguishes them by `Host` header.

---

# 2. How to use

## Step 1: Log in

Open any of the DivKit domains in a browser (e.g., `http://divkit-domain1.example.com`).
You will see the login page. Enter the login/password you set in environment variables.

## Step 2: Add domains

On the admin page, enter a domain name in the top-right field and click **Add domain**.
Add every DivKit domain that the app will send requests to.

## Step 3: Configure each domain

Click on a domain row to expand it. Fill in:

1. **Server Backend URL** — the full URL to the server backend's endpoint, e.g.:
   `https://server-backend.example.com/get_stats`
   Click **Save**.

2. **Server API Key** — the `x-api-key` value that the server backend expects for this domain.
   Click **Save**.

3. **Clear JSON** — click **Upload**, select the DivKit JSON config file that should be shown when the server backend returns NO link (user was filtered out).

4. **Offer JSON** — click **Upload**, select the DivKit JSON config file that should be shown when the server backend returns a link. This JSON should contain a variable named `offer_url` — it will be replaced with the actual link.

   Example variable in Offer JSON:
   ```json
   {
     "variables": [
       { "name": "offer_url", "type": "string", "value": "PLACEHOLDER" }
     ],
     ...
   }
   ```
   The value `"PLACEHOLDER"` will be replaced with the real URL at runtime.

## Step 4: Server backend setting

On the server backend, set the environment variable:
```
ALLOW_CLIENT_IP=1
```
This allows the DivKit backend to pass the real user IP through the request body.

## Step 5: Point the app to DivKit backend

Change the app's request URL from the server backend to the DivKit backend domain.
The request format stays exactly the same — same endpoint, same headers, same body.

## Step 6: Monitor logs

Go to the **Logs** page (link in the header). Every request from the app creates a session with 4 steps:

| Step | What it does |
|---|---|
| receive | App request received, domain identified |
| forward | Request sent to server backend |
| response | Server backend response received |
| deliver | DivKit JSON sent back to the app |

- Click a session row to expand and see all 4 steps
- Click **Details** on any step to see full request/response data
- Red rows = errors. Hover over the warning icon to see the error message
- Use filters at the top to search by domain, time range, or errors only
