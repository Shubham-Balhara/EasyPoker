# Easy Poker

A real-time, browser-based multiplayer card game built with **Node.js**, **Express**, **Socket.IO** and the open-source **deck-of-cards** animation library.

![Screenshot](https://user-images.githubusercontent.com/000000/placeholder.png)

---

## Features

* Create or join rooms – play instantly with friends
* Live deck animations (flip, shuffle, fan) via deck-of-cards
* "Match & Claim" gameplay with automatic rule handling
* Sudden-death tie-breaker that lets the room owner conclude never-ending games
* Emoji reactions & live player list
* Clean responsive UI – mobile friendly

---

## Project structure

```
EasyPoker/
├─ server/               # Express + Socket.IO back-end
│  └─ index.js
├─ public/               # Static front-end served by Express or GitHub Pages
│  ├─ client.js          # Game logic (ES Modules)
│  ├─ index.html         # App container
│  ├─ style.css          # Base styles
│  └─ vendor/            # Third-party assets (deck-of-cards)
└─ package.json          # Dependencies & scripts
```

---

## Prerequisites

* [Node.js >= 18](https://nodejs.org/) & npm

---

## Getting started (local dev)

```bash
# 1. Install deps
cd EasyPoker
npm install

# 2. Run the back-end + static front-end
npm run dev            # PORT defaults to 3000

# 3. Open two browser tabs
http://localhost:3000  # create a room in tab 1, join in tab 2
```

Environment variables:

| Name | Purpose | Default |
|------|---------|---------|
| `PORT` | HTTP port for Express | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |

---

## Production deploy

Easy Poker has two distinct pieces:

1. **Back-end** (server/index.js) – requires a Node runtime. Use any platform that supports Node 18+ (Render, Railway, Fly.io, Heroku, Vercel Serverless Functions…)
2. **Front-end** (public/) – 100 % static. Can be hosted by the same Express server **or** by a static host such as GitHub Pages.

### Deploying with GitHub Pages

GitHub Pages only serves static files. Follow these steps to publish the UI while hosting Socket.IO on any dynamic Node provider.

1. **Prepare static assets**
   * Copy `node_modules/deck-of-cards/dist/deck.min.js` → `public/vendor/`
   * Copy `node_modules/deck-of-cards/example/example.css` → `public/vendor/`
   * Copy the `faces/` image folder used by the CSS into `public/vendor/faces/`
   * Update `public/index.html`:
     ```html
     <!-- socket.io from CDN -->
     <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>

     <!-- deck-of-cards assets now served relatively -->
     <link rel="stylesheet" href="vendor/example.css">
     <script src="vendor/deck.min.js"></script>
     ```
   * In `public/client.js` point Socket.IO to your API host:
     ```js
     const socket = io('https://your-api-host.example');
     ```
2. **Push to `gh-pages`** (or `/docs` folder) – Enable Pages in repository Settings ▸ Pages and choose the branch/folder containing the static build.
3. Wait for GitHub to provision the site (a unique URL like `https://yourusername.github.io/easy-poker/`).

### Deploying back-end

Below is a minimal Render Blueprint (render.yaml) – adapt for your host:

```yaml
services:
  - type: web
    name: easy-poker-api
    env: node
    plan: free
    buildCommand: npm install
    startCommand: node server/index.js
    rootDir: EasyPoker
    envVars:
      - key: NODE_ENV
        value: production
```

Take note of the public URL Render gives you (e.g. `https://easy-poker-api.onrender.com`) and use it in `client.js` as shown earlier.

---

## NPM scripts

| Command        | Description                         |
|----------------|-------------------------------------|
| `npm run dev`  | Start Express in development mode   |
| `npm start`    | Start Express in production         |

---

## Contributing

Issues & PRs welcome! Please open an issue first for major changes.

---

## License

MIT © 2024 – Your Name 