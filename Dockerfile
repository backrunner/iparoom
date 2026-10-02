FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json ./packages/cli/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 IPAROOM_USER_DATA_DIR=/home/node
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /home/node/.iparoom && chown node:node /home/node/.iparoom && chmod 700 /home/node/.iparoom
USER node
EXPOSE 3000
CMD ["node", "build"]
