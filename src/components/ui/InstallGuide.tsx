'use client'

import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'

export interface InstallGuideProps {
  embedCode: string
  scriptUrl: string
  apiBaseUrl: string
  persistent?: boolean
  hasAllowedSites?: boolean
  ownModel?: { model: string; host: string } | null
}

type Platform = {
  id: string
  label: string
  steps: string[]
  code: string
}

function platforms(embedCode: string, scriptUrl: string): Platform[] {
  return [
    {
      id: 'html',
      label: 'HTML',
      steps: ['Paste the tag into every page that should show the chat, just before the closing </body> tag.'],
      code: `  ...your page...\n  ${embedCode}\n</body>`,
    },
    {
      id: 'react',
      label: 'React',
      steps: [
        'Add the tag to the HTML file your app is served from: index.html in the project root for Vite, or public/index.html for Create React App.',
        'Put it just before </body>. A <script> written inside JSX does not run, so do not paste it into a component.',
      ],
      code: `<body>\n  <div id="root"></div>\n  ${embedCode}\n</body>`,
    },
    {
      id: 'next',
      label: 'Next.js',
      steps: [
        'App Router: add it to app/layout.tsx with next/script, so it loads on every page.',
        'Pages Router: add the same <Script> to pages/_app.tsx.',
      ],
      code: `import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="${scriptUrl}" strategy="afterInteractive" />
      </body>
    </html>
  )
}`,
    },
    {
      id: 'spa',
      label: 'Vue, Angular, Svelte',
      steps: [
        'Add the tag before </body> in the app shell: index.html for Vue with Vite, src/index.html for Angular, src/app.html for SvelteKit.',
        'Nuxt: add it to app.head.script in nuxt.config, as below.',
      ],
      code: `// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [{ src: '${scriptUrl}', async: true }],
    },
  },
})`,
    },
    {
      id: 'builders',
      label: 'WordPress, Shopify, others',
      steps: [
        "Site builders have a place for code that runs on every page. Paste the tag there, in the footer or 'end of body' slot if there is a choice.",
        'WordPress: a header-and-footer code plugin, or footer.php in your theme before </body>.',
        'Shopify: edit the theme code, open layout/theme.liquid and paste before </body>.',
        "Webflow, Squarespace, Wix: the site's custom code or code injection settings (some plans only).",
      ],
      code: embedCode,
    },
  ]
}

const tabBase = 'relative min-h-10 shrink-0 whitespace-nowrap rounded-sm px-3 text-sm'
const tabSelected =
  'bg-surface font-semibold text-ink shadow-sm after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent'
const tabUnselected = 'font-medium text-ink-muted hover:text-ink'

export default function InstallGuide({
  embedCode,
  scriptUrl,
  apiBaseUrl,
  persistent,
  hasAllowedSites,
  ownModel = null,
}: InstallGuideProps): JSX.Element {
  const list = platforms(embedCode, scriptUrl)
  const [active, setActive] = useState(list[0].id)
  const [copied, setCopied] = useState('')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baseId = useId()
  const current = list.find((p) => p.id === active) ?? list[0]

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % list.length
    else if (event.key === 'ArrowLeft') nextIndex = (index + list.length - 1) % list.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = list.length - 1
    else return
    event.preventDefault()
    const next = list[nextIndex]
    setActive(next.id)
    tabRefs.current[next.id]?.focus()
  }

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(current.code)
      setCopied('Copied')
    } catch {
      setCopied("Couldn't copy. Select the code and copy it manually.")
    }
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null
      setCopied('')
    }, 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${baseId}-install`}>
        <h3 id={`${baseId}-install`} className="text-base font-semibold text-ink">
          Add it to your site
        </h3>
        <div role="tablist" aria-label="Platform" className="mt-3 flex flex-wrap gap-1 rounded-md bg-sunken p-1 sm:flex-nowrap sm:overflow-x-auto">
          {list.map((platform, index) => {
            const selected = platform.id === current.id
            return (
              <button
                key={platform.id}
                ref={(el) => {
                  tabRefs.current[platform.id] = el
                }}
                id={`${baseId}-tab-${platform.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(platform.id)}
                onKeyDown={(event) => onTabKey(event, index)}
                className={`${tabBase} ${selected ? tabSelected : tabUnselected}`}
              >
                {platform.label}
              </button>
            )
          })}
        </div>
        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${current.id}`} className="mt-3">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
            {current.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <pre
            tabIndex={0}
            aria-label={`${current.label} example`}
            className="mt-3 max-h-64 max-w-full overflow-auto whitespace-pre rounded-md bg-code-bg p-4 font-mono text-xs text-code-ink"
          >
            {current.code}
          </pre>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-sunken"
            >
              {copied === 'Copied' ? (
                <>
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 text-accent" fill="none">
                    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Copied
                </>
              ) : (
                'Copy example'
              )}
            </button>
            <span role="status" aria-live="polite" className="text-sm text-ink-muted">
              {copied}
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${baseId}-how`}>
        <h3 id={`${baseId}-how`} className="text-base font-semibold text-ink">
          How it works
        </h3>
        <dl className="mt-3 grid gap-4 text-sm">
          <div className="sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-semibold text-ink">What the code contains</dt>
            <dd className="mt-0.5 max-w-[65ch] text-ink-muted sm:mt-0">
              One script tag with your widget key in its address. It loads a small script from this app
              (<a href={scriptUrl} target="_blank" rel="noreferrer" className="break-all text-accent underline underline-offset-2">view it</a>)
              that adds the chat button and window to the page. It does not read your page content, forms or cookies.
            </dd>
          </div>
          <div className="sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-semibold text-ink">Do I need my own server?</dt>
            <dd className="mt-0.5 max-w-[65ch] text-ink-muted sm:mt-0">
              No. Your site only serves the tag. Each question goes from the visitor&apos;s browser to this app at{' '}
              <span className="break-all font-mono text-xs text-ink">{apiBaseUrl}</span>, which finds matching passages in
              your documents and{' '}
              {ownModel ? (
                <>
                  asks <span className="break-all font-mono text-xs text-ink">{ownModel.model}</span> at{' '}
                  <span className="break-all font-mono text-xs text-ink">{ownModel.host}</span> with your API key. The
                  answer goes straight back to the browser. Your API key is inside the tag only in encrypted form, which
                  only this app can decrypt, and your site&apos;s server is never contacted.
                </>
              ) : (
                <>
                  asks the chat model on Groq. The answer goes straight back to the browser. No API key is placed on your
                  site, and your site&apos;s server is never contacted.
                </>
              )}
            </dd>
          </div>
          <div className="sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-semibold text-ink">What a visitor sends</dt>
            <dd className="mt-0.5 max-w-[65ch] text-ink-muted sm:mt-0">
              The question they type and the widget key. The question and matching passages from your documents are
              sent{' '}
              {ownModel ? (
                <>
                  from this app to <span className="break-all font-mono text-xs text-ink">{ownModel.host}</span>, instead
                  of Groq, to write the answer. That provider&apos;s data retention policy applies.
                </>
              ) : (
                'to Groq to write the answer.'
              )}
            </dd>
          </div>
          <div className="sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-semibold text-ink">Limits</dt>
            <dd className="mt-0.5 max-w-[65ch] text-ink-muted sm:mt-0">
              {persistent
                ? 'Widgets and documents are stored in your database, so the widget keeps answering after server restarts.'
                : "Widgets and documents are kept in this server's memory, so the widget stops answering after a server restart and you need to generate it again."}{' '}
              {hasAllowedSites
                ? ownModel
                  ? 'A copy of the tag on a site that is not in your allowed list is refused. Visitors on your allowed sites can spend your provider credits, up to 20 questions a minute per visitor network on each server instance.'
                  : 'A copy of the tag on a site that is not in your allowed list is refused. Visitors on your allowed sites can still use the widget, up to 20 questions a minute per visitor network on each server instance.'
                : ownModel
                  ? 'Each visitor network can send 20 questions a minute. Anyone who copies the tag can use the widget on another site and spend your provider credits.'
                  : 'Each visitor network can send 20 questions a minute. Anyone who copies the tag can use the widget on another site.'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
