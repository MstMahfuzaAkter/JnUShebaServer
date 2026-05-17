const express = require("express");
const cors = require("cors");
require("dotenv").config();

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
} = require("mongodb");

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

// ================= CONNECT DATABASE =================
async function connectDB() {
  try {
    const db = client.db("shebatech");

    usersCollection = db.collection("users");
    servicesCollection = db.collection("services");
    bookingsCollection = db.collection("bookings");

    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.log("❌ DB Connection Error:", error);
  }
}

// =====================================================
// ===================== ROUTES ========================
// =====================================================

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 ShebaTech API Running");
});

// =====================================================
// ================= USER ROUTES =======================
// =====================================================

// ================= REGISTER =================
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    // validation
    if (
      !user.name ||
      !user.email ||
      !user.password ||
      !user.role
    ) {
      return res.status(400).send({
        success: false,
        message: "Missing required fields",
      });
    }

    // existing check
    const existingUser = await usersCollection.findOne({
      email: user.email,
    });

    if (existingUser) {
      return res.status(409).send({
        success: false,
        message: "User already exists",
      });
    }

    // create user
    const result = await usersCollection.insertOne({
      ...user,
      createdAt: new Date(),
    });

    // get inserted user
    const newUser = await usersCollection.findOne({
      _id: result.insertedId,
    });

    res.send({
      success: true,
      message: "Account created successfully",
      user: newUser,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // check email
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    // password check
    if (user.password !== password) {
      return res.status(401).send({
        success: false,
        message: "Incorrect password",
      });
    }

    res.send({
      success: true,
      message: "Login successful",
      user,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});

// ================= GET USER BY EMAIL =================
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const user = await usersCollection.findOne({
      email,
    });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    res.send(user);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});

// ================= UPDATE USER =================
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
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = await usersCollection.findOne({
      email,
    });

    res.send({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Update failed",
    });
  }
});

// =====================================================
// ================= SERVICE ROUTES ====================
// =====================================================

// ================= ADD SERVICE =================
app.post("/services", async (req, res) => {
  try {
    const service = req.body;

    if (!service.title || !service.providerEmail || !service.price) {
      return res.status(400).send({
        success: false,
        message: "Missing required fields",
      });
    }

    const newService = {
      title: service.title,
      price: Number(service.price),
      description: service.description || "",
      category: service.category || "general",
      location: service.location || "",
      providerEmail: service.providerEmail,
      providerName: service.providerName || "",
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);

    res.send({
      success: true,
      message: "Service added successfully",
      serviceId: result.insertedId,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({ success: false, message: "Server error" });
  }
});
// ================= UPDATE SERVICE =================
app.put("/services/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updated = req.body;

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...updated,
          price: Number(updated.price),
          updatedAt: new Date(),
        },
      }
    );

    res.send({
      success: true,
      message: "Service updated",
      result,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({ success: false });
  }
});
// ================= GET ALL SERVICES =================
app.get("/services", async (req, res) => {
  try {
    const services = await servicesCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(services);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch services",
    });
  }
});

// ================= GET PROVIDER SERVICES =================
app.get("/services/provider/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const services = await servicesCollection
      .find({
        providerEmail: email,
      })
      .toArray();

    res.send(services);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch provider services",
    });
  }
});

// ================= DELETE SERVICE =================
app.delete("/services/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Service deleted",
      result,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Delete failed",
    });
  }
});

// =====================================================
// ================= BOOKING ROUTES ====================
// =====================================================

// ================= CREATE BOOKING =================
app.post("/bookings", async (req, res) => {
  try {
    const booking = req.body;

    if (!booking.serviceId || !booking.userEmail || !booking.providerEmail) {
      return res.status(400).send({
        success: false,
        message: "Missing booking fields",
      });
    }

    const result = await bookingsCollection.insertOne({
      ...booking,
      status: "pending",
      createdAt: new Date(),
    });

    res.send({
      success: true,
      message: "Booking created",
      result,
    });

  } catch (error) {
    res.status(500).send({ success: false });
  }
});

// ================= GET USER BOOKINGS =================
app.get("/bookings/user/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const bookings = await bookingsCollection
      .find({
        userEmail: email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
});

// ================= PROVIDER BOOKINGS =================
app.get("/provider-bookings/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const bookings = await bookingsCollection
      .find({
        providerEmail: email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
});

// ================= UPDATE BOOKING STATUS =================
app.patch("/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const allowed = ["pending", "accepted", "rejected"];

    if (!allowed.includes(status)) {
      return res.status(400).send({
        success: false,
        message: "Invalid status",
      });
    }

    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Booking not found",
      });
    }

    res.send({
      success: true,
      message: `Booking ${status}`,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});
// =====================================================
// ================= ADMIN ROUTES ======================
// =====================================================
app.get("/admin/bookings", async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
});
// ================= ADMIN STATS =================
app.get("/admin-stats", async (req, res) => {
  try {
    const totalUsers =
      await usersCollection.countDocuments();

    const totalServices =
      await servicesCollection.countDocuments();

    const totalBookings =
      await bookingsCollection.countDocuments();

    const totalProviders =
      await usersCollection.countDocuments({
        role: "provider",
      });

    const totalStudents =
      await usersCollection.countDocuments({
        role: "student",
      });

    res.send({
      totalUsers,
      totalProviders,
      totalStudents,
      totalServices,
      totalBookings,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to load stats",
    });
  }
});

// ================= GET ALL USERS =================
app.get("/all-users", async (req, res) => {
  try {
    const users = await usersCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(users);
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

// =====================================================
// ================= START SERVER ======================
// =====================================================

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer();