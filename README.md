# INDIAN AI BUILDER

<div align="center">

![Platform Banner](/public/IndianAI_Builder_Logo.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

**India's own AI Builder. Describe your app in plain English. INDIAN AI BUILDER returns production-ready React + Tailwind code in seconds.**

[Live Demo](#demo) · [Features](#key-features) · [Architecture](#system-architecture) · [Installation](#installation)

</div>

---

## Overview

**INDIAN AI BUILDER** is a production-ready, AI-powered code generation platform designed to instantly turn plain English prompts into functional React and Tailwind CSS applications. It provides an intuitive workspace for rapid prototyping, iteration, and deployment.

By leveraging advanced LLM capabilities via OpenRouter, the platform allows users to build, preview, and download custom web applications seamlessly—100% free for lifetime access.

---

## Business Problem

Modern software development often suffers from:

- **Slow prototyping cycles** where ideas take weeks to become visual models.
- **High barrier to entry** for non-technical founders and creators.
- **Fragmented workflows** where UI design, component building, and logic implementation are disconnected.
- **Expensive enterprise AI tools** that limit creativity and iteration.

These bottlenecks delay go-to-market strategies and increase the costs associated with minimum viable product (MVP) development.

---

## Solution

This platform acts as your personal AI software engineer:

- **Unified generative workspace** where prompts instantly become live code.
- **Real-time Sandpack integration** for instant browser-based code compilation and preview.
- **Contextual AI refinement** that allows users to ask the AI to "Improve this" or "Fix this bug" iteratively.
- **One-click zip export** to download the generated Next.js/React project directly to your local machine.
- **100% Free Lifetime Access** for all users, eliminating the cost barrier.

---

## Key Features

### 🎨 Intelligent Code Generation
- Describe your desired application, and the AI writes production-ready React and Tailwind components.
- Live streaming of generated code directly into an interactive editor.

### ⚡ Live In-Browser Preview
- Powered by CodeSandbox's Sandpack, instantly visualize your generated UI.
- Interactive components, functioning layouts, and responsive design preview.

### 🔄 Iterative AI Refinement
- "Improve with Agent" functionality allows you to refine specific parts of the generated code.
- Continuous conversation history ensures the AI understands the context of your application.

### 📦 Instant Project Export
- One-click "Download" button packages your entire generated project into a `.zip` file.
- Includes a pre-configured `package.json` and a custom `README.md` for immediate local development.

### 🔐 Seamless Authentication
- Clerk integration for secure, frictionless user sign-up and sign-in.
- User profile management and secure session handling.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Next.js 14 Frontend (App Router)          │  │
│  │                                                        │  │
│  │  ┌─────────────┐ ┌────────────────┐ ┌───────────────┐  │  │
│  │  │Landing Page │ │ Workspace Chat │ │ Code/Preview  │  │  │
│  │  │ (Marketing) │ │ (Prompt Input) │ │ (Sandpack UI) │  │  │
│  │  └─────────────┘ └────────────────┘ └───────────────┘  │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │  REST API / SSE
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   Next.js API Routes (Backend)               │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Clerk   │  │ Supabase  │  │OpenRouter│  │  Arcjet   │  │
│  │  Auth    │  │ Storage   │  │AI Gateway│  │Rate Limits│  │
│  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend & Backend
| Technology | Purpose |
|---|---|
| Next.js 14 | Full-stack React framework with App Router |
| TypeScript | Type-safe development |
| Tailwind CSS | Utility-first styling |
| Sandpack | In-browser code bundling and preview |
| Framer Motion | Animations and micro-interactions |
| Radix UI & shadcn/ui | Accessible UI primitives |
| Clerk | Authentication and User Management |
| Supabase | Database and persistent storage |
| Arcjet | Security and Rate Limiting |

### AI Integration
| Technology | Purpose |
|---|---|
| OpenRouter API | LLM gateway routing |
| Gemma-4-31B-IT | Core LLM model for code generation |
| AI SDK (Vercel) | Streaming text and object generation |

---

## Installation

### Prerequisites

Ensure the following are installed on your machine:
- **Node.js** ≥ 18.x (`node -v`)

---

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/indian-ai-builder.git
cd indian-ai-builder
```

---

### 2. Install Dependencies

```bash
npm install
```

---

### 3. Environment Setup

Create `.env.local` and configure your keys:

```env
# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key

# OpenRouter
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=your_openrouter_api_key
AI_MODEL=z-ai/glm-4.5-air:free
AI_MODEL_FALLBACKS=z-ai/glm-4.5-air:free
```

> ⚠️ **Never commit `.env.local` or any file containing real API keys.**

---

### 4. Run Development Server

```bash
npm run dev
```

The application will be available at **http://localhost:3000**

---

## License

This project is licensed under the MIT License.
