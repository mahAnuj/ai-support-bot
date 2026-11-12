import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX, ReactNode } from 'react'
import CodeBlock from '@/components/docs/CodeBlock'

// The database setup guide: one-click setup, what it does, the manual
// alternative and how to manage access afterwards. The SQL shown is read from
// scripts/ at build time, so the guide cannot drift from the scripts.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Connect your database · Support assistant builder',
  description:
    'Keep your support assistant in your own Postgres database: one-click setup with a limited login, or the manual SQL steps.',
}

function readScript(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8').trim()
}

const H2 = 'mt-12 scroll-mt-6 text-xl font-semibold text-ink'
const H3 = 'mt-6 text-base font-semibold text-ink'
const P = 'mt-3 text-sm leading-relaxed text-ink-muted'
const LIST = 'mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-muted'
const OL = 'mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-ink-muted'
const CODE = 'rounded bg-sunken px-1 py-0.5 font-mono text-xs text-ink'
const LINK = 'text-accent underline underline-offset-2'
const NOTE = 'mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink'

function C({ children }: { children: ReactNode }) {
  return <code className={CODE}>{children}</code>
}

const CONNECTION_SHAPE = 'postgresql://support_bot_app:<password>@<host>/<database>?sslmode=require'

const GITHUB_ACTION = `# .github/workflows/assistant-sync.yml
name: Assistant sync
on:
  push:
    branches: [main]
    paths: ["docs/**"]
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload documents
        env:
          SUPPORT_BOT_KEY: \${{ secrets.SUPPORT_BOT_KEY }}
        run: |
          args=()
          for f in docs/*.md; do args+=(-F "files=@$f"); done
          curl -fsS -H "Authorization: Bearer $SUPPORT_BOT_KEY" "\${args[@]}" \\
            https://<this app>/api/upload`

const MANAGE_SQL = `-- Which logins the assistant has (one-click setup names them support_bot_app or support_bot_app_xxxxxx)
SELECT rolname FROM pg_roles WHERE rolname LIKE 'support_bot_app%';

-- Cut a login off: everything made with it (builder link, embed code, keys) stops on the next request
ALTER ROLE support_bot_app PASSWORD NULL;

-- Remove a login you no longer use (revoke its rights first; works without superuser)
ALTER DEFAULT PRIVILEGES IN SCHEMA support_bot REVOKE ALL ON TABLES FROM support_bot_app_xxxxxx;
REVOKE ALL ON ALL TABLES IN SCHEMA support_bot FROM support_bot_app_xxxxxx;
REVOKE ALL ON SCHEMA support_bot FROM support_bot_app_xxxxxx;
DROP ROLE support_bot_app_xxxxxx;`

export default function DatabaseSetupGuide(): JSX.Element {
  const schemaSql = readScript('support-bot-schema.sql')
  const roleSql = readScript('support-bot-role.sql')
  const upgradeSql = readScript('support-bot-upgrade.sql')
  return (
    <main className="mx-auto max-w-[46rem] px-4 pb-24 pt-10 sm:px-6">
      <Link href="/" className={`${LINK} text-sm`}>&larr; Back to the builder</Link>
      <h1 className="mt-6 text-2xl font-semibold text-ink">Connect your database</h1>
      <p className={P}>
        In the demo, documents and widgets live in this server&apos;s memory and are deleted when it restarts. Connect
        your own Postgres database with pgvector to keep them: Neon and Supabase both work on their free plans, as does
        any self-hosted Postgres. Your documents are stored in your database, in a <C>support_bot</C> schema; this server
        keeps no copy and no connection string.
      </p>

      <nav aria-label="On this page" className={NOTE}>
        <p className="font-medium">On this page</p>
        <ul className="mt-1 flex flex-col gap-1">
          <li><a className={LINK} href="#one-click">One-click setup (recommended)</a></li>
          <li><a className={LINK} href="#what-it-does">What one-click setup does</a></li>
          <li><a className={LINK} href="#manual">Manual setup</a></li>
          <li><a className={LINK} href="#upgrade">Upgrading an older setup</a></li>
          <li><a className={LINK} href="#projects">Several sites</a></li>
          <li><a className={LINK} href="#edit">Changing an assistant after it&apos;s live</a></li>
          <li><a className={LINK} href="#log">Seeing what visitors asked</a></li>
          <li><a className={LINK} href="#keys">Keeping documents in sync</a></li>
          <li><a className={LINK} href="#access">Managing access</a></li>
          <li><a className={LINK} href="#trouble">Troubleshooting</a></li>
        </ul>
      </nav>

      <h2 id="one-click" className={H2}>One-click setup (recommended)</h2>
      <ol className={OL}>
        <li>
          Copy your database&apos;s connection string <strong className="text-ink">for its admin login</strong>.
          On Neon: the project dashboard &rarr; <em>Connect</em>; the user is <C>neondb_owner</C>. On Supabase: the
          project &rarr; <em>Connect</em>; the user is <C>postgres</C> (or <C>postgres.&lt;project&gt;</C> through the
          pooler).
        </li>
        <li>
          In the builder, open <em>Make it permanent: connect your database</em>, paste the connection string and leave
          <em> Create a limited login for the assistant</em> ticked.
        </li>
        <li>
          Click <em>Connect</em>. When it says <em>Secured: this assistant uses its own login</em>, setup is done. Demo
          documents are copied across, and an assistant already in that database is reopened.
        </li>
      </ol>
      <p className={P}>
        You never run SQL or handle a second password. The admin login is used for this one request and is not saved
        anywhere: not in the browser, not in the embed code, not on this server.
      </p>

      <h2 id="what-it-does" className={H2}>What one-click setup does</h2>
      <p className={P}>In order, using the admin login:</p>
      <ol className={OL}>
        <li>Turns on pgvector (<C>CREATE EXTENSION vector</C>) if it is not on yet.</li>
        <li>
          Creates the <C>support_bot</C> schema and its tables, exactly as{' '}
          <a className={LINK} href="#manual-schema">the schema SQL</a> below. Existing tables are left as they are.
        </li>
        <li>
          Creates a new login, <C>support_bot_app</C>, with a random 48-character password. If a login with that name
          already exists (from an earlier setup, or one you made by hand), it is left untouched and a new one called{' '}
          <C>support_bot_app_</C> plus six letters and digits is created instead, so nothing already using the old one
          breaks.
        </li>
        <li>
          Gives that login only what the assistant needs: use of the <C>support_bot</C> schema; read, add and update on
          its tables; delete on documents and their chunks; and the same rights on tables a later version adds. Nothing
          on any other schema or table, and no right to create, drop or alter anything.
        </li>
        <li>Connects as the new login to check it works.</li>
        <li>
          Seals the new login, encrypted, into the browser&apos;s link to your database, and from then on into embed
          code and automation keys. The admin login is dropped.
        </li>
      </ol>
      <p className={NOTE}>
        <strong>If it cannot.</strong> A login that is not allowed to create other logins is used as it is, which is
        right when it is already a limited one. If anything fails part-way, the new login is removed again, the database
        is left as it was, and the builder says it is using the login you entered. Follow the manual setup below to
        limit it.
      </p>
      <p className={P}>
        <strong className="text-ink">The new login&apos;s password is never shown.</strong> It exists only inside the
        encrypted links. To connect from another browser, connect with the admin login again; that creates another
        limited login and leaves the first one working. See <a className={LINK} href="#access">Managing access</a> to
        list or remove them.
      </p>

      <h2 id="manual" className={H2}>Manual setup</h2>
      <p className={P}>
        For when you would rather run the SQL yourself, your login is not allowed to create logins, or your security
        policy requires it. Run these in your database&apos;s SQL console (Neon: <em>SQL Editor</em>; Supabase:{' '}
        <em>SQL Editor</em>) as the admin login.
      </p>
      <h3 className={H3}>1. Turn on pgvector</h3>
      <CodeBlock label="pgvector command" code="CREATE EXTENSION IF NOT EXISTS vector;" />
      <h3 id="manual-schema" className={H3}>2. Create the tables</h3>
      <p className={P}>Safe to run more than once. It never drops, empties or changes anything that exists.</p>
      <CodeBlock label="schema SQL" code={schemaSql} />
      <h3 className={H3}>3. Create the limited login</h3>
      <p className={P}>
        Replace <C>change-me-to-a-long-random-password</C> first. Make one with <C>openssl rand -hex 24</C> in a
        terminal: letters and digits only, because characters such as <C>@</C>, <C>/</C> or <C>:</C> break a
        connection string. Keep it in a password manager.
      </p>
      <CodeBlock label="role SQL" code={roleSql} />
      <p className={NOTE}>
        <strong>On Neon, create this login with the SQL above, not on the Roles page.</strong> Neon gives logins made
        in its console membership of <C>neon_superuser</C>, which defeats the point of a limited login.
      </p>
      <h3 className={H3}>4. Connect as that login</h3>
      <p className={P}>Take your admin connection string and change only the user and password:</p>
      <CodeBlock label="connection string shape" code={CONNECTION_SHAPE} />
      <p className={P}>
        Paste it into the builder and click <em>Connect</em>. The checkbox does not matter here: a login that cannot
        create logins is used as it is.
      </p>

      <h2 id="upgrade" className={H2}>Upgrading an older setup</h2>
      <p className={P}>
        Set up before automation keys, <em>Your assistants</em>, the conversation log or daily stats existed? Run this once as
        the admin login. It adds the newer tables and columns, and gives every assistant login (<C>support_bot_app</C> and the
        <C> support_bot_app_</C> ones one-click setup makes) the same limited rights as before. It is safe to run more than once
        and never drops or changes your data. The builder tells you when a feature is waiting for it.
      </p>
      <CodeBlock label="upgrade SQL" code={upgradeSql} />

      <h2 id="projects" className={H2}>Several sites</h2>
      <p className={P}>
        The usual setup is one database per site. <em>Disconnect</em>, connect the next site&apos;s database, and the builder
        starts from the defaults rather than the last site&apos;s title and questions. Each database&apos;s settings are
        remembered in this browser and come back when you connect it again.
      </p>
      <p className={P}>
        To keep several sites in one database instead, choose <em>add it as a separate project in this one</em> once
        connected. With two or more, a <em>Project</em> picker shows each with its document and assistant counts.
      </p>
      <ul className={LIST}>
        <li>Each project has its own documents, assistants, automation keys, conversation log and daily stats.</li>
        <li>Switching changes everything in the panel to that project. Embed code already on a site keeps working.</li>
        <li>The builder form is remembered per project in this browser.</li>
      </ul>
      <p className={NOTE}>
        Project names need the <C>support_bot.projects</C> table. One-click setup creates it; on an older setup, run the{' '}
        <a className={LINK} href="#upgrade">upgrade SQL</a>. Without it, projects still work and show as unnamed.
      </p>

      <h2 id="edit" className={H2}>Changing an assistant after it&apos;s live</h2>
      <p className={P}>
        Once connected, <em>Your assistants</em> in the builder lists every assistant in your database. <em>Edit</em> changes
        one in place: the embed code on your site stays the same, and visitors see the change on their next page load.
      </p>
      <ul className={LIST}>
        <li>Title, welcome message, colour, position and size.</li>
        <li>Suggested questions. Saved here, they replace any written in the script tag on your site.</li>
        <li>Allowed sites. Saved here, they replace the sites set when the embed code was made.</li>
        <li>The model: the shared demo model, or the model you connected under <em>Use your own model</em>.</li>
        <li>
          <strong className="text-ink">Instructions</strong>: how the assistant should talk and what to avoid, for example
          &ldquo;You are the assistant on our website; say <em>we</em>. Never quote prices.&rdquo; They are added to the
          assistant&apos;s own rules, never instead of them, so an instruction cannot make it state facts your documents
          don&apos;t contain.
        </li>
        <li>Documents are shared by every assistant in the same project; upload or remove them in the builder at any time.</li>
      </ul>
      <p className={NOTE}>
        <strong>Two limits.</strong> An assistant that uses your own model (your API credits) always keeps at least the sites
        it was made for, even if you empty the list. And settings saved here can be changed by anyone who can write to the{' '}
        <C>support_bot</C> tables, the same people who could already change your documents.
      </p>
      <h3 className={H3}>Who counts as the owner</h3>
      <p className={P}>
        There are no accounts on this service: owning the database is what counts. Connecting needs a connection string that
        logs in, which your database checks. A successful connect gives this browser an encrypted link, and every change
        (editing assistants, managing keys) requires it, for this database only. Automation keys and embed code cannot make
        changes. To use another browser, connect again. Use <em>Disconnect</em> on shared computers.
      </p>

      <h2 id="log" className={H2}>Seeing what visitors asked</h2>
      <p className={P}>
        Turn on <em>Conversation log</em> in the builder to keep each visitor question and the assistant&apos;s answer, in your
        database, to check the answers and see what your documents are missing. It needs your own database.
      </p>
      <ul className={LIST}>
        <li>Off by default. While it is on, visitors see &ldquo;Questions and answers are saved to improve this assistant.&rdquo; under the chat box, and only questions sent with that notice showing are kept.</li>
        <li>Kept: the question, the answer, whether any document matched, the documents used and the time. No IP address, browser details or cookies.</li>
        <li>Kept for 1 to 730 days, 90 by default; older entries are deleted automatically, and <em>Delete all</em> empties the log.</li>
        <li>Filter to the questions no document matched, or to answers with a low match score, and download everything as a CSV file.</li>
        <li>Questions you ask in the builder&apos;s preview are never logged.</li>
      </ul>
      <h3 className={H3}>Daily numbers</h3>
      <p className={P}>
        The <em>Questions and answers</em> panel counts, per day: questions, answers from your documents, questions no document
        matched, &ldquo;I don&apos;t have that information&rdquo; answers, failures, and the mean and lowest match score. Counts
        hold no question text, so they are kept even with the log off; you can turn counting off.
      </p>
      <p className={P}>
        The match score (0&ndash;100) says how closely the best passage in your documents matched the question. It is not a
        measure of whether the answer is right, but low scores are where weak answers come from: filter the log to them, read
        the answers, and add what your documents are missing.
      </p>
      <p className={NOTE}>
        <strong>Tell your visitors in your own privacy notice too.</strong> The widget&apos;s notice says the questions are
        saved; depending on where you and your visitors are, you may also need to mention it in your site&apos;s privacy policy.
      </p>

      <h2 id="keys" className={H2}>Keeping documents in sync</h2>
      <p className={P}>
        Once connected, the builder&apos;s <em>Automation keys</em> section creates keys for a script or CI job to
        upload, list and remove documents, and nothing else. A file with an existing name replaces the old one, so a
        job can simply upload everything each time. Keys expire after 30 days, 90 days or a year (the default), each
        has its own recent-activity log, and revoking one stops it on the next request. A key carries the login it was
        created with, which is one more reason to use a limited login.
      </p>
      <p className={P}>A GitHub Action that uploads a <C>docs/</C> folder on every push, with the key in the repository secret <C>SUPPORT_BOT_KEY</C>:</p>
      <CodeBlock label="GitHub Action" code={GITHUB_ACTION} />

      <h2 id="access" className={H2}>Managing access</h2>
      <p className={P}>Run as the admin login. Replace the names with your own.</p>
      <CodeBlock label="access SQL" code={MANAGE_SQL} />
      <ul className={LIST}>
        <li><em>Disconnect this browser</em> in the builder forgets this browser&apos;s link only; nothing in the database changes.</li>
        <li>Revoking an automation key in the builder stops that key alone.</li>
        <li>Changing or removing a login&apos;s password stops everything made with that login.</li>
        <li>
          Your documents stay in the <C>support_bot</C> schema until you delete them, in the builder or with SQL.
        </li>
      </ul>

      <h2 id="trouble" className={H2}>Troubleshooting</h2>
      <ul className={LIST}>
        <li>
          <strong className="text-ink">&ldquo;The pgvector extension isn&apos;t installed&rdquo;.</strong> Your login
          could not turn it on. Run <C>CREATE EXTENSION vector;</C> as an admin, then connect again.
        </li>
        <li>
          <strong className="text-ink">&ldquo;This database user can&apos;t create or use the support_bot
          tables&rdquo;.</strong> You connected with a limited login before the tables existed, or an upgrade added a
          table it has no rights on. Run the schema SQL and then the role SQL as the admin, or connect once with the
          admin login and one-click setup.
        </li>
        <li>
          <strong className="text-ink">&ldquo;Couldn&apos;t create a limited login&rdquo;.</strong> Your provider did
          not allow it, or the new login could not connect (some poolers need a moment, or name logins differently).
          Nothing was left behind; use the manual setup.
        </li>
        <li>
          <strong className="text-ink">The first answer after a quiet spell is slow.</strong> Free database plans,
          Neon&apos;s included, pause when idle and take a moment to wake.
        </li>
      </ul>
    </main>
  )
}
