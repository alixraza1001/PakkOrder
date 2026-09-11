<div align="center">

# PakkOrder

### COD verification & ecommerce automation for Pakistani online sellers

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=111)
![WhatsApp](https://img.shields.io/badge/WhatsApp%20Cloud%20API-25D366?style=flat-square&logo=whatsapp&logoColor=white)
![Shopify](https://img.shields.io/badge/Shopify-7AB55C?style=flat-square&logo=shopify&logoColor=white)

</div>

> [!NOTE]
> **Archived portfolio project.** PakkOrder is no longer deployed or actively maintained. This repository is a sanitized source snapshot intended to demonstrate the product, architecture, and engineering work. Production credentials, historical secrets, customer data, and deployment-specific identifiers are intentionally omitted.

## The problem

Cash-on-delivery is common in Pakistani ecommerce, but merchants often spend time manually calling or messaging buyers before fulfillment to check whether an order is genuine.

PakkOrder was built to automate that confirmation layer: capture a COD order, contact the buyer through WhatsApp or email, record the response, and give the merchant a structured view of what should be fulfilled, cancelled, or followed up.

## Product flow

```text
Customer places a COD order
          ↓
PakkOrder receives the order
          ↓
WhatsApp / email confirmation is sent
          ↓
Customer confirms or cancels
          ↓
Seller workflow reflects the decision
          ↓
Stale orders can be handled automatically
```

## What was built

- **WhatsApp confirmation workflows** through Meta's WhatsApp Business Cloud API
- **Email confirmation** and notification flows through Resend
- **Confirm / cancel actions** tied back to the originating order
- **Multi-merchant backend foundations** with client accounts, plans, limits, and protected routes
- **Merchant API/dashboard backend** for order activity and seller operations
- **Shopify integration** through OAuth and `orders/create` webhooks
- **Embeddable storefront integration** for non-Shopify checkout forms
- **Bulk order tooling** for spreadsheet/manual seller workflows
- **Scheduled operations** for reminders, stale orders, reporting, and usage resets
- **Firebase / Firestore persistence** with server-side Firebase Admin access
- **Security middleware** including Helmet, CORS, JWT authentication, validation, rate limiting, and Shopify webhook HMAC verification

## Architecture

```text
Storefront / Shopify / Bulk Upload
               │
               ▼
        Express API layer
               │
      ┌────────┼─────────┐
      ▼        ▼         ▼
   Orders   Merchant   Webhooks
             APIs
      │        │         │
      └────────┼─────────┘
               ▼
        Service layer
   Firebase · WhatsApp · Email
               │
               ▼
       Firestore + queues
```

The source snapshot keeps route handling, middleware and service logic separated so order ingestion, messaging, merchant APIs, webhooks and integrations can evolve independently.

## Tech stack

| Area | Technology |
|---|---|
| Runtime | Node.js |
| API | Express 5 |
| Database | Firebase Admin + Firestore |
| Authentication | Firebase Auth + JWT |
| Messaging | Meta WhatsApp Business Cloud API |
| Email | Resend |
| Ecommerce | Shopify OAuth + webhooks |
| Scheduling | node-cron |
| Security | Helmet, CORS, express-rate-limit, webhook HMAC verification |
| File/data handling | XLSX, Multer, Axios |
| Original deployment target | Railway / Node-compatible hosting |

## Repository structure

```text
PakkOrder/
├── src/
│   ├── routes/         # Orders, merchant APIs, admin, webhooks, Shopify, bulk
│   ├── middleware/     # Authentication, request validation, limits
│   ├── services/       # Firebase, WhatsApp, email, queues, order logic
│   └── utils/          # Logging, phone and license helpers
├── lib/                # Shared helpers
├── public/
│   └── snippet.js      # Archived storefront integration example
├── shopify-plugin/     # Archived Shopify integration notes/snippet
├── firestore.rules
├── firestore.indexes.json
├── server.js
└── package.json
```

The original commercial build also included marketing pages and a browser dashboard. Those deployment-facing assets were deliberately left out of this public snapshot so the repository stays focused on the engineering work and avoids carrying old operational material forward.

## Local setup

### Prerequisites

- Node.js 18+
- A Firebase project with Firestore enabled
- Meta Business / WhatsApp Cloud API credentials if testing messaging
- A Resend account if testing email

```bash
git clone https://github.com/alixraza1001/PakkOrder.git
cd PakkOrder
npm install
cp .env.example .env
npm start
```

Populate `.env` only with your own development credentials. The included `.env.example` contains placeholders rather than live values.

## Configuration

The application reads configuration from environment variables such as:

```text
APP_URL
JWT_SECRET
ADMIN_SECRET

META_PHONE_NUMBER_ID
META_ACCESS_TOKEN
META_VERIFY_TOKEN
META_WHATSAPP_NUMBER
META_TEMPLATE_NAME

FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_PATH
FIREBASE_SERVICE_ACCOUNT_JSON
FIREBASE_WEB_API_KEY

RESEND_API_KEY
SENDER_EMAIL
CONTACT_NOTIFY_EMAIL

SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET

TURNSTILE_SITE_KEY
TURNSTILE_SECRET
```

Never commit a real `.env`, Firebase service account, access token, JWT, or merchant/customer data.

## Security notes

This is an **archived product snapshot, not a production-ready starter template**.

- Firestore rules in this public snapshot default to **deny all**.
- Deployment credentials are intentionally excluded.
- Shopify webhook processing in this snapshot verifies the request HMAC before accepting an order event.
- The original product supported merchant-specific third-party credentials; a new production implementation should store such credentials in a managed secrets/KMS solution instead of normal application documents.
- Generate new secrets for any deployment rather than reusing historical PakkOrder credentials.
- This public repository was created from a sanitized snapshot with fresh Git history, so historical private-repository credentials are not carried into this repository.

## Health check

When configured and running, the service exposes:

```text
GET /health
```

## Background

PakkOrder began as one of my early attempts to turn a real ecommerce workflow into a complete software product rather than a classroom demo. It grew from simple COD verification into messaging automation, merchant accounts, Shopify integration, bulk workflows, reporting, and operational tooling.

The initial version was built with **Claude as an AI-assisted development partner**. Claude helped with implementation reasoning and iteration during development; it was not a runtime dependency of the product.

---

Built by **[Ali Raza Memon](https://github.com/alixraza1001)**.
