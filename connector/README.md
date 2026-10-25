# Reference connector server

A small server that implements the [connector API v1](../docs/connector-api.md)
on Postgres with pgvector. Run it on your own machine or hosting account, point
the app's "Connect your backend" step at it, and your documents and visitors'
questions are stored and searched on your server. The app keeps no copy beyond
each request.

- One knowledge base per deployment. Every configured key sees the same
  documents. Run a second deployment (or a second database) for a second
  knowledge base.
- It embeds passages with `Xenova/all-MiniLM-L6-v2`, the model the app uses,
  so the app's match-score cut-offs apply unchanged.
- It answers questions itself (`POST /v1/answer`) only when you give it an
  OpenAI-compatible model. Otherwise the app writes the answers.
- Plain `node:http`, TypeScript, two runtime dependencies (see
  [Dependencies](#dependencies)).

Contents: [Run it locally](#run-it-locally) ·
[Connect it from the builder](#connect-it-from-the-builder) ·
[Deploy](#deploy) · [Keys: rotation and revocation](#keys-rotation-and-revocation) ·
[Security model and limits](#security-model-and-limits) · [Logs](#logs) ·
[Signing CLI](#signing-cli) · [Configuration](#configuration) ·
[Development](#development) · [Dependencies](#dependencies)

## Run it locally

### With Docker Compose

Needs Docker with Compose v2. From this directory:

```bash
cp .env.example .env
docker compose up --build
```

This starts two containers:

- `db`: `pgvector/pgvector:pg16`. On the first start, with an empty volume, it
  runs `sql/schema.sql`. It has no published port.
- `connector`: this server, built from the `Dockerfile`, on
  `127.0.0.1:8080` only.

The server logs one start-up line:

```
connector start port=8080 keys=0 answer=off schema=ok
```

`keys=0` is expected before you connect from the builder. Unsigned health
answers, and every other request gets 401:

```bash
curl http://127.0.0.1:8080/v1/health
# {"version":"1","capabilities":["documents","search"]}
```

The image build downloads the embedding model once (about 23 MB) into
`/app/.cache`, so the build needs network access. To skip that, build with
`docker compose build --build-arg WARM_MODEL=0`; the first upload or search
then downloads it.

If port 8080 is taken on your machine, change the left-hand side of
`ports` in `docker-compose.yml` (for example `127.0.0.1:18080:8080`).

Stop with `docker compose down`. `docker compose down -v` also deletes the
database volume and every stored document.

`sql/schema.sql` runs only when the volume is first created. To apply it to an
existing volume (it is safe to run more than once):

```bash
docker compose exec -T db psql -U connector -d connector -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/001-schema.sql
```

### Without Docker

Needs Node.js 20 or later and a Postgres database with the `vector` extension
available (pgvector).

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema.sql   # as the database owner or an admin
npm ci
npm run build
npm run warm-model                                         # optional: download the model now
DATABASE_URL=postgres://... CONNECTOR_KEYS= npm start
```

With the variables in a `.env` file instead (Node 20.6 or later):

```bash
node --env-file=.env dist/src/index.js
```

The server never creates, alters or drops anything in the database. At
start-up it reads `support_bot_connector.meta` and exits with
`schema=schema_missing` or `schema=schema_mismatch` if the schema is not
there or does not match. It uses its own schema name, so it can share a
database with the app's "own database" tier (`support_bot`).

Outside Docker, the model is cached in your system temp directory unless you
set `TRANSFORMERS_CACHE_DIR`. Use the same value for `npm run warm-model` and
`npm start`.

## Connect it from the builder

1. In the builder, open "Connect your backend" and enter the server's base URL
   (for example `https://support.example.com`). The app calls unsigned
   `GET /v1/health` and shows the version and capabilities.
2. The app generates a key id and a secret and shows them once, with the line
   to add: `CONNECTOR_KEYS=<key id>:<secret>`. Add it to `.env` (or your
   platform's environment settings). Keep the secret somewhere safe; the app
   does not show it again.
3. Restart the server so it reads the new key. With Compose, run
   `docker compose up -d`: it recreates the container when `.env` has changed.
   `docker compose restart` does **not** re-read `.env`. The start-up line
   should now say `keys=1`.
4. Confirm in the builder that you saved the secret, then press
   "Test connection". It sends a signed health call and a one-result search.
5. Upload documents and generate the embed code as usual.

The app accepts only `https:` base URLs. A local server on `http://127.0.0.1`
works only when the app itself runs with `ALLOW_PRIVATE_CONNECTOR_HOSTS=1` or
`NODE_ENV=development`, which is meant for local testing.

If you turn on `/v1/answer` (or turn it off) later, press "Test connection"
again and regenerate your embed code. The app records the capability at those
two moments and does not poll for it.

## Deploy

The server speaks plain HTTP. In production, put it behind something that
terminates TLS: a reverse proxy on a VPS, or a hosting platform's HTTPS. The
app refuses `http:` base URLs on a normal deployment.

These are written steps only. The VPS steps follow the Compose setup above,
which was run end to end. The Render, Fly and Railway steps have not been
tried on those platforms; check each platform's own documentation for the
current screens and commands.

On any platform:

- Postgres needs the pgvector extension. Run `sql/schema.sql` against it once,
  as the database owner (`CREATE EXTENSION IF NOT EXISTS vector` needs that
  privilege on most providers).
- Set `DATABASE_URL` (the connection string your provider gives you, including
  any TLS settings it requires) and `CONNECTOR_KEYS`. Set the three model
  variables only if you want the server to write answers.
- The server listens on `PORT` (default 8080). If the platform sets `PORT`
  for you, the server uses it.
- `GET /v1/health` with no headers answers 200, so a platform health check
  can use it.
- Run a single instance at first. Several instances on the same database also
  work: the replay store is in Postgres, so a nonce used on one instance is
  refused on the others.

### VPS (Docker Compose and a reverse proxy)

1. Install Docker with Compose v2 on the server, copy this `connector/`
   directory onto it, then `cp .env.example .env`.
2. Change the database password in `docker-compose.yml` (both
   `POSTGRES_PASSWORD` and the password inside `DATABASE_URL`) before the
   first start. The database port is not published, but the default password
   is public.
3. `docker compose up -d --build`. The connector listens on `127.0.0.1:8080`,
   so it is not reachable from outside until you add a proxy.
4. Point a domain at the server and add a reverse proxy with TLS. For example,
   with Caddy (which obtains a certificate on its own):

   ```
   support.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

5. Mount prefix: if you serve the connector under a path, for example
   `https://example.com/kb`, and your proxy forwards `/kb/v1/...` without
   removing `/kb`, set `CONNECTOR_BASE_PATH=/kb`. If the proxy removes the
   prefix, leave it empty. Requests are signed over the `/v1/...` path only
   (see [Security model](#security-model-and-limits)).
6. Connect from the builder with the public `https://` URL, then add the key
   and run `docker compose up -d`.

### Render

1. Create a Postgres database that has pgvector, then run `sql/schema.sql`
   against it from your machine with `psql` and the external connection
   string.
2. Create a Web Service from your repository with the Docker runtime and the
   root directory set to `connector`. Render builds the `Dockerfile`.
3. In the service's environment settings, set `DATABASE_URL` (the internal
   connection string), `CONNECTOR_KEYS` and, if wanted, the model variables.
4. Set the health check path to `/v1/health`.
5. Deploy, connect from the builder with the service's `https://` URL, add the
   key to `CONNECTOR_KEYS` and redeploy so the server reads it.

### Fly.io

1. From `connector/`, create an app from the existing `Dockerfile` without
   deploying yet (`fly launch --no-deploy`). Make sure the generated
   `fly.toml` uses internal port 8080.
2. Create or attach a Postgres database that has pgvector, and run
   `sql/schema.sql` against it.
3. Store the settings as secrets, for example
   `fly secrets set DATABASE_URL=... CONNECTOR_KEYS=...`.
4. `fly deploy`, connect from the builder with the app's `https://` URL, then
   update `CONNECTOR_KEYS` with `fly secrets set` (which restarts the app).

### Railway

1. Add a Postgres service that has pgvector, and run `sql/schema.sql` against
   it with `psql` and its public connection string.
2. Add a service from your repository with the root directory `connector`.
   Railway builds the `Dockerfile`.
3. Set `DATABASE_URL` (a reference to the Postgres service's private URL),
   `CONNECTOR_KEYS` and, if wanted, the model variables.
4. Generate a public domain for the service, connect from the builder with
   its `https://` URL, then update `CONNECTOR_KEYS` and redeploy.

## Keys: rotation and revocation

A key is a key id (`ck_` and 16 hex characters) and a 43-character secret.
The app generates both when you connect. The server reads `CONNECTOR_KEYS`
only at start-up, so restart (or redeploy) after every change.

Several keys can be active at once:

```
CONNECTOR_KEYS=ck_1111111111111111:<secret one>,ck_2222222222222222:<secret two>
```

Documents belong to the deployment, not to a key, so changing keys never
loses documents.

**Rotate** (replace a key without downtime):

1. In the builder, disconnect and connect again. You get a new key id and
   secret.
2. Add the new pair next to the old one in `CONNECTOR_KEYS` and restart.
3. Confirm and press "Test connection".
4. Regenerate your embed code and replace it on every site. Embeds made with
   the old key keep using it until you do.
5. Remove the old pair and restart.

**Revoke**: remove the pair from `CONNECTOR_KEYS` and restart. Every request
signed with that key then gets 401, including requests from embeds generated
with it, which stop answering. Disconnecting in the builder only removes the
browser's copy; it does not revoke anything.

## Security model and limits

What the server does:

- **Signed requests.** Every request except unsigned `GET /v1/health` must
  carry the four `X-Connector-*` headers with an HMAC-SHA256 signature over
  the method, path and query, timestamp, nonce and the SHA-256 of the raw
  body ([canonical string](../docs/connector-api.md#canonical-string)). The
  signature is compared in constant time. Any failure (missing or malformed
  header, unknown key id, old timestamp, bad signature, replay) gets the same
  `401 {"error":{"code":"unauthorized"}}`.
- **Unsigned health.** `GET /v1/health` without any `X-Connector-*` header
  returns only `{version, capabilities}`. A health request with some of the
  headers is treated as signed and must pass.
- **300-second window.** A timestamp more than 300 seconds from the server's
  clock, either way, is refused.
- **Replay store in Postgres.** After a signature checks out, the
  `(key id, nonce)` pair is inserted into `support_bot_connector.nonces`
  under a unique constraint. A second use gets 401, also after a restart and
  across instances sharing the database. Nonces are purged after 600 seconds
  (twice the window), once at start-up and then every minute.
- **Bounded requests.** Bodies: at most 2,097,152 bytes for
  `POST /v1/documents`, 262,144 bytes for search and answer, none for GET and
  DELETE (413 otherwise). Bodies need `Content-Type: application/json` (415
  otherwise). The server waits at most 60 seconds to receive a whole
  request.
- **Fixed SQL.** Every query is a fixed string with `$n` parameters. Search
  is an exact cosine scan with no approximate index.
- **Answer model** (only with all three `CONNECTOR_MODEL_*` variables set):
  passages go to the model inside `<documents>` tags, with a system rule to
  treat them as information only and never follow instructions inside them.
  The call does not follow redirects, times out after 30 seconds and reads at
  most 1 MB. A failed call gives `502 {"error":{"code":"upstream_error"}}`
  without the provider's response.
- **What is stored.** Documents (filename, content type, passage text and
  embeddings) and nonces with their key id. Questions are not stored.

Limits and known gaps:

- **A key has no scope.** Every configured key can upload, list, delete and
  search. The widget embed token the app generates contains the key id and
  secret, encrypted with the app deployment's `EMBED_TOKEN_KEY`. Anyone who
  holds a widget token **and** that app's `EMBED_TOKEN_KEY` can recover the
  secret and add or delete documents on your server. Revoke the key if you
  suspect that.
- **Responses are not signed.** Use TLS between the app and the server; the
  server itself does not provide it.
- **Clocks must be in sync.** Run NTP (or your platform's time sync) on the
  server. A clock more than 300 seconds off makes every signed request fail.
- **Mount prefix.** Only the `/v1/...` path is signed, not the base URL's
  path. If a proxy forwards a prefix, set `CONNECTOR_BASE_PATH` so the server
  removes it first; a request whose signature covers `/kb/v1/...` is refused.
  A proxy that re-encodes paths or reorders query parameters breaks
  signatures.
- **No rate limiting.** The server does not limit requests per client. Unsigned
  health is open to anyone and shows whether `/v1/answer` is on. Put limits in
  your proxy if you need them.
- **Embedding model coupling.** The app's cut-offs (match score 0.15 for "a
  passage is relevant") were calibrated for `Xenova/all-MiniLM-L6-v2` with
  q8 weights, mean pooling and normalisation. Changing the model in
  `src/embed.ts` changes the scores the app filters on.
- **Large documents and the app's timeout.** Passages are embedded one at a
  time. On a slow CPU a document with hundreds of passages can take longer
  than the app's 30-second limit for document calls. The app then reports a
  timeout, while the server may still finish storing the document; it appears
  in the list on the next refresh.
- **Database password in Compose.** `docker-compose.yml` uses
  `connector`/`connector`. The database port is not published, but change the
  password for anything that runs longer than a test.
- **Model key in the environment.** `CONNECTOR_MODEL_API_KEY` is read from the
  environment and sent only to `CONNECTOR_MODEL_BASE_URL`. With answering on,
  questions and passages go to that model provider.

## Logs

The server writes one line per request to stdout:

```
connector op=search key=#abf33b78 outcome=ok status=200 ms=7
connector op=health key=- outcome=unauthorized:replay status=401 ms=2
```

- `op`: `health`, `documents` (POST, GET and DELETE), `search`, `answer`, or
  `unknown` for paths that match no endpoint.
- `key`: `#` and the first 8 hex characters of the SHA-256 of the key id, or
  `-` when no key was accepted. The key id itself is never logged. To find
  which key a fingerprint belongs to:

  ```bash
  printf %s ck_0123456789abcdef | shasum -a 256 | cut -c1-8   # or sha256sum on Linux
  ```

- `outcome`: `ok`, `bad_request`, `not_found`, `method_not_allowed`,
  `payload_too_large`, `unsupported_media_type`, `upstream_error`, `internal`,
  or `unauthorized:<reason>` with reason `missing_headers`, `bad_header`,
  `unknown_key`, `stale`, `bad_signature` or `replay`. The client always gets
  the same 401 body; the reason is only in your log.

Other lines: the start-up line
(`connector start port=<n> keys=<n> answer=on|off schema=<ok|schema_missing|schema_mismatch|db_<sqlstate>|db_unreachable>`),
`connector error op=<op> code=<sqlstate|unexpected>` for a handler failure,
and `connector pool error` / `connector nonce purge error` with a SQLSTATE.
Configuration errors name the variable, never its value
(`connector config error: CONNECTOR_KEYS is invalid`).

Logs never contain the URL, `DATABASE_URL`, a key id, secret, signature, the
model key, question text, passage text, filenames or any request or response
body.

## Signing CLI

`npm run sign` sends one signed request and prints `status=<n>` and the
response body. Use it to check a deployment, or to test that tampered, old and
replayed requests are refused. Build first (`npm run build`). The secret is
read only from the `CONNECTOR_SECRET` environment variable, never from an
argument, and the CLI never prints it or the request headers.

```
CONNECTOR_SECRET=<secret> npm run -s sign -- --base <url> --key-id <id> --method <METHOD> --path </v1/...>
    [--body <json> | --body-file <file>] [--timestamp <unix seconds>] [--nonce <nonce>]
    [--tamper signature|body|path]
```

- `--base`: the base URL, including any mount prefix. `--path` is appended to
  it and is the part that is signed.
- `--timestamp`: defaults to now.
- `--nonce`: defaults to 16 random bytes in base64url.
- `--tamper signature`: changes the last hex digit of the signature.
- `--tamper body`: signs the body, then sends it with one extra trailing
  space. Needs a body.
- `--tamper path`: signs `--path`, then sends it with `?tampered=1` appended.
- Exit code 0 when any HTTP response arrived, 1 when the request failed, 2 on
  a usage error.

Examples, with `B=http://127.0.0.1:8080` and `K=<key id>`:

```bash
export CONNECTOR_SECRET=<secret>
npm run -s sign -- --base $B --key-id $K --method GET --path /v1/documents
npm run -s sign -- --base $B --key-id $K --method POST --path /v1/search \
  --body '{"query":"What file types can I upload?","topK":5}'

# Each of these gets status=401:
npm run -s sign -- --base $B --key-id $K --method GET --path /v1/documents --tamper signature
npm run -s sign -- --base $B --key-id $K --method GET --path /v1/health --timestamp $(( $(date +%s) - 400 ))
N=$(openssl rand -base64 16 | tr '+/' '-_' | tr -d '=')
npm run -s sign -- --base $B --key-id $K --method GET --path /v1/health --nonce $N   # status=200
npm run -s sign -- --base $B --key-id $K --method GET --path /v1/health --nonce $N   # status=401 (replay)
```

To try the server without the app, make a key yourself and put it in
`CONNECTOR_KEYS`:

```bash
echo "ck_$(openssl rand -hex 8)"                               # key id
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='              # secret, 43 characters
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection string. Compose sets it. |
| `CONNECTOR_KEYS` | empty | `id:secret` pairs, comma-separated. Empty means only unsigned health works. |
| `CONNECTOR_MODEL_BASE_URL`, `CONNECTOR_MODEL`, `CONNECTOR_MODEL_API_KEY` | empty | All three set: `/v1/answer` is offered and `answer` appears in health. Any one empty: answering is off. `CONNECTOR_MODEL_BASE_URL` is the part before `/chat/completions`. |
| `CONNECTOR_BASE_PATH` | empty | Mount prefix to remove before routing and signature checks, for example `/kb`. |
| `PORT` | `8080` | Listening port. Compose sets 8080. |
| `HOST` | `0.0.0.0` | Listening address. |
| `TRANSFORMERS_CACHE_DIR` | system temp dir | Model cache. The image sets `/app/.cache`. |

In Compose, `host.docker.internal` resolves to the host machine, so
`CONNECTOR_MODEL_BASE_URL` can point at a model server running next to Docker
(for example `http://host.docker.internal:11434/v1`).

## Development

```bash
npm ci
npm run build
npm test
```

`npm test` builds and runs `node --test` on the compiled tests. It needs no
network, database or model: tests use an in-memory store, a fake embedder and
a local mock model server. The signing tests read the shared vectors in
`../docs/connector-test-vectors.json` (or `CONNECTOR_TEST_VECTORS`). The
Postgres tests run only with `TEST_DATABASE_URL` set, against a database where
`sql/schema.sql` has been applied.

## Dependencies

Runtime dependencies, and why:

- `pg`: the Postgres client.
- `@huggingface/transformers` (pinned to 4.3.1, the version in the app's
  lockfile): runs the
  embedding model locally, so embeddings match the app's. It brings
  `onnxruntime-node` and `sharp` with it, which is most of the image size.

Development only: `typescript`, `@types/node`, `@types/pg`. HTTP, signing,
the CLI and the test runner use Node's built-in modules.
