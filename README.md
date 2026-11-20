# BiteMap

Production-oriented restaurant discovery and ordering starter with Razorpay checkout.

## Run locally

1. Install Node.js 18+.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add Razorpay test keys.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Without Razorpay keys, restaurant browsing and cart features still work, but checkout will explain that payment is not configured.

## Razorpay setup

- Create a Razorpay account and use test keys for development.
- Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in the deployment environment.
- Configure the webhook URL as `https://your-domain.example/api/webhooks/razorpay`.
- Never expose `RAZORPAY_KEY_SECRET` or webhook secrets in frontend code.

## Deploy

Deploy this repository to any Node 18 host (Render, Railway, Fly.io, or a VM), set the environment variables from `.env.example`, and use `npm start` as the start command. The included JSON order store is suitable for development only; replace `readOrders`/`writeOrders` with PostgreSQL or another managed database before handling real production volume.
