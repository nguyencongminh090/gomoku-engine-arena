#!/usr/bin/env node
// Environment: PORT (8080), HOST (127.0.0.1), DB_PATH (./testsite.sqlite), TLS_KEY + TLS_CERT (PEM paths),
// TRUST_PROXY=1 when behind a reverse proxy that sets X-Forwarded-For.
const fs = require('node:fs');
const { startServer } = require('../src/server');

const env = process.env;
startServer({
  port: Number(env.PORT || 8080),
  host: env.HOST || '127.0.0.1',
  dbPath: env.DB_PATH || 'testsite.sqlite',
  trustProxy: env.TRUST_PROXY === '1',
  tls: env.TLS_KEY && env.TLS_CERT ? { key: fs.readFileSync(env.TLS_KEY), cert: fs.readFileSync(env.TLS_CERT) } : undefined,
}).then((s) => console.log(`listening on ${env.HOST || '127.0.0.1'}:${s.port}`));
