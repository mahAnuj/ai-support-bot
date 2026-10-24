import type { Widget } from '../types/database'

// The script served at /api/widget/script/<key> and loaded by the one-line
// embed code. It runs on the site owner's pages, draws the chat button and
// window, and sends visitor questions to <baseUrl>/api/widget/chat.

// Owner-entered text goes into a <script> on their site: quote it as a JS
// string, and escape < so a title containing </script> cannot end the tag.
function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? '').replace(/</g, '\\u003c')
}

export function widgetScript(widget: Widget, baseUrl: string): string {
  return `
(function() {
  // Mount once, even if a single-page app runs this script again
  if (window.__aiSupportWidgetLoaded) return;
  window.__aiSupportWidgetLoaded = true;

  function mount() {
  // Widget configuration
  const widgetConfig = {
    widgetKey: ${jsLiteral(widget.widget_key)},
    title: ${jsLiteral(widget.title)},
    welcomeMessage: ${jsLiteral(widget.welcome_message)},
    primaryColor: ${jsLiteral(widget.primary_color)},
    position: ${jsLiteral(widget.position)},
    size: ${jsLiteral(widget.size)}
  };

  const apiBaseUrl = ${jsLiteral(baseUrl)};

  // The owner's colour reaches CSS only through a custom property, and only
  // after it matches a plain hex colour.
  const accent = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(widgetConfig.primaryColor) ? widgetConfig.primaryColor : '#1E6B58';
  const INK = '#13201C';

  // Same rule as src/components/ui/contrast.ts: white or ink, whichever
  // contrasts more with the accent.
  function luminance(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    const ch = [0, 2, 4].map(function (i) {
      const s = parseInt(h.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrast(a, b) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  const accentLum = luminance(accent);
  const onAccent = contrast(accentLum, luminance(INK)) > contrast(accentLum, 1) ? INK : '#FFFFFF';

  const isLeft = widgetConfig.position === 'bottom-left';
  const dims = { small: [300, 400], medium: [350, 500], large: [400, 600] }[widgetConfig.size] || [350, 500];

  // Every rule is scoped under .ai-widget-root. The reset (one class) comes
  // first; component rules use two classes so they beat both the reset and
  // host rules such as "button {}" or "* {}".
  const styles = \`
    .ai-widget-root, .ai-widget-root *, .ai-widget-root *::before, .ai-widget-root *::after {
      box-sizing: border-box; margin: 0; padding: 0; border: 0; background: none;
      font: inherit; color: inherit; letter-spacing: normal; text-transform: none;
      text-shadow: none; line-height: inherit;
    }
    .ai-widget-root {
      font: 400 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #13201C;
    }
    .ai-widget-root :focus-visible { outline: 2px solid #13201C; outline-offset: 2px; }

    .ai-widget-root .ai-widget-button {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
      width: 56px; height: 56px; border-radius: 9999px;
      display: flex; align-items: center; justify-content: center;
      background: var(--aiw-accent); color: var(--aiw-on-accent);
      box-shadow: 0 1px 2px 0 rgb(19 32 28 / .05), 0 12px 32px -12px rgb(19 32 28 / .18);
      cursor: pointer;
    }
    .ai-widget-root.is-left .ai-widget-button { left: 20px; right: auto; }
    .ai-widget-root .ai-widget-button:hover { filter: brightness(.95); }
    .ai-widget-root .ai-widget-button:focus-visible { outline-color: var(--aiw-on-accent); box-shadow: 0 0 0 4px var(--aiw-accent); }
    .ai-widget-root .ai-widget-icon { display: block; flex: none; width: 24px; height: 24px; }
    .ai-widget-root .ai-widget-icon-sm { width: 20px; height: 20px; }

    .ai-widget-root .ai-widget-modal {
      position: fixed; bottom: 92px; right: 20px; z-index: 2147483001;
      width: var(--aiw-w); height: var(--aiw-h);
      max-width: calc(100vw - 40px); max-height: calc(100vh - 112px);
      display: flex; flex-direction: column; overflow: hidden;
      background: #FFFFFF; border-radius: 20px;
      box-shadow: 0 4px 12px -2px rgb(19 32 28 / .08), 0 32px 64px -16px rgb(19 32 28 / .32);
      animation: aiw-enter 200ms cubic-bezier(.2, .8, .2, 1) backwards;
    }
    .ai-widget-root.is-left .ai-widget-modal { left: 20px; right: auto; }
    .ai-widget-root .ai-widget-modal[hidden] { display: none; }
    .ai-widget-root.is-expanded .ai-widget-modal {
      width: min(720px, calc(100vw - 48px));
      height: min(860px, calc(100vh - 120px));
      height: min(860px, calc(100dvh - 120px));
    }

    .ai-widget-root .ai-widget-header {
      flex: none; display: flex; align-items: center; gap: 8px;
      padding: 12px 12px 12px 16px;
      background: var(--aiw-accent); color: var(--aiw-on-accent);
    }
    .ai-widget-root .ai-widget-header :focus-visible { outline-color: var(--aiw-on-accent); }
    .ai-widget-root .ai-widget-title {
      flex: 1; min-width: 0; font-size: 16px; font-weight: 600; line-height: 1.375;
      overflow-wrap: anywhere;
    }
    .ai-widget-root .ai-widget-header-actions { flex: none; display: flex; align-items: center; gap: 4px; }
    .ai-widget-root .ai-widget-close,
    .ai-widget-root .ai-widget-expand {
      width: 40px; height: 40px; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .ai-widget-root .ai-widget-close:hover,
    .ai-widget-root .ai-widget-expand:hover { box-shadow: inset 0 0 0 1px var(--aiw-on-accent); }
    .ai-widget-root .ai-widget-expand .ai-widget-icon-restore { display: none; }
    .ai-widget-root.is-expanded .ai-widget-expand .ai-widget-icon-expand { display: none; }
    .ai-widget-root.is-expanded .ai-widget-expand .ai-widget-icon-restore { display: block; }

    .ai-widget-root .ai-widget-messages {
      flex: 1; min-height: 0; overflow-y: auto;
      display: flex; flex-direction: column; gap: 12px;
      padding: 16px; background: #F6F8F7;
    }
    .ai-widget-root .ai-widget-message {
      padding: 10px 14px; font-size: 15px; line-height: 1.5;
      overflow-wrap: anywhere; white-space: normal;
    }
    .ai-widget-root .ai-widget-message.ai {
      align-self: flex-start; max-width: 88%;
      background: #FFFFFF; color: #13201C; border: 1px solid #DCE2DF;
      border-radius: 14px 14px 14px 6px;
    }
    .ai-widget-root .ai-widget-message.ai.enhanced { border-left: 3px solid var(--aiw-accent); }
    .ai-widget-root .ai-widget-message.user {
      align-self: flex-end; max-width: 80%;
      background: var(--aiw-accent); color: var(--aiw-on-accent);
      border-radius: 14px 14px 6px 14px;
    }
    .ai-widget-root .ai-widget-message.error {
      align-self: flex-start; max-width: 88%;
      background: #FEF2F0; color: #13201C; border: 1px solid rgb(180 35 24 / .35);
      border-radius: 14px 14px 14px 6px;
    }
    .ai-widget-root .ai-widget-message > :first-child { margin-top: 0; }
    .ai-widget-root .ai-widget-message > :last-child { margin-bottom: 0; }
    .ai-widget-root .ai-widget-message p + p { margin-top: 8px; }
    .ai-widget-root .ai-widget-message ul,
    .ai-widget-root .ai-widget-message ol { padding-left: 20px; margin: 6px 0; }
    .ai-widget-root .ai-widget-message ul { list-style: disc; }
    .ai-widget-root .ai-widget-message ol { list-style: decimal; }
    .ai-widget-root .ai-widget-message li + li { margin-top: 4px; }
    .ai-widget-root .ai-widget-message strong,
    .ai-widget-root .ai-widget-message .ai-widget-heading { font-weight: 600; }
    .ai-widget-root .ai-widget-message code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em;
      background: #F6F8F7; border: 1px solid #DCE2DF; border-radius: 6px; padding: 0 4px;
    }
    .ai-widget-root .ai-widget-error-title { display: block; font-weight: 600; color: #B42318; }
    .ai-widget-root .ai-widget-error-reason { display: block; }

    .ai-widget-root .ai-widget-typing {
      align-self: flex-start; display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; font-size: 14px; color: #45534E;
      background: #FFFFFF; border: 1px solid #DCE2DF; border-radius: 14px 14px 14px 6px;
    }
    .ai-widget-root .ai-widget-dots { display: inline-flex; gap: 4px; }
    .ai-widget-root .ai-widget-dot {
      width: 6px; height: 6px; border-radius: 9999px; background: #5A6762;
      animation: aiw-typing 1s ease-in-out infinite;
    }
    .ai-widget-root .ai-widget-dot:nth-child(2) { animation-delay: 150ms; }
    .ai-widget-root .ai-widget-dot:nth-child(3) { animation-delay: 300ms; }

    .ai-widget-root .ai-widget-input-container {
      flex: none; display: flex; gap: 8px; padding: 12px;
      background: #FFFFFF; border-top: 1px solid #DCE2DF;
    }
    .ai-widget-root .ai-widget-input {
      flex: 1; min-width: 0; height: 44px; padding: 0 12px;
      font-size: 16px; color: #13201C; background: #FFFFFF;
      border: 1px solid #7D8984; border-radius: 10px;
    }
    .ai-widget-root .ai-widget-input::placeholder { color: #5A6762; opacity: 1; }
    .ai-widget-root .ai-widget-send-btn {
      flex: none; height: 44px; padding: 0 16px; border-radius: 10px;
      font-weight: 600; background: var(--aiw-accent); color: var(--aiw-on-accent);
      cursor: pointer;
    }
    .ai-widget-root .ai-widget-send-btn:hover { filter: brightness(.95); }
    .ai-widget-root .ai-widget-send-btn:disabled { opacity: .6; cursor: default; filter: none; }

    @keyframes aiw-enter { from { opacity: 0; transform: translateY(8px) scale(.98); } }
    @keyframes aiw-typing {
      0%, 80%, 100% { opacity: .35; transform: none; }
      40% { opacity: 1; transform: translateY(-2px); }
    }

    @media (prefers-reduced-motion: reduce) {
      .ai-widget-root .ai-widget-modal, .ai-widget-root .ai-widget-dot { animation: none; }
    }

    @media (max-width: 480px) {
      .ai-widget-root .ai-widget-modal,
      .ai-widget-root.is-left .ai-widget-modal {
        left: 8px; right: 8px; bottom: 8px; width: auto; max-width: none; max-height: none;
        height: min(70vh, calc(100vh - 16px));
        height: min(70dvh, calc(100dvh - 16px));
      }
      .ai-widget-root.is-open .ai-widget-button { display: none; }
      .ai-widget-root.is-expanded .ai-widget-modal,
      .ai-widget-root.is-left.is-expanded .ai-widget-modal {
        inset: 0; width: 100%; height: 100vh; height: 100dvh; border-radius: 0;
      }
    }
  \`;

  const styleSheet = document.createElement('style');
  styleSheet.id = 'ai-widget-styles';
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Static markup only. Owner text is set with textContent after mounting.
  const root = document.createElement('div');
  root.className = 'ai-widget-root' + (isLeft ? ' is-left' : '');
  root.id = 'ai-widget-root';
  root.style.setProperty('--aiw-accent', accent);
  root.style.setProperty('--aiw-on-accent', onAccent);
  root.style.setProperty('--aiw-w', dims[0] + 'px');
  root.style.setProperty('--aiw-h', dims[1] + 'px');
  root.innerHTML = \`
    <button type="button" class="ai-widget-button" id="ai-widget-btn" aria-label="Open chat" aria-expanded="false" aria-controls="ai-widget-modal">
      <svg class="ai-widget-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
    </button>
    <div class="ai-widget-modal" id="ai-widget-modal" role="dialog" aria-modal="false" aria-labelledby="ai-widget-title" hidden>
      <div class="ai-widget-header">
        <h2 class="ai-widget-title" id="ai-widget-title"></h2>
        <div class="ai-widget-header-actions">
          <button type="button" class="ai-widget-expand" id="ai-widget-expand" aria-label="Expand chat" aria-pressed="false">
            <svg class="ai-widget-icon ai-widget-icon-sm ai-widget-icon-expand" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            <svg class="ai-widget-icon ai-widget-icon-sm ai-widget-icon-restore" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>
          </button>
          <button type="button" class="ai-widget-close" id="ai-widget-close" aria-label="Close chat">
            <svg class="ai-widget-icon ai-widget-icon-sm" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="ai-widget-messages" id="ai-widget-messages" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="ai-widget-input-container">
        <input type="text" class="ai-widget-input" id="ai-widget-input" aria-label="Message" placeholder="Ask a question" maxlength="2000" autocomplete="off">
        <button type="button" class="ai-widget-send-btn" id="ai-widget-send">Send</button>
      </div>
    </div>
  \`;
  document.body.appendChild(root);

  const button = document.getElementById('ai-widget-btn');
  const modal = document.getElementById('ai-widget-modal');
  const closeBtn = document.getElementById('ai-widget-close');
  const expandBtn = document.getElementById('ai-widget-expand');
  const input = document.getElementById('ai-widget-input');
  const sendBtn = document.getElementById('ai-widget-send');
  const messagesContainer = document.getElementById('ai-widget-messages');
  const titleEl = document.getElementById('ai-widget-title');

  let isOpen = false;
  let isExpanded = false;
  let isPending = false;
  let sessionId = null;

  function scrollToEnd() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Inline formatting: **bold** and \`code\`. Every piece is set through
  // textContent, so HTML in an answer shows as literal text.
  function appendInline(parent, line) {
    const parts = line.split(/(\\*\\*[^*]+\\*\\*|\`[^\`]+\`)/);
    parts.forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1 && part.charAt(0) === '*') {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (i % 2 === 1) {
        const code = document.createElement('code');
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  // A small Markdown subset for AI answers, built only with createElement,
  // textContent and appendChild. Model output never goes through innerHTML.
  function renderRich(el, text) {
    const lines = String(text).replace(/<br\\s*\\/?>/gi, '\\n').split(/\\r?\\n/);
    let para = null;
    let list = null;
    let listType = '';

    function closeBlock() {
      para = null;
      list = null;
      listType = '';
    }
    function addBlock(tag, className) {
      closeBlock();
      const node = document.createElement(tag);
      if (className) node.className = className;
      el.appendChild(node);
      return node;
    }
    function addItem(type, content, start) {
      if (!list || listType !== type) {
        list = addBlock(type);
        listType = type;
        if (type === 'ol' && start > 1) list.start = start;
      }
      const li = document.createElement('li');
      appendInline(li, content);
      list.appendChild(li);
    }

    lines.forEach(function (raw) {
      const line = raw.trim();
      let m;
      if (!line) {
        closeBlock();
      } else if (line.indexOf('-') !== -1 && /^\\|?[\\s:|-]+\\|?$/.test(line)) {
        // Table separator row or horizontal rule: dropped.
      } else if ((m = /^[-*\\u2022]\\s+(.*)$/.exec(line))) {
        addItem('ul', m[1]);
      } else if ((m = /^(\\d+)[.)]\\s+(.*)$/.exec(line))) {
        addItem('ol', m[2], parseInt(m[1], 10));
      } else if ((m = /^#{1,6}\\s+(.*)$/.exec(line))) {
        appendInline(addBlock('p', 'ai-widget-heading'), m[1]);
        closeBlock();
      } else if (line.length > 1 && line.charAt(0) === '|' && line.charAt(line.length - 1) === '|') {
        const cells = line.slice(1, -1).split('|').map(function (c) { return c.trim(); }).filter(Boolean);
        appendInline(addBlock('p'), cells.join(' / '));
        closeBlock();
      } else {
        if (para) {
          para.appendChild(document.createElement('br'));
        } else {
          para = addBlock('p');
        }
        appendInline(para, line);
      }
    });
  }

  function addMessage(message, sender, isEnhanced = false, rich = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'ai-widget-message ' + sender + (isEnhanced ? ' enhanced' : '');
    if (rich) renderRich(messageDiv, message);
    else messageDiv.textContent = message;
    messagesContainer.appendChild(messageDiv);
    scrollToEnd();
  }

  function addError(reason) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'ai-widget-message error';
    const heading = document.createElement('strong');
    heading.className = 'ai-widget-error-title';
    heading.textContent = "Couldn't get an answer.";
    const detail = document.createElement('span');
    detail.className = 'ai-widget-error-reason';
    detail.textContent = reason;
    errorDiv.appendChild(heading);
    errorDiv.appendChild(detail);
    messagesContainer.appendChild(errorDiv);
    scrollToEnd();
  }

  function showTyping() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-widget-typing';
    typingDiv.id = 'typing-indicator';
    const dots = document.createElement('span');
    dots.className = 'ai-widget-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'ai-widget-dot';
      dots.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = 'Writing an answer';
    typingDiv.appendChild(dots);
    typingDiv.appendChild(label);
    messagesContainer.appendChild(typingDiv);
    scrollToEnd();
  }

  function hideTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) {
      typing.remove();
    }
  }

  function openWidget() {
    isOpen = true;
    modal.hidden = false;
    root.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Close chat');
    input.focus();
  }

  function setExpanded(expanded) {
    isExpanded = expanded;
    root.classList.toggle('is-expanded', expanded);
    expandBtn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  }

  function closeWidget() {
    isOpen = false;
    setExpanded(false);
    modal.hidden = true;
    root.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open chat');
    button.focus();
  }

  function toggleWidget() {
    if (isOpen) closeWidget();
    else openWidget();
  }

  // Esc steps back one level: an expanded panel is restored to its normal
  // size (focus returns to the expand button); otherwise the panel closes
  // (focus returns to the launcher). Closing always resets the expanded state.
  function handleEscape() {
    if (!isOpen) return;
    if (isExpanded) {
      setExpanded(false);
      expandBtn.focus();
    } else {
      closeWidget();
    }
  }

  async function sendMessage() {
    if (isPending) return;
    const message = input.value.trim();
    if (!message) return;

    isPending = true;
    sendBtn.disabled = true;
    addMessage(message, 'user');
    input.value = '';
    showTyping();

    try {
      const response = await fetch(\`\${apiBaseUrl}/api/widget/chat\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          widgetKey: widgetConfig.widgetKey,
          sessionId: sessionId
        }),
      });

      let data = null;
      try { data = await response.json(); } catch (e) {}
      hideTyping();

      // A failed request still returns a message and a placeholder session
      // id, so check the status before treating the body as an answer.
      if (!response.ok || !data || typeof data.message !== 'string' || !data.message) {
        addError(response.status === 429
          ? 'Too many messages from this network. Wait a minute and try again.'
          : "The assistant couldn't answer just now. Try again in a moment.");
        return;
      }

      if (data.sessionId && !sessionId) {
        sessionId = data.sessionId;
      }

      addMessage(data.message, 'ai', data.isEnhanced, true);
    } catch (error) {
      hideTyping();
      addError("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      isPending = false;
      sendBtn.disabled = false;
      if (isOpen) input.focus();
    }
  }

  titleEl.textContent = widgetConfig.title;
  if (widgetConfig.welcomeMessage) addMessage(widgetConfig.welcomeMessage, 'ai');

  button.addEventListener('click', toggleWidget);
  closeBtn.addEventListener('click', closeWidget);
  expandBtn.addEventListener('click', function () { setExpanded(!isExpanded); });
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') handleEscape();
  });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
`.trim()
}
