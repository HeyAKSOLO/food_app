import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import Razorpay from "razorpay";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
const ordersFile = path.join(dataDir, "orders.json");
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

app.use(cors({ origin: process.env.PUBLIC_APP_URL || true }));
app.use("/api/webhooks/razorpay", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const restaurants = [
  { id: 1, name: "The Fatty Bao", cuisine: "Asian · Sushi · Ramen", area: "Indiranagar", rating: 4.6, price: 900, time: "28–33 min", status: "Open", image: "https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=900&q=80", menu: [{ id: "fatty-edamame", name: "Truffle Edamame", price: 295 }, { id: "fatty-ramen", name: "Chicken Ramen", price: 525 }, { id: "fatty-prawns", name: "Miso Butter Prawns", price: 575 }] },
  { id: 2, name: "Mamagoto", cuisine: "Pan Asian · Cocktails", area: "Koramangala", rating: 4.5, price: 1100, time: "35–40 min", status: "Open", image: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=80", menu: [{ id: "mama-prawns", name: "Bang Bang Prawns", price: 495 }, { id: "mama-curry", name: "Thai Green Curry", price: 425 }] },
  { id: 3, name: "Smoor", cuisine: "Bakery · Coffee · Desserts", area: "100 ft Road", rating: 4.7, price: 600, time: "18–24 min", status: "Open", image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80", menu: [{ id: "smoor-chocolate", name: "Belgian Hot Chocolate", price: 275 }, { id: "smoor-croissant", name: "Pistachio Croissant", price: 260 }] }
];

async function readOrders() {
  try { return JSON.parse(await fs.readFile(ordersFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(ordersFile, "[]"); return []; }
}
async function writeOrders(orders) { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(ordersFile, JSON.stringify(orders, null, 2)); }
function getLineItems(items) {
  return items.map(item => {
    const restaurant = restaurants.find(r => r.id === Number(item.restaurantId));
    const product = restaurant?.menu.find(m => m.id === item.menuId);
    if (!restaurant || !product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new Error("Invalid menu item");
    return { restaurantId: restaurant.id, restaurant: restaurant.name, menuId: product.id, name: product.name, quantity: item.quantity, price: product.price };
  });
}

app.get("/api/config", (req, res) => res.json({ keyId: process.env.RAZORPAY_KEY_ID || null, currency: "INR" }));
app.get("/api/restaurants", (req, res) => res.json(restaurants));
app.get("/api/orders/:id", async (req, res) => {
  const order = (await readOrders()).find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});
app.post("/api/orders", async (req, res) => {
  try {
    const { items, customer } = req.body;
    if (!Array.isArray(items) || items.length === 0 || !customer?.name || !customer?.phone || !customer?.address) return res.status(400).json({ error: "Items and delivery details are required" });
    const lineItems = getLineItems(items);
    const total = lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderId = `BM-${Date.now().toString(36).toUpperCase()}`;
    let paymentOrder = null;
    if (razorpay) paymentOrder = await razorpay.orders.create({ amount: total * 100, currency: "INR", receipt: orderId, notes: { appOrderId: orderId } });
    const order = { id: orderId, items: lineItems, customer, total, status: "payment_pending", paymentOrderId: paymentOrder?.id || null, createdAt: new Date().toISOString() };
    const orders = await readOrders(); orders.push(order); await writeOrders(orders);
    res.status(201).json({ order, razorpay: paymentOrder ? { orderId: paymentOrder.id, amount: paymentOrder.amount, keyId: process.env.RAZORPAY_KEY_ID } : null });
  } catch (error) { res.status(400).json({ error: error.message || "Could not create order" }); }
});
app.post("/api/payments/verify", async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({ error: "Incomplete payment verification data" });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  if (expected !== razorpay_signature) return res.status(400).json({ error: "Payment signature verification failed" });
  const orders = await readOrders(); const order = orders.find(item => item.id === orderId);
  if (!order || order.paymentOrderId !== razorpay_order_id) return res.status(404).json({ error: "Order not found" });
  order.status = "confirmed"; order.paymentId = razorpay_payment_id; order.paidAt = new Date().toISOString(); await writeOrders(orders);
  res.json({ order });
});
app.post("/api/webhooks/razorpay", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "").update(req.body).digest("hex");
  const supplied = Buffer.from(String(signature || ""));
  const digest = Buffer.from(expected);
  if (!signature || supplied.length !== digest.length || !crypto.timingSafeEqual(supplied, digest)) return res.status(400).send("Invalid signature");
  const event = JSON.parse(req.body.toString("utf8"));
  if (event.event === "payment.failed") console.warn("Razorpay payment failed", event.payload?.payment?.entity?.id);
  res.sendStatus(200);
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(port, () => console.log(`BiteMap running at http://localhost:${port}`));
