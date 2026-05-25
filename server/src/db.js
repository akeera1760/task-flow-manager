import mongoose from "mongoose";

let connectionPromise = null;

export async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error("MONGO_URI is required");
    }

    connectionPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000
    });
  }

  await connectionPromise;

  console.log("MongoDB Connected");

  return mongoose.connection;
}