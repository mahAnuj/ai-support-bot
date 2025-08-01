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
    .ai-widget-button {
      position: fixed;
      ${widgetConfig.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 20px;
      width: 60px;
      height: 60px;
      background-color: ${widgetConfig.primaryColor};
      border-radius: 50%;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: white;
      transition: all 0.3s ease;
    }
    
    .ai-widget-button:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }
    
    .ai-widget-modal {
      position: fixed;
      ${widgetConfig.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 90px;
      width: ${widgetConfig.size === 'large' ? '400px' : widgetConfig.size === 'small' ? '300px' : '350px'};
      height: ${widgetConfig.size === 'large' ? '600px' : widgetConfig.size === 'small' ? '400px' : '500px'};
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      z-index: 10001;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .ai-widget-header {
      background: ${widgetConfig.primaryColor};
      color: white;
      padding: 16px;
      border-radius: 12px 12px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .ai-widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .ai-widget-message {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    
    .ai-widget-message.user {
      background: ${widgetConfig.primaryColor};
      color: white;
      align-self: flex-end;
    }
    
    .ai-widget-message.ai {
      background: #f3f4f6;
      color: #374151;
      align-self: flex-start;
    }
    
    .ai-widget-message.enhanced {
      background: linear-gradient(135deg, #e8f5e8, #e3f2fd);
      border-left: 3px solid #4caf50;
    }
    
    .ai-widget-input-container {
      padding: 16px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
    }
    
    .ai-widget-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
    }
    
    .ai-widget-send-btn {
      background: ${widgetConfig.primaryColor};
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    
    .ai-widget-close {
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
    }
    
    .ai-widget-typing {
      padding: 8px 12px;
      background: #f3f4f6;
      border-radius: 12px;
      font-size: 12px;
      color: #666;
      align-self: flex-start;
    }
    
    @media (max-width: 480px) {
      .ai-widget-modal {
        width: calc(100vw - 40px);
        height: 70vh;
        left: 20px !important;
        right: auto !important;
      }
    }
  `;
  
  // Create and inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
  
  // Create widget HTML
  const widgetHTML = `
    <button class="ai-widget-button" id="ai-widget-btn">
      🤖
    </button>
    
    <div class="ai-widget-modal" id="ai-widget-modal">
      <div class="ai-widget-header">
        <h3 style="margin: 0; font-size: 16px;">${widgetConfig.title}</h3>
        <button class="ai-widget-close" id="ai-widget-close">×</button>
      </div>
      
      <div class="ai-widget-messages" id="ai-widget-messages">
        <div class="ai-widget-message ai">
          ${widgetConfig.welcomeMessage}
        </div>
      </div>
      
      <div class="ai-widget-input-container">
        <input 
          type="text" 
          class="ai-widget-input" 
          id="ai-widget-input"
          placeholder="Type your message..."
        >
        <button class="ai-widget-send-btn" id="ai-widget-send">Send</button>
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
  
  let isOpen = false;
  let sessionId = null;
  
  function toggleWidget() {
    isOpen = !isOpen;
    modal.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      input.focus();
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
  
  console.log('🤖 AI Support Widget loaded successfully!');
})();