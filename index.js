const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= MONGO SETUP =================
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;

// ================= DB CONNECT =================
async function connectDB() {
  try {
    const db = client.db("shebatech");
    usersCollection = db.collection("users");
    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.error("DB Connection Error:", error);
  }
}

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("🚀 API Running Successfully");
});

// ================= REGISTER USER =================
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    if (!user.email || !user.name || !user.role) {
      return res.status(400).send({ message: "Missing required fields" });
    }

    const existingUser = await usersCollection.findOne({
      email: user.email,
    });

    if (existingUser) {
      return res.status(409).send({ message: "User already exists" });
    }

    const result = await usersCollection.insertOne(user);

    const newUser = await usersCollection.findOne({
      _id: result.insertedId,
    });

    res.send(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

// ================= LOGIN / GET USER =================
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Server error" });
  }
});

// ================= UPDATE PROFILE =================
app.put("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const updatedData = req.body;

    const result = await usersCollection.updateOne(
      { email },
      {
        $set: {
          ...updatedData,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    const updatedUser = await usersCollection.findOne({ email });

    res.send({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});

// ================= START SERVER =================
async function startServer() {
  await connectDB();

  const PORT = process.env.PORT || 5000;

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer();