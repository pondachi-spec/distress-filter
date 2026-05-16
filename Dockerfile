FROM node:18-alpine
# Cache bust: 20260515-v3
ARG CACHE_BUST=20260515-v3
WORKDIR /app
# Force cache invalidation — changing CACHE_BUST value breaks all subsequent layers
RUN echo "Build: ${CACHE_BUST}"

# ── Backend dependencies ──────────────────────────────────────
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# ── Frontend dependencies + build ────────────────────────────
COPY frontend/package*.json ./frontend/
# Force install ALL deps including devDeps (vite, tailwind) needed for build
RUN cd frontend && npm install --include=dev
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ── Copy backend source ───────────────────────────────────────
COPY backend/ ./backend/
COPY package*.json ./

EXPOSE 3002
CMD ["node", "backend/server.js"]
