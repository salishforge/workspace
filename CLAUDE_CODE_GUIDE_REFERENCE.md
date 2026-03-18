# The Ultimate Claude Code Guide — Reference for CTO
## Source: thecode-claude-code-guide.lovable.app
## Captured: 2026-03-09

*50+ Tips and Tricks — How senior engineers at Anthropic use Claude Code to ship products 5x faster*

---

## Getting Started

### 1. Install Claude Code the Right Way
- **Local installation:** Download from Anthropic's website
- **Remote server:** Install on AWS, Digital Ocean, or any cloud server
- **Inside other tools:** Use within Cursor, Windsurf, or VS Code
- **Pro tip:** Remote installation lets you code from your phone using apps like Termius!

### 2. Choose Your Subscription Plan Wisely
- **Pro Plan ($20/month):** Good for learning and small projects
- **Max Plan ($100/month):** Best for serious developers - 5x higher limits
- **Max 20X ($200/month):** For heavy users who code all day
- Skip the API option unless your company pays for it - it's way too expensive.

### 3. Master the Three Input Modes
Press `Shift + Tab` to cycle through modes:
- **Edit mode:** Asks permission before making changes (default)
- **Auto-accept mode:** Makes changes without asking (best for most work)
- **Plan mode:** Creates plans without writing code (perfect for thinking through problems)

---

## Basic Setup and Commands

### 4. Set Up Multi-Line Prompts
Run `/terminal-setup` once to enable `Shift + Enter` for multi-line prompts.

### 5. Connect Your IDE
Use `/ide` to connect VS Code, Cursor, or JetBrains.

### 6. Essential Keyboard Shortcuts
- `CMD/CTRL + Escape`: Quick open Claude Code
- `CMD/CTRL + L`: Clear screen
- `ESC + ESC`: Jump to previous prompt
- `CMD/CTRL + R`: Verbose output
- `Shift + Enter`: New line (after terminal setup)

### 7. Use the Resume Feature
Use `/resume` to pick up exactly where you left off after crashes.

### 8. Handle Long Prompts Like a Pro
- Press `CMD/CTRL + N` to open a new buffer
- Write your entire prompt with formatting
- Select all and copy, paste into Claude Code

---

## Essential Features

### 9. Use To-Do Lists for Complex Tasks
Explicitly ask Claude to "create a to-do list first" before coding. Prevents loops and keeps work organized.

### 10. Master Bash Mode
Claude can run terminal commands: read files, handle git, install packages, run tests.

### 11. Work with Images Directly
Drag and drop screenshots or copy-paste images for "make it look like this" requests, debugging UI, sharing mockups.

### 12. Track Your Costs
Run `npx ccusage` for detailed token usage. Use `blocks --live` for real-time monitoring.

### 13. Don't Be Afraid to Interrupt
Press `Escape` once to stop, twice to go back. Better to redirect early than waste tokens.

---

## Smart Prompting

### 14. Control Claude's Thinking Power
- `"think about this..."` - Basic thinking (fast)
- `"think harder about..."` - More analysis (complex problems)
- `"ultrathink about..."` - Maximum thinking (critical decisions)

### 15. Use Subagents for Big Tasks
Ask Claude to "use subagents to refactor this codebase." It will split work, create parallel agents, coordinate, and merge results.

### 16. Run Tasks in Loops
"Run the build in a loop and fix all errors as they appear." Claude keeps running and fixing until everything works.

### 17. Leverage Planning Mode
Use plan mode for architecture decisions, complex features, and debugging. Hit `Shift + Tab` twice to enter plan-only mode.

### 18. Use the Message Queue
Type new messages while Claude is working — they get added to a queue and processed in order.

---

## Project Configuration

### 19. Create a Powerful claude.md File
This is your project's memory. Include:
- Coding standards and preferences
- Project architecture overview
- Git workflow rules
- Testing requirements
- Documentation standards

### 20. Auto-Generate Your claude.md
Ask Claude: "Analyze my project and create a comprehensive claude.md file with all the rules and standards you detect."

### 21. Use Nested claude.md Files
Create directory-specific rules:
```
project/
├── claude.md (global rules)
├── frontend/
│   └── claude.md (frontend rules)
└── backend/
    └── claude.md (backend rules)
```

### 22. Initialize Existing Projects
Run `/init` to automatically generate detected conventions, file structure, dependencies, code patterns.

### 23. Add Rules on the Fly
Type `# "Always use async/await instead of .then()"` anywhere to automatically add it to claude.md.

---

## Essential Rules for Every Project

### Version Control Rule
```markdown
## Git Workflow
- Create feature branches for all changes
- Commit frequently with descriptive messages
- Never push directly to main branch
- Add and commit automatically when tasks complete
```

### Code Quality Rule
```markdown
## Code Quality (CRITICAL)
ALWAYS run IDE diagnostics after editing files
Fix all linting and type errors before completing tasks
This step must NEVER be skipped
```

### Documentation Rule
```markdown
## Documentation
- Update README.md when adding new features
- Create inline comments for complex logic
- Generate API docs for new endpoints
- Keep change logs updated
```

### Testing Rule
```markdown
## Testing Requirements
- Write tests for all new features
- Run existing tests before completing tasks
- Focus on end-to-end tests over unit tests
- Use test-driven development for complex features
```

---

## Final Thoughts

Claude Code is incredibly powerful when configured correctly. The key is to:
1. Set up proper automation with hooks and rules
2. Use the right prompting techniques for your tasks
3. Leverage MCP extensions for enhanced capabilities
4. Think like a product manager rather than a code reviewer
5. Customize everything to match your workflow

**REMEMBER:** Claude Code is not just a coding assistant - it's a complete development environment that can handle research, documentation, testing, and deployment when properly configured.
