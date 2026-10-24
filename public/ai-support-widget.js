(function() {
  // Widget configuration
  const widgetConfig = {
    widgetKey: 'widget-bc59b2b7',
    title: 'Anuj Mahajan',
    welcomeMessage: 'Hi! I\'m your AI assistant. I can help answer questions about our business. How can I assist you today?',
    primaryColor: '#f7613b',
    position: 'bottom-right',
    size: 'medium'
  };
  
  const apiBaseUrl = 'http://localhost:3000';
  
  // Create widget styles
  const styles = `
    .ai-widget-modal,
    .ai-widget-modal *,
    .ai-widget-button,
    .ai-widget-button * {
      box-sizing: border-box;
      letter-spacing: normal;
    }

    .ai-widget-button svg,
    .ai-widget-modal svg {
      display: block;
      flex: none;
      pointer-events: none;
    }

    .ai-widget-button {
      position: fixed;
      ${widgetConfig.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 20px;
      width: 56px;
      height: 56px;
      margin: 0;
      padding: 0;
      background: ${widgetConfig.primaryColor};
      color: #FFFFFF;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(27,36,33,.12), 0 8px 24px -6px rgba(27,36,33,.28);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: box-shadow 150ms ease;
    }

    .ai-widget-button:hover {
      box-shadow: 0 4px 8px rgba(27,36,33,.16), 0 14px 32px -6px rgba(27,36,33,.36);
    }

    .ai-widget-modal {
      position: fixed;
      ${widgetConfig.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 88px;
      width: ${widgetConfig.size === 'large' ? '400px' : widgetConfig.size === 'small' ? '300px' : '350px'};
      height: ${widgetConfig.size === 'large' ? '600px' : widgetConfig.size === 'small' ? '400px' : '500px'};
      background: #FFFFFF;
      color: #1B2421;
      border: 1px solid rgba(27,36,33,.08);
      border-radius: 14px;
      box-shadow: 0 24px 48px -12px rgba(27,36,33,.30);
      overflow: hidden;
      z-index: 10001;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.45;
      text-align: left;
    }

    .ai-widget-header {
      background: ${widgetConfig.primaryColor};
      color: #FFFFFF;
      padding: 12px 12px 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex: none;
    }

    .ai-widget-title {
      margin: 0;
      padding: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: inherit;
      font-size: 19px;
      font-weight: 700;
      line-height: 1.3;
      color: #FFFFFF;
    }

    .ai-widget-close {
      width: 44px;
      height: 44px;
      margin: 0;
      padding: 0;
      background: transparent;
      color: #FFFFFF;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      transition: background-color 150ms ease;
    }

    .ai-widget-close:hover {
      background: rgba(255,255,255,.16);
    }

    .ai-widget-messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #FFFFFF;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ai-widget-message {
      max-width: 85%;
      margin: 0;
      padding: 10px 14px;
      font-size: 15px;
      line-height: 1.45;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .ai-widget-message.user {
      background: ${widgetConfig.primaryColor};
      color: #FFFFFF;
      border-radius: 14px 14px 4px 14px;
      align-self: flex-end;
    }

    .ai-widget-message.ai {
      background: #F2F4F3;
      color: #1B2421;
      border-radius: 14px 14px 14px 4px;
      align-self: flex-start;
    }

    .ai-widget-message.ai.enhanced {
      background: #F2F4F3;
      box-shadow: inset 3px 0 0 ${widgetConfig.primaryColor};
    }

    .ai-widget-typing {
      margin: 0;
      padding: 8px 14px;
      background: #F2F4F3;
      color: #4D5A56;
      border-radius: 14px 14px 14px 4px;
      font-size: 13px;
      line-height: 1.4;
      align-self: flex-start;
    }

    .ai-widget-input-container {
      border-top: 1px solid #DCE1DF;
      background: #FFFFFF;
      padding: 12px;
      display: flex;
      gap: 8px;
      flex: none;
    }

    .ai-widget-input {
      flex: 1;
      min-width: 0;
      height: 44px;
      margin: 0;
      padding: 0 12px;
      background: #FFFFFF;
      color: #1B2421;
      border: 1px solid #7B8783;
      border-radius: 10px;
      font-family: inherit;
      font-size: 15px;
      line-height: normal;
    }

    .ai-widget-input::placeholder {
      color: #5F6B67;
      opacity: 1;
    }

    .ai-widget-send-btn {
      width: 44px;
      height: 44px;
      margin: 0;
      padding: 0;
      background: ${widgetConfig.primaryColor};
      color: #FFFFFF;
      border: 0;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }

    .ai-widget-button:focus-visible,
    .ai-widget-close:focus-visible,
    .ai-widget-send-btn:focus-visible {
      outline: 2px solid #1B2421;
      outline-offset: 2px;
      box-shadow: 0 0 0 2px #FFFFFF;
    }

    .ai-widget-input:focus-visible {
      outline: 2px solid #1B2421;
      outline-offset: 1px;
      border-color: #1B2421;
    }

    @media (max-width: 480px) {
      .ai-widget-modal {
        left: 12px !important;
        right: 12px !important;
        width: auto;
        bottom: 84px;
        height: min(70vh, calc(100vh - 108px));
      }

      .ai-widget-button {
        ${widgetConfig.position === 'bottom-left' ? 'left: 16px' : 'right: 16px'};
        bottom: 16px;
      }

      .ai-widget-input {
        font-size: 16px;
      }
    }
  `;
  
  // Create and inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
  
  // Create widget HTML
  const widgetHTML = `
    <button type="button" class="ai-widget-button" id="ai-widget-btn" aria-label="Open chat" aria-controls="ai-widget-modal" aria-expanded="false">
      <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>
    </button>
    
    <div class="ai-widget-modal" id="ai-widget-modal" role="dialog">
      <div class="ai-widget-header">
        <h3 class="ai-widget-title">${widgetConfig.title}</h3>
        <button type="button" class="ai-widget-close" id="ai-widget-close" aria-label="Close chat">
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      
      <div class="ai-widget-messages" id="ai-widget-messages" role="log" aria-live="polite">
        <div class="ai-widget-message ai">${widgetConfig.welcomeMessage}</div>
      </div>
      
      <div class="ai-widget-input-container">
        <input 
          type="text" 
          class="ai-widget-input" 
          id="ai-widget-input"
          placeholder="Type your message..."
          aria-label="Message"
        >
        <button type="button" class="ai-widget-send-btn" id="ai-widget-send" aria-label="Send message">
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
  `;
  
  // Add widget to page
  document.body.insertAdjacentHTML('beforeend', widgetHTML);
  
  // Widget functionality
  const button = document.getElementById('ai-widget-btn');
  const modal = document.getElementById('ai-widget-modal');
  const closeBtn = document.getElementById('ai-widget-close');
  const input = document.getElementById('ai-widget-input');
  const sendBtn = document.getElementById('ai-widget-send');
  const messagesContainer = document.getElementById('ai-widget-messages');
  modal.setAttribute('aria-label', widgetConfig.title);
  
  let isOpen = false;
  let sessionId = null;
  
  function toggleWidget() {
    isOpen = !isOpen;
    modal.style.display = isOpen ? 'flex' : 'none';
    button.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      input.focus();
    } else {
      button.focus();
    }
  }
  
  function addMessage(message, sender, isEnhanced = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-widget-message ${sender}` + (isEnhanced ? ' enhanced' : '');
    messageDiv.textContent = message;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function showTyping() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-widget-typing';
    typingDiv.id = 'typing-indicator';
    typingDiv.textContent = 'AI is thinking...';
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function hideTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) {
      typing.remove();
    }
  }
  
  async function sendMessage() {
    const message = input.value.trim();
    if (!message) return;
    
    addMessage(message, 'user');
    input.value = '';
    showTyping();
    
    try {
      const response = await fetch(`${apiBaseUrl}/api/widget/chat`, {
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
      
      const data = await response.json();
      hideTyping();
      
      if (data.sessionId && !sessionId) {
        sessionId = data.sessionId;
      }
      
      addMessage(data.message || 'Sorry, I encountered an error.', 'ai', data.isEnhanced);
      
    } catch (error) {
      hideTyping();
      addMessage('Sorry, I encountered an error. Please try again.', 'ai');
    }
  }
  
  // Event listeners
  button.addEventListener('click', toggleWidget);
  closeBtn.addEventListener('click', toggleWidget);
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  modal.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) toggleWidget(); });
  
  console.log('🤖 AI Support Widget loaded successfully!');
})();