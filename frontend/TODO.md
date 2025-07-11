# EspressoBot TODO

## ✅ Completed
- [x] Integrate Task Manager as bash orchestrator tool
- [x] Integrate Memory Agent for context persistence  
- [x] Add visual indicators for spawned agents (real-time SSE status updates)
- [x] Fix conversation history sorting (newest on top)
- [x] Implement Shell Agency architecture with bash orchestrator
- [x] Fix SSE streaming for real-time updates
- [x] Create SWE Agent with MCP integration
- [x] Move Python tools to frontend repository for portability

## 🚀 Current Priority

### 1. Google Auth Login System
- [x] Set up Google OAuth 2.0 credentials (documentation created)
- [x] Implement backend auth endpoints
- [x] Create login/logout UI components
- [x] Add session management
- [x] Support Google Workspace accounts
- [x] Prepare hooks for future integrations (Gmail, Tasks, Drive, Calendar)
- [ ] Test with actual Google OAuth credentials
- [ ] Add user profile page
- [ ] Implement role-based access control

### 2. Planning Agent & Memory System
- [x] Create Planning Agent that analyzes requests and creates task plans
- [x] Integrate task planning into bash orchestrator
- [x] Add real-time task progress updates via SSE
- [ ] **MEMORY SYSTEM DISABLED** - Needs complete redesign to fix infinite loops
  - [ ] Use queue system to prevent concurrent memory operations
  - [ ] Implement proper cancellation tokens
  - [ ] Add circuit breaker pattern to prevent infinite retries
  - [ ] Consider using a separate service/worker for memory operations
  - [ ] Fix memory agent tool invocation issues
- [x] Add complexity analyzer for automatic planning decisions

### 3. iDrinkCoffee.com E-commerce Assistant Prompting
- [ ] Update system prompts for coffee/e-commerce focus
- [ ] Add coffee industry specific knowledge
- [ ] Include inventory management best practices
- [ ] Add customer service templates
- [ ] Configure for order processing workflows
- [ ] Include Shopify-specific optimizations

## 📋 Next Up

### 3. Enhanced Logging System
- [ ] Add "expand logs" button to UI
- [ ] Show detailed command outputs on demand
- [ ] Display step-by-step agent actions
- [ ] Include debug information toggle
- [ ] Store logs for session replay

### 4. Agent Templates & Patterns
- [ ] Bulk product update template
- [ ] Inventory sync workflow
- [ ] Price adjustment patterns
- [ ] Product creation wizard
- [ ] Order fulfillment automation
- [ ] Customer inquiry handler

### 5. Performance Optimizations
- [ ] Cache frequently used Python tool outputs
- [ ] Implement smart cache invalidation
- [ ] Add performance metrics dashboard
- [ ] Optimize token usage
- [ ] Reduce redundant tool calls

## 🔮 Future Enhancements

### Google Workspace Integration (Post-Auth)
- [ ] Gmail integration
  - [ ] Read customer emails
  - [ ] Send automated responses
  - [ ] Order confirmation handling
- [ ] Google Tasks
  - [ ] Sync with internal task system
  - [ ] Create tasks from customer requests
- [ ] Google Drive
  - [ ] Access product images
  - [ ] Store reports and exports
- [ ] Google Calendar
  - [ ] Schedule inventory updates
  - [ ] Plan promotional events

### Advanced Features
- [ ] Multi-tenant support for different stores
- [ ] Webhook integration for real-time updates
- [ ] Advanced analytics and reporting
- [ ] AI-powered demand forecasting
- [ ] Automated customer segmentation

## 📝 Documentation Needs
- [ ] API documentation
- [ ] Tool usage guide updates
- [ ] Deployment instructions
- [ ] Security best practices
- [ ] Integration tutorials