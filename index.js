import mongoose from "mongoose";
import { MONGO_URI } from "./config.js";

async function testConnection() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB Atlas (sookiDB)!");
    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}

testConnection();
