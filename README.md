# 🤖 AI Role-Based Assistant

> **Specialized AI assistants for different business roles with document-enhanced intelligence**

A powerful demonstration showing how AI assistants can be customized for specific business roles (HR, Technical Support, Sales, etc.) and enhanced with your own documents using RAG technology.

## ✨ What It Does

### 🎭 **Multiple Business Roles**
- **HR Assistant**: Employee policies, benefits, workplace procedures
- **Technical Support**: Product troubleshooting, user guides, technical documentation  
- **Sales Assistant**: Product information, pricing, customer support
- **Legal Advisor**: Contract reviews, compliance, legal procedures
- **Medical Assistant**: Healthcare information, procedures, patient support
- **E-commerce Support**: Order management, returns, customer service

### 📚 **Document Enhancement**
- Upload your business documents (PDF, TXT, DOCX)
- Watch AI responses transform from generic to expert-level
- Real-time confidence indicators show improvement
- Source attribution shows which documents were used

### 🎯 **Key Features**
- **Always-visible upload**: Prominent document upload section
- **Role-specific prompts**: Suggested questions for each business role
- **Clickable questions**: Click any suggested question to ask automatically
- **Professional UI**: Clean design with confidence indicators
- **Session management**: Isolated conversations with automatic cleanup

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/mahAnuj/ai-support-bot.git
cd ai-support-bot
npm install

# Add your OpenAI API key
echo "OPENAI_API_KEY=your_key_here" > .env.local

# Start the assistant
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and select your role!

## 🎪 How It Works

1. **Choose Your Role**: Select from 6 pre-configured business assistants
2. **Ask Questions**: Try the suggested questions or ask your own
3. **Upload Documents**: Add your business documents to enhance responses
4. **See the Magic**: Watch confidence jump from 30% to 95% with better answers

## 📊 Before vs After

| Without Documents | With Documents |
|------------------|----------------|
| Generic responses | Domain-specific answers |
| 30% confidence | 95% confidence |
| Basic information | Detailed, accurate guidance |
| No source attribution | Clear document references |

## 🛠 Technology Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Backend**: Next.js API routes
- **AI**: OpenAI GPT-4o-mini
- **Vector Search**: In-memory database with cosine similarity
- **File Processing**: PDF, TXT, DOCX support
- **Enhancement**: RAG (Retrieval-Augmented Generation)

## 🚀 Deployment

### **Vercel (Recommended)**
```bash
npm run build
vercel --prod
```

### **Environment Variables**
```bash
OPENAI_API_KEY=your_openai_api_key
```

## 🎨 Customization

### **Adding New Roles**
Edit `src/app/page.tsx` to add new assistant roles:

```typescript
const ASSISTANT_ROLES = {
  newRole: {
    title: "🔧 New Assistant",
    description: "Your custom assistant description",
    systemPrompt: "You are a helpful assistant for...",
    suggestedQuestions: ["Question 1", "Question 2"],
    sampleKnowledge: "Sample knowledge description..."
  }
}
```

### **Styling**
- Built with Tailwind CSS + Shadcn/ui components
- Professional blue/gray color scheme
- Fully responsive design

## 📝 Use Cases

### **HR Department**
Upload employee handbooks, policy documents, benefits guides
- "What's our vacation policy?"
- "How do I enroll in health insurance?"

### **Technical Support**
Upload product manuals, troubleshooting guides, FAQs
- "How do I reset the device?"
- "What are the system requirements?"

### **Sales Team**
Upload product catalogs, pricing sheets, customer guides
- "What's the price for enterprise plan?"
- "How does our product compare to competitors?"

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-role`
3. Add your changes
4. Test: `npm test`
5. Submit pull request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Transform your business communication** with specialized AI assistants powered by your own documents! 🚀
