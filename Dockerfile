# Local development and CI only: one container serving the built web app and the API in demo mode.
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/flightmap ./flightmap
COPY --from=web /web/dist /app/web-dist
ENV HOST=0.0.0.0 PORT=8000 STATIC_DIR=/app/web-dist DATA_DIR=/data GZIP=1
VOLUME /data
USER 1000
CMD ["python", "-m", "flightmap"]
