const express = require("express");
const cors = require("cors");
require("dotenv").config();

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
} = require("mongodb");

const jwt = require("jsonwebtoken");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= PORT =================
const PORT = process.env.PORT || 5000;

// ================= MONGODB =================
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ================= COLLECTIONS =================
let usersCollection;
let servicesCollection;
let bookingsCollection;
let chatsCollection; // ✅ CHAT ADDED

// ================= CONNECT DB =================
async function connectDB() {
  const db = client.db("shebatech");

  usersCollection = db.collection("users");
  servicesCollection = db.collection("services");
  bookingsCollection = db.collection("bookings");
  chatsCollection = db.collection("chats"); // ✅ FIXED

  console.log("✅ MongoDB Connected");
}

// ================= ADMIN VERIFY =================
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).send({ message: "Forbidden" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 ShebaTech API Running");
});

// =====================================================
// ================= USER AUTH =========================
// =====================================================

app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const exist = await usersCollection.findOne({ email: user.email });
    if (exist) {
      return res.status(409).send({ success: false, message: "User exists" });
    }

    const result = await usersCollection.insertOne({
      ...user,
      createdAt: new Date(),
    });

    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await usersCollection.findOne({ email });

    if (!user)
      return res.status(404).send({ success: false, message: "Not found" });

    if (user.password !== password)
      return res.status(401).send({ success: false, message: "Wrong pass" });

    res.send({ success: true, user });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

app.get("/users/:email", async (req, res) => {
  const user = await usersCollection.findOne({ email: req.params.email });
  res.send(user);
});

app.put("/users/:email", async (req, res) => {
  await usersCollection.updateOne(
    { email: req.params.email },
    { $set: { ...req.body, updatedAt: new Date() } }
  );

  res.send({ success: true });
});

// =====================================================
// ================= SERVICES ==========================
// =====================================================

app.post("/services", async (req, res) => {
  const service = req.body;

  const newService = {
    title: service.title,
    description: service.description,
    price: Number(service.price),
    category: service.category,
    location: service.location,
    providerEmail: service.providerEmail,
    phone: service.phone,
    createdAt: new Date().toISOString(),
  };

  const result = await servicesCollection.insertOne(newService);

  res.send({
    success: true,
    insertedId: result.insertedId,
  });
});

app.get("/services", async (req, res) => {
  const data = await servicesCollection
    .find()
    .sort({ createdAt: -1 })
    .toArray();

  res.send(data);
});

app.get("/services/:id", async (req, res) => {
  try {
    const service = await servicesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!service) {
      return res.status(404).send({
        success: false,
        message: "Service not found",
      });
    }

    res.send(service);
  } catch (err) {
    res.status(500).send({ success: false });
  }
});
// ================= PROVIDER SERVICES =================
app.get("/services/provider/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const data = await servicesCollection
      .find({ providerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(data);
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Failed to load provider services",
    });
  }
});
app.put("/services/:id", async (req, res) => {
  await servicesCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { ...req.body, updatedAt: new Date() } }
  );

  res.send({ success: true });
});

app.delete("/services/:id", async (req, res) => {
  await servicesCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({ success: true });
});

// =====================================================
// ================= BOOKINGS ==========================
// =====================================================

app.post("/bookings", async (req, res) => {
  const booking = req.body;

  const result = await bookingsCollection.insertOne({
    ...booking,
    status: "pending",
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/bookings/user/:email", async (req, res) => {
  const data = await bookingsCollection
    .find({ userEmail: req.params.email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send(data);
});

app.get("/provider-bookings/:email", async (req, res) => {
  const data = await bookingsCollection
    .find({ providerEmail: req.params.email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send(data);
});

app.get("/bookings/:id", async (req, res) => {
  const data = await bookingsCollection.findOne({
    _id: new ObjectId(req.params.id),
  });

  res.send(data);
});

app.patch("/bookings/:id", async (req, res) => {
  const { status } = req.body;

  const allowed = ["pending", "accepted", "rejected"];

  if (!allowed.includes(status)) {
    return res.status(400).send({ success: false });
  }

  await bookingsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        status,
        updatedAt: new Date(),
      },
    }
  );

  res.send({ success: true });
});

app.delete("/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;

    // 🔥 booking find
    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    // booking not found
    if (!booking) {
      return res.status(404).send({
        success: false,
        message: "Booking not found",
      });
    }

    // 🔥 email check
    if (booking.userEmail !== email) {
      return res.status(403).send({
        success: false,
        message: "You cannot cancel this booking",
      });
    }

    // 🔥 delete booking
    const result = await bookingsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Booking cancelled successfully",
    });

  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});
// =====================================================
// ================= ADMIN =============================
// =====================================================

// ADMIN STATS
app.get("/admin-stats", async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();

    const totalStudents = await usersCollection.countDocuments({
      role: "student",
    });

    const totalProviders = await usersCollection.countDocuments({
      role: "provider",
    });

    const totalServices = await servicesCollection.countDocuments();

    const totalBookings = await bookingsCollection.countDocuments();

    res.send({
      totalUsers,
      totalStudents,
      totalProviders,
      totalServices,
      totalBookings,
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Failed to load admin stats",
    });
  }
});

// ALL BOOKINGS FOR ADMIN
app.get("/admin/bookings", async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Failed to load bookings",
    });
  }
});
// =====================================================
// ================= CHAT FIXED ========================
// =====================================================

// SEND MESSAGE
app.post("/chat", async (req, res) => {
  try {
    const msg = req.body;

    const result = await chatsCollection.insertOne({
      ...msg,
      createdAt: new Date(),
    });

    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

// GET MESSAGES
app.get("/chat/:id", async (req, res) => {
  try {
    const messages = await chatsCollection
      .find({ serviceId: req.params.id })
      .sort({ createdAt: 1 })
      .toArray();

    res.send(messages);
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

// =====================================================
// ================= START SERVER ======================
// =====================================================

async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

start();