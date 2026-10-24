# 🚀 AI Assistant Builder

> **Create custom AI assistants trained on your business knowledge in minutes**

A powerful platform that lets any business build, test, and deploy intelligent AI assistants trained on their specific documents and knowledge base. Transform generic AI into domain experts with just a few clicks.

## ✨ What It Does

### 🎯 **Complete AI Assistant Builder**
- **Custom Configuration**: Set display name, welcome message, colors, and positioning
- **Your Documents**: Upload business documents (PDF, TXT, MD, DOCX) for the assistant to answer from
- **Live Preview**: See exactly how your assistant will look and behave
- **One-Click Deployment**: Generate embeddable JavaScript code for your website
- **Professional UI**: Clean, mobile-responsive design that works on any website

### 📚 **Intelligent Document Processing**
- **Chunking**: Splits each document into fixed-size passages of about 1,000 characters
- **Local Embeddings**: Passages are embedded on the server with an open-source model (`all-MiniLM-L6-v2`), so indexing needs no API key and sends no document text to a third party
- **Source Attribution**: Shows which documents were used in each response
- **Retrieval Match Score**: Shows how closely the retrieved passages match the question (a similarity score, not a probability that the answer is correct)

### 🌐 **Production-Ready Deployment**
- **Embeddable Widget**: Copy-paste JavaScript code to add to any website
- **Customizable Appearance**: Match your brand colors and positioning preferences
- **Mobile Optimized**: Works seamlessly on desktop, tablet, and mobile devices
- **Bounded by default**: Per-IP rate limits, input size caps, and optional per-widget domain allowlists. See [GOVERNANCE.md](GOVERNANCE.md) for what is and is not protected

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/mahAnuj/ai-support-bot.git
cd ai-support-bot
npm install

# Set your Groq API key (free tier at console.groq.com)
echo "GROQ_API_KEY=your_groq_key" > .env.local

# Start the builder
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and start building your AI assistant!

## 🎥 Demo Features

### **🎨 Live Configuration**
- Real-time preview as you customize
- See exactly what customers will experience
- Instant updates when you change settings

### **📄 Smart Document Processing**
- Drag & drop PDF, DOCX, TXT, MD files
- Automatic chunking and indexing
- Progress indicators and success confirmation

### **🚀 One-Click Deployment**
- Generate production-ready JavaScript code
- Copy-paste integration for any website
- Complete implementation guide included

## 🎪 How It Works

1. **Test the AI**: Try sample questions to see baseline performance
2. **Upload Documents**: Add your business knowledge (PDFs, docs, text files)
3. **Configure Assistant**: Customize name, welcome message, colors, and position
4. **Live Preview**: See real-time improvements in the chat interface
5. **Deploy**: Generate and copy embeddable code for your website

## 📊 Before vs After

| Without Documents | With Documents |
|------------------|----------------|
| Generic responses | Business-specific answers |
| "I don't know" | Cites your actual policies |
| Low retrieval match | High retrieval match |
| Basic information | Answers drawn from your documents |
| No source attribution | Clear document references |

## 🛠 Technology Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS v4
- **Backend**: Next.js API routes (serverless)
- **Storage**: In-memory (`src/lib/database.ts`) — no external database required
- **Chat model**: `llama-3.1-8b-instant` on Groq (free tier; override with `GROQ_MODEL`)
- **Embeddings**: `Xenova/all-MiniLM-L6-v2` via transformers.js, run on the server
- **Vector Search**: In-process cosine similarity
- **File Processing**: Built-in PDF, TXT, MD, DOCX support
- **Enhancement**: RAG (Retrieval-Augmented Generation)
- **Deployment**: Vercel-ready with one-click deploy

## 🚀 Deployment

### **Vercel (Recommended)**
```bash
# Build and deploy
npm run build
vercel --prod

# Set environment variables in Vercel dashboard:
# GROQ_API_KEY
```

### **Environment Variables**
```bash
# Required
GROQ_API_KEY=your_groq_api_key

# Optional
GROQ_MODEL=llama-3.1-8b-instant
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
```

## ⚙️ Configuration

### **Assistant Settings**
The platform allows full customization of AI assistants:

```typescript
// Widget configuration options
const widgetConfig = {
  name: 'Business Support Assistant',    // Internal reference
  title: 'AI Support Assistant',        // Displayed to users
  welcome_message: 'Hi! How can I help?', // First message
  primary_color: '#3B82F6',             // Brand color
  position: 'bottom-right',             // bottom-right | bottom-left
  size: 'medium'                        // small | medium | large
}
```

### **Advanced Customization**
- **System Prompts**: Modify `UNIVERSAL_ASSISTANT.systemPrompt` in `src/app/page.tsx`
- **Styling**: Built with Tailwind CSS v4
- **Branding**: Professional blue/gray color scheme, fully customizable
- **Responsive**: Mobile-first design that works on all devices

## 📝 Use Cases

### **E-commerce**
Upload product catalogs, return policies, shipping guides
- *"What's your return policy for shoes?"*
- *"Do you have size guides available?"*

### **SaaS Support**
Upload user manuals, API docs, troubleshooting guides
- *"How do I invite team members?"*
- *"What are the API rate limits?"*

### **Healthcare**
Upload patient information, procedure guides, insurance details
- *"Do you accept my insurance?"*
- *"What should I bring to my appointment?"*

### **Professional Services**
Upload service descriptions, process guides, FAQ documents
- *"What's the process for making an offer?"*
- *"What documents do I need for closing?"*

## 🔧 Development

### **Project Structure**
```
ai-support-bot/
├── src/
│   ├── app/                 # Next.js App Router pages
│   ├── components/ui/       # Reusable UI components
│   ├── lib/                 # Core functionality (RAG, chat model, embeddings)
│   └── types/               # TypeScript definitions
├── public/                  # Static assets
└── scripts/                 # Database setup scripts
```

### **Key Components**
- **ChatInterface**: Main conversation component with live preview
- **FileUpload**: Document upload and processing
- **WidgetGenerator**: Embeddable code generation

### **Testing**

Jest, jsdom and Testing Library are configured, but **no test files exist yet**,
so `npm test` currently exits 1 with "No tests found". Adding the first test is
a good first contribution — see [CONTRIBUTING.md](CONTRIBUTING.md).

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/widget-customization`
3. **Add** your changes and tests
4. **Check**: `npm run lint` and `npm run build`
5. **Submit** pull request with detailed description

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

### **Development Guidelines**
- Tests are welcome — none exist yet, so the first one sets the pattern
- Use TypeScript for type safety
- Follow the existing code style and conventions
- Add tests for new features

## 🚀 Roadmap

- [ ] **Multi-language Support**: Support for non-English documents
- [ ] **Analytics**: Track widget performance and user engagement (not built yet)
- [ ] **Custom Domains**: White-label deployment options
- [ ] **Team Collaboration**: Multi-user workspace management
- [ ] **API Access**: RESTful API for programmatic assistant management
- [ ] **Advanced Theming**: Full CSS customization options

## 📝 License

MIT. See [LICENSE](LICENSE).

---

## 🌟 Why Choose AI Assistant Builder?

✅ **5-Minute Setup** - From documents to deployed assistant in minutes  
✅ **No Technical Skills Required** - Visual interface, no coding needed  
✅ **Mobile Optimized** - Works on desktop, tablet and phone  
✅ **Brand Consistent** - Match your company's look and feel  
✅ **Honest About Data** - [GOVERNANCE.md](GOVERNANCE.md) says exactly where your documents go  

**Transform your customer support** with intelligent AI assistants powered by your business knowledge! 🚀
