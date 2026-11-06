# One build, two service images. compose.yml picks `auth` or `app` as the target.

FROM node:22-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
COPY shared/ /build/shared/
RUN npm run build

FROM node:22-slim AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
COPY shared/ /build/shared/
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=server-build /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/package.json ./package.json
COPY --from=server-build /build/server/migrations ./migrations
COPY --from=server-build /build/server/dist/server/src/shared ./dist/server/src/shared
COPY --from=server-build /build/server/dist/shared ./dist/shared
# Volumes inherit this ownership on first mount, so the services can run unprivileged.
RUN mkdir -p /keys/private /keys/public /data/avatars && chown -R node:node /keys /data

FROM runtime AS auth
ENV SERVICE_NAME=auth PORT=3001
COPY --from=server-build /build/server/dist/server/src/auth ./dist/server/src/auth
# The auth server renders /login and /register, which is the same page shell as the site.
COPY --from=client-build /build/client/dist/index.html ./public/index.html
USER node
CMD ["node", "dist/server/src/auth/index.js"]

FROM runtime AS app
ENV SERVICE_NAME=app PORT=3000
COPY --from=server-build /build/server/dist/server/src/app ./dist/server/src/app
COPY --from=client-build /build/client/dist ./public
USER node
CMD ["node", "dist/server/src/app/index.js"]
