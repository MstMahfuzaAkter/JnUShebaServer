const express = require("express");
const cors = require("cors");
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const SSLCommerzPayment = require("sslcommerz-lts");

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
app.use(express.urlencoded({ extended: true })); // ✅ REQUIRED: SSLCommerz posts form-urlencoded data

// ================= HTTP + SOCKET.IO SERVER =================
const server = http.createServer(app); // ✅ wrap express with http server so socket.io can attach to it
const io = new Server(server, {
  cors: { origin: "*" },
});

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

// ================= SSLCOMMERZ CONFIG =================
const store_id = process.env.SSLC_STORE_ID;
const store_passwd = process.env.SSLC_STORE_PASSWD;
const is_live = process.env.SSLC_IS_LIVE === "true"; // false = sandbox, true = live
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
// ================= COLLECTIONS =================
let usersCollection;
let servicesCollection;
let bookingsCollection;
let chatsCollection;
let reviewsCollection;
let paymentsCollection; // ✅ ADDED for SSLCommerz transactions


// ================= CONNECT DB =================
async function connectDB() {
  await client.connect();

  const db = client.db("shebatech");

  usersCollection = db.collection("users");
  servicesCollection = db.collection("services");
  bookingsCollection = db.collection("bookings");
  chatsCollection = db.collection("chats");
  reviewsCollection = db.collection("reviews");
  paymentsCollection = db.collection("payments"); // ✅ ADDED

  // 🛡️ ডুপ্লিকেট ট্রানজেকশন রোধ করতে payments কালেকশনে tran_id এর উপর ইউনিক ইনডেক্স নিশ্চিত করা
  await paymentsCollection.createIndex({ tran_id: 1 }, { unique: true });

  console.log("✅ MongoDB Connected & Unique Index Ensured on payments.tran_id");
}

// ================= AUTH HELPERS =================

// Accepts either a raw token ("xxx.yyy.zzz") or the conventional
// "Bearer xxx.yyy.zzz" format, so the frontend doesn't have to guess which
// one the backend expects.
const extractToken = (req) => {
  const header = req.headers.authorization;
  if (!header) return null;
  return header.startsWith("Bearer ") ? header.split(" ")[1] : header;
};

// ================= GENERIC AUTH VERIFY =================
// FIX: previously only an admin-only verifier existed, so any endpoint that
// just needed "is this a logged-in user" (like reading/saving their own
// settings) had no middleware to use. This verifies any valid token and
// attaches the decoded payload to req.user.
const verifyToken = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

// ================= ADMIN VERIFY =================
const verifyAdmin = (req, res, next) => {
  const token = extractToken(req);

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

// FIX: a logged-in user (or an admin) should be able to act on a given
// email's settings — anyone else shouldn't, even with a valid token.
const verifySelfOrAdmin = (req, res, next) => {
  const targetEmail = req.params.email?.toLowerCase();
  const requesterEmail = req.user?.email?.toLowerCase();

  if (req.user?.role === "admin" || requesterEmail === targetEmail) {
    return next();
  }

  return res.status(403).send({ message: "Forbidden" });
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
    const email = user.email.trim().toLowerCase();

    const exist = await usersCollection.findOne({ email });
    if (exist) return res.status(409).send({ message: "User exists" });

    const newUser = {
      ...user,
      email,
      role: user.role || "student",
      isApproved: user.role === "provider" ? false : true,

      // Settings defaults — FIX: these fields used to only exist if the
      // client happened to send them; now every new user gets sane
      // defaults so profile/settings screens never render "undefined".
      themeMode: user.themeMode || "light",
      notificationEnabled:
        user.notificationEnabled !== undefined ? user.notificationEnabled : true,
      locationEnabled:
        user.locationEnabled !== undefined ? user.locationEnabled : true,

      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await usersCollection.findOne({ email: email?.trim().toLowerCase() });

    if (!user)
      return res.status(404).send({ success: false, message: "Not found" });

    if (user.password !== password)
      return res.status(401).send({ success: false, message: "Wrong pass" });

    // FIX: /login never actually issued a token before, so any
    // route protected by verifyToken/verifyAdmin was unreachable from the
    // app after login. Now a JWT is signed and returned alongside the user.
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role || "student" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: _pw, ...safeUser } = user;

    res.send({ success: true, user: safeUser, token });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

app.get("/users/:identifier", async (req, res) => {
  try {
    const identifier = req.params.identifier;
    let query = { email: identifier };

    // যদি প্যারামিটারটি একটি বৈধ MongoDB ObjectId হয়, তবে আইডি দিয়েও খুঁজবে
    if (ObjectId.isValid(identifier)) {
      query = { $or: [{ _id: new ObjectId(identifier) }, { email: identifier }] };
    }

    // FIX: this used to return the full document, including the raw
    // password field, straight to the client. Now it's excluded.
    const user = await usersCollection.findOne(query, { projection: { password: 0 } });
    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }
    res.send(user);
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

app.put("/users/:email", async (req, res) => {
  // FIX: this endpoint used to blindly $set whatever the client sent,
  // which meant anyone who could reach it could overwrite role,
  // isApproved, or even password. It's now restricted to profile-safe
  // fields; use /admin/user-role/:id for role changes and
  // /users/settings/:email for theme/notification/location.
  const { role, isApproved, password, email, _id, ...safeUpdates } = req.body;

  await usersCollection.updateOne(
    { email: req.params.email },
    { $set: { ...safeUpdates, updatedAt: new Date() } }
  );
  res.send({ success: true });
});

app.get("/users", async (req, res) => {
  const users = await usersCollection
    .find()
    .project({ password: 0 })
    .toArray();
  res.send(users);
});

app.patch("/admin/user-role/:id", async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ["student", "provider", "admin"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).send({ success: false });
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          role,
          isApproved: role === "provider" ? false : true,
          updatedAt: new Date(),
        },
      }
    );

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

// =====================================================
// ================= USER SETTINGS =====================
// =====================================================
// New: dedicated, whitelisted settings endpoints so theme/notification/
// location preferences persist in the database (survive app reinstall +
// re-login) without exposing the generic /users/:email update route to
// arbitrary field injection.

app.get("/users/settings/:email", verifyToken, verifySelfOrAdmin, async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();

    const user = await usersCollection.findOne(
      { email },
      {
        projection: {
          name: 1,
          email: 1,
          themeMode: 1,
          notificationEnabled: 1,
          locationEnabled: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    res.status(200).send({
      success: true,
      name: user.name,
      email: user.email,
      themeMode: user.themeMode || "light",
      notificationEnabled:
        user.notificationEnabled !== undefined ? user.notificationEnabled : true,
      locationEnabled:
        user.locationEnabled !== undefined ? user.locationEnabled : true,
    });
  } catch (err) {
    res.status(500).send({ success: false, message: err.message });
  }
});

app.put("/users/settings/:email", verifyToken, verifySelfOrAdmin, async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const { themeMode, notificationEnabled, locationEnabled } = req.body;

    const allowedThemes = ["light", "dark"];
    if (themeMode !== undefined && !allowedThemes.includes(themeMode)) {
      return res.status(400).send({ success: false, message: "Invalid themeMode" });
    }

    const updates = {
      ...(themeMode !== undefined && { themeMode }),
      ...(notificationEnabled !== undefined && { notificationEnabled: Boolean(notificationEnabled) }),
      ...(locationEnabled !== undefined && { locationEnabled: Boolean(locationEnabled) }),
      updatedAt: new Date(),
    };

    const updatedUser = await usersCollection.findOneAndUpdate(
      { email },
      { $set: updates },
      {
        returnDocument: "after",
        projection: {
          name: 1,
          email: 1,
          themeMode: 1,
          notificationEnabled: 1,
          locationEnabled: 1,
        },
      }
    );

    if (!updatedUser) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    res.status(200).send({
      success: true,
      message: "Settings updated successfully",
      settings: {
        themeMode: updatedUser.themeMode,
        notificationEnabled: updatedUser.notificationEnabled,
        locationEnabled: updatedUser.locationEnabled,
      },
    });
  } catch (err) {
    res.status(500).send({ success: false, message: err.message });
  }
});

// =====================================================
// ================= SERVICES ==========================
// =====================================================

app.post("/services", async (req, res) => {
  try {
    const service = req.body;

    const provider = await usersCollection.findOne({
      email: service.providerEmail,
    });

    if (provider && provider.role === "provider" && !provider.isApproved) {
      return res.status(403).send({
        success: false,
        message: "Provider not approved",
      });
    }

    const newService = {
      // Basic Information
      title: service.title,
      description: service.description,
      category: service.category,
      subCategory: service.subCategory || "",

      // Pricing
      price: Number(service.price),
      priceType: service.priceType || "fixed", // fixed | hourly | starting

      // Images
      image: service.image || "",
      gallery: service.gallery || [],

      // Provider Information
      providerId: service.providerId,
      providerName: service.providerName,
      providerEmail: service.providerEmail,
      phone: service.phone || "",
      profileImage: service.profileImage || "",

      // Location
      location: service.location,
      district: service.district || "",
      area: service.area || "",
      address: service.address || "",

      // Rating
      rating: 0,
      totalReviews: 0,
      totalBookings: 0,

      // Availability
      availability: "available", // available | busy | offline
      workingDays: service.workingDays || [
        "Saturday",
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
      ],
      startTime: service.startTime || "09:00",
      endTime: service.endTime || "18:00",

      // Service Details
      experience: Number(service.experience) || 0, // years
      serviceDuration: service.serviceDuration || "1 Hour",
      warranty: service.warranty || "No Warranty",

      // Verification
      verified: false,
      featured: false,

      // Status
      status: "active",

      // SEO / Search
      tags: service.tags || [],

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);

    res.send({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ success: false, message: err.message });
  }
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
// ================= PROVIDER AVAILABILITY API =================
app.patch("/provider/availability/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { availability } = req.body; // "available" | "busy" | "offline" (অথবা boolean true/false)

    const updatedService = await servicesCollection.updateMany(
      { providerEmail: email },
      { $set: { availability: availability } }
    );

    res.status(200).json({
      success: true,
      message: "Availability updated successfully",
      data: updatedService,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= PROVIDER EARNINGS API =================
app.get("/provider/earnings/:email", async (req, res) => {
  try {
    const { email } = req.params;

    // প্রোভাইডারের সব সার্ভিসগুলোর আইডি বের করা
    const providerServices = await servicesCollection.find({ providerEmail: email }).toArray();
    const serviceIds = providerServices.map(s => s._id.toString());

    // প্রোভাইডারের সার্ভিসগুলোর বুকিং খুঁজে বের করা
    const bookings = await bookingsCollection.find({ serviceId: { $in: serviceIds } }).toArray();

    // টোটাল আর্নিংস এবং পেইড/আনপেইড হিস্ট্রি ক্যালকুলেশন
    const totalEarnings = bookings
      .filter(b => b.paymentStatus === "paid")
      .reduce((sum, b) => sum + (Number(b.price) || 0), 0);

    const pendingEarnings = bookings
      .filter(b => b.paymentStatus !== "paid")
      .reduce((sum, b) => sum + (Number(b.price) || 0), 0);

    res.status(200).json({
      success: true,
      totalEarnings,
      pendingEarnings,
      totalBookings: bookings.length,
      bookings,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// =====================================================
// ================= BOOKINGS ==========================
// =====================================================

app.post("/bookings", async (req, res) => {
  try {
    const booking = req.body;

    const newBooking = {
      serviceId: booking.serviceId,
      serviceTitle: booking.serviceTitle,
      category: booking.category,
      serviceImage: booking.serviceImage || "",
      price: Number(booking.price),

      customerId: booking.customerId,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail || booking.userEmail,
      customerPhone: booking.customerPhone || booking.phone,

      providerId: booking.providerId,
      providerName: booking.providerName,
      providerEmail: booking.providerEmail,
      providerPhone: booking.providerPhone,

      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      address: booking.address,
      location: booking.location,
      note: booking.note || "",

      paymentMethod: booking.paymentMethod || "Cash",
      paymentStatus: "unpaid",
      refundStatus: "none",

      status: "pending",

      serviceCharge: Number(booking.price),
      bookingFee: booking.bookingFee || 0,
      discount: booking.discount || 0,
      totalAmount: Number(booking.price),

      isReviewed: false,

      cancelledBy: "",
      cancelReason: "",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);

    res.send({
      success: true,
      insertedId: result.insertedId,
    });

  } catch (err) {
    res.status(500).send({
      success: false,
      message: err.message,
    });
  }
});

app.get("/bookings/user/:email", async (req, res) => {
  const email = req.params.email;
  const data = await bookingsCollection
    .find({ $or: [{ customerEmail: email }, { userEmail: email }] })
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

// ================= REAL-TIME BOOKING TRACKING STATUS UPDATE =================
app.patch("/bookings/status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "pending",
      "accepted",
      "on_the_way",
      "ongoing",
      "completed",
      "cancelled",
      "rejected"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const updatedBooking = await bookingsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!updatedBooking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    // 🔥 Socket.io এর মাধ্যমে নির্দিষ্ট বুকিং রুমে বা ইউজারের কাছে লাইভ স্ট্যাটাস ব্রডকাস্ট করা
    io.to(id).emit("booking_status_updated", {
      bookingId: id,
      status: status,
    });

    res.status(200).json({
      success: true,
      message: "Booking status updated successfully",
      booking: updatedBooking,
    });
  } catch (err) {
    console.log("Status Update Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.patch("/bookings/:id", async (req, res) => {
  const { status } = req.body;
  const allowed = ["pending", "accepted", "ongoing", "completed", "cancelled", "rejected"];

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

app.patch("/bookings/cancel/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).send({
        success: false,
        message: "Booking not found",
      });
    }

    const bookingEmail = booking.customerEmail || booking.userEmail;
    if (bookingEmail?.toLowerCase() !== email?.toLowerCase()) {
      return res.status(403).send({
        success: false,
        message: "You cannot delete this booking",
      });
    }

    if (booking.status === "pending") {
      await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

      return res.send({
        success: true,
        message: "Booking cancelled and deleted successfully.",
      });
    } else {
      return res.status(400).send({
        success: false,
        message: "Service accepted. Cancellation is not allowed.",
      });
    }
  } catch (err) {
    console.log("Backend Delete Error:", err);
    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});

app.delete("/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).send({
        success: false,
        message: "Booking not found",
      });
    }

    if (booking.customerEmail !== email && booking.userEmail !== email) {
      return res.status(403).send({
        success: false,
        message: "You cannot delete this booking",
      });
    }

    await bookingsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Booking deleted successfully",
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Server error",
    });
  }
});
// =====================================================
// ================= REVIEWS ===========================
// =====================================================

// Shared helper: recompute a service's rating/totalReviews from whatever
// is currently in its embedded `reviews` array, rounded to 1 decimal so the
// UI never has to deal with long floating-point tails. Used by both the
// add-review and delete-review endpoints so they can never drift apart.
async function recalculateServiceRating(serviceId) {
  const service = await servicesCollection.findOne({
    _id: new ObjectId(serviceId),
  });

  if (!service) return null;

  const reviews = service.reviews || [];
  const totalReviews = reviews.length;
  const avgRating = totalReviews
    ? Number((reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / totalReviews).toFixed(1))
    : 0;

  await servicesCollection.updateOne(
    { _id: new ObjectId(serviceId) },
    { $set: { rating: avgRating, totalReviews } }
  );

  return { rating: avgRating, totalReviews };
}

app.post("/reviews", async (req, res) => {
  try {
    const review = req.body;

    // ---- Basic validation (FIX: previously nothing was validated, so a
    // missing/invalid serviceId or an out-of-range rating could either
    // crash the request or silently store bad data). ----
    if (!review.serviceId || !ObjectId.isValid(review.serviceId)) {
      return res.status(400).send({ success: false, message: "Valid serviceId is required" });
    }

    const ratingNum = Number(review.rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).send({ success: false, message: "Rating must be between 1 and 5" });
    }

    if (!review.comment || !review.comment.trim()) {
      return res.status(400).send({ success: false, message: "Comment is required" });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(review.serviceId),
    });

    if (!service) {
      return res.status(404).send({ success: false, message: "Service not found" });
    }

    // ---- Prevent duplicate reviews on the same booking (FIX: bookings
    // already track `isReviewed`, but nothing ever set it, so a student
    // could review the same booking repeatedly). ----
    let booking = null;
    if (review.bookingId && ObjectId.isValid(review.bookingId)) {
      booking = await bookingsCollection.findOne({ _id: new ObjectId(review.bookingId) });

      if (booking?.isReviewed) {
        return res.status(409).send({ success: false, message: "This booking has already been reviewed" });
      }
    }

    const userEmail = review.userEmail || review.customerEmail;

    // FIX: providerEmail used to come straight from whatever the client
    // sent (or nothing at all), so GET /reviews/:providerEmail was
    // unreliable. It's now always taken from the service document itself,
    // which is the single source of truth for who owns this service.
    const providerEmail = service.providerEmail;

    const reviewDoc = {
      serviceId: review.serviceId,
      bookingId: review.bookingId || null,
      providerEmail,
      userEmail,
      rating: ratingNum,
      comment: review.comment.trim(),
      createdAt: new Date(),
    };

    const result = await reviewsCollection.insertOne(reviewDoc);

    await servicesCollection.updateOne(
      { _id: new ObjectId(review.serviceId) },
      {
        $push: {
          reviews: {
            _id: result.insertedId,
            userEmail,
            rating: ratingNum,
            comment: reviewDoc.comment,
            createdAt: reviewDoc.createdAt,
          },
        },
      }
    );

    const { rating, totalReviews } = await recalculateServiceRating(review.serviceId);

    if (booking) {
      await bookingsCollection.updateOne(
        { _id: booking._id },
        { $set: { isReviewed: true, updatedAt: new Date() } }
      );
    }

    res.send({
      success: true,
      insertedId: result.insertedId,
      rating,
      totalReviews,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({
      success: false,
      message: "Review failed",
    });
  }
});

app.get("/reviews/:providerEmail", async (req, res) => {
  try {
    const email = req.params.providerEmail;

    const data = await reviewsCollection
      .find({ providerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(data);
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "Failed to load reviews",
    });
  }
});

// New: deleting a review used to leave the service's rating/totalReviews
// stale forever, since nothing recalculated them afterward.
app.delete("/reviews/:id", verifyToken, async (req, res) => {
  try {
    const reviewId = req.params.id;
    if (!ObjectId.isValid(reviewId)) {
      return res.status(400).send({ success: false, message: "Invalid review id" });
    }

    const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });
    if (!review) {
      return res.status(404).send({ success: false, message: "Review not found" });
    }

    // Only the review author or an admin can remove it.
    const isOwner = review.userEmail?.toLowerCase() === req.user?.email?.toLowerCase();
    if (!isOwner && req.user?.role !== "admin") {
      return res.status(403).send({ success: false, message: "Forbidden" });
    }

    await reviewsCollection.deleteOne({ _id: new ObjectId(reviewId) });

    await servicesCollection.updateOne(
      { _id: new ObjectId(review.serviceId) },
      { $pull: { reviews: { _id: new ObjectId(reviewId) } } }
    );

    const { rating, totalReviews } = await recalculateServiceRating(review.serviceId);

    if (review.bookingId && ObjectId.isValid(review.bookingId)) {
      await bookingsCollection.updateOne(
        { _id: new ObjectId(review.bookingId) },
        { $set: { isReviewed: false, updatedAt: new Date() } }
      );
    }

    res.send({ success: true, rating, totalReviews });
  } catch (err) {
    console.log(err);
    res.status(500).send({ success: false, message: "Failed to delete review" });
  }
});

// =====================================================
// ================= ADMIN =============================
// =====================================================

app.get("/admin-stats", async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalStudents = await usersCollection.countDocuments({ role: "student" });
    const totalProviders = await usersCollection.countDocuments({ role: "provider" });
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

app.get("/admin/providers/pending", async (req, res) => {
  try {
    const data = await usersCollection
      .find({ role: "provider", isApproved: false })
      .project({ password: 0 })
      .toArray();

    res.send(data);
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

app.patch("/admin/provider/:id", async (req, res) => {
  try {
    const { action } = req.body;

    if (action === "approve") {
      await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { isApproved: true } }
      );
    }

    if (action === "reject") {
      await usersCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
    }

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

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
// ================= CHAT (HTTP HISTORY) ================
// =====================================================
// Send / Save Chat Message
app.post("/chat", async (req, res) => {
  try {
    const { serviceId, senderEmail, receiverEmail, text, clientEmail } = req.body;

    const result = await chatsCollection.insertOne({
      serviceId,
      senderEmail,
      receiverEmail,
      clientEmail, // কোন ক্লায়েন্টের সাথে চ্যাট তা ট্র্যাক করার জন্য
      text,
      createdAt: new Date(),
    });

    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false });
  }
});

// Get Messages for a specific service and user pair
app.get("/chat/:id", async (req, res) => {
  try {
    const { id: serviceId } = req.params;
    const { clientEmail } = req.query; // Query parameter থেকে ক্লায়েন্টের ইমেইল নেওয়া

    let query = { serviceId };
    
    // যদি নির্দিষ্ট ক্লায়েন্ট ইমেইল পাস করা হয়, তবে শুধু তার এবং প্রোভাইডারের চ্যাট দেখাবে
    if (clientEmail) {
      query.$or = [
        { clientEmail: clientEmail },
        { senderEmail: clientEmail },
        { receiverEmail: clientEmail }
      ];
    }

    const messages = await chatsCollection
      .find(query)
      .sort({ createdAt: 1 })
      .toArray();

    res.send(messages);
  } catch (err) {
    res.status(500).send({ success: false });
  }
});
// =====================================================
// ================= SOCKET.IO REAL-TIME CHAT ==========
// =====================================================

io.on("connection", (socket) => {
  console.log("🔌 socket connected:", socket.id);

  socket.on("join_room", (serviceId) => {
    socket.join(serviceId);
  });

  socket.on("send_message", async (data) => {
    try {
      const message = {
        ...data,
        createdAt: new Date(),
      };

      const result = await chatsCollection.insertOne(message);

      io.to(data.serviceId).emit("receive_message", {
        ...message,
        _id: result.insertedId,
      });
    } catch (err) {
      console.log("send_message error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ socket disconnected:", socket.id);
  });
});

// =====================================================
// ================= SSLCOMMERZ PAYMENT ================
// =====================================================
app.post("/payment/init", async (req, res) => {
  try {
    const { bookingId, amount, customerName, customerEmail, customerPhone, frontendUrl } = req.body;

    if (!bookingId || !amount) {
      return res.status(400).send({ success: false, message: "bookingId and amount required" });
    }

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) {
      return res.status(404).send({ success: false, message: "Booking not found" });
    }

    // চেক করুন এই বুকিংয়ের বিপরীতে অলরেডি কোনো সফল পেমেন্ট আছে কি না
    const existingPaidPayment = await paymentsCollection.findOne({ 
      bookingId: new ObjectId(bookingId), 
      status: "paid" 
    });

    if (existingPaidPayment) {
      return res.status(400).send({ 
        success: false, 
        message: "This booking is already paid!" 
      });
    }

    const tran_id = uuidv4();
    const clientRedirectUrl = frontendUrl || BACKEND_URL;

    const data = {
      total_amount: Number(amount),
      currency: "BDT",
      tran_id,
      success_url: `${BACKEND_URL}/payment/success?clientUrl=${encodeURIComponent(clientRedirectUrl)}&bookingId=${bookingId}`,
      fail_url: `${BACKEND_URL}/payment/fail?clientUrl=${encodeURIComponent(clientRedirectUrl)}&bookingId=${bookingId}`,
      cancel_url: `${BACKEND_URL}/payment/cancel?clientUrl=${encodeURIComponent(clientRedirectUrl)}&bookingId=${bookingId}`,
      ipn_url: `${BACKEND_URL}/payment/ipn`,
      shipping_method: "N/A",
      product_name: booking?.serviceTitle || "ShebaTech Service",
      product_category: "Service",
      product_profile: "general",
      cus_name: customerName || booking?.customerName || "Customer",
      cus_email: customerEmail || booking?.customerEmail || booking?.userEmail || "test@gmail.com",
      cus_add1: booking?.address || "Dhaka",
      cus_city: "Dhaka",
      cus_state: "Dhaka",
      cus_postcode: "1000",
      cus_country: "Bangladesh",
      cus_phone: customerPhone || booking?.customerPhone || "01700000000",
      ship_name: customerName || booking?.customerName || "Customer",
      ship_add1: "Dhaka",
      ship_city: "Dhaka",
      ship_state: "Dhaka",
      ship_postcode: "1000",
      ship_country: "Bangladesh",
    };

    // ডাটাবেজে পেন্ডিং পেমেন্ট সেভ করা (Unique Index এর কারণে ডুপ্লিকেট হওয়ার সুযোগ নেই)
    await paymentsCollection.insertOne({
      tran_id,
      bookingId: new ObjectId(bookingId),
      userEmail: booking?.customerEmail || booking?.userEmail,
      amount: Number(amount),
      status: "pending",
      createdAt: new Date(),
    });

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const apiResponse = await sslcz.init(data);

    if (!apiResponse?.GatewayPageURL) {
      return res.status(500).send({ success: false, message: "Failed to init SSLCommerz session" });
    }

    res.send({ success: true, url: apiResponse.GatewayPageURL, tran_id });
  } catch (err) {
    console.log("payment/init error:", err);
    res.status(500).send({ success: false, message: "Payment init failed" });
  }
});

// =====================================================
// 2. PAYMENT SUCCESS (ডাবল ভ্যালিডেশন রোধ সহ)
// =====================================================
app.post("/payment/success", async (req, res) => {
  try {
    const { tran_id, val_id } = req.body;
    const { clientUrl, bookingId } = req.query;

    const payment = await paymentsCollection.findOne({ tran_id });
    if (!payment) {
      return res.redirect(`${clientUrl || BACKEND_URL}/payment/result-page?status=fail`);
    }

    // যদি পেমেন্ট ইতিমধ্যে সফল বা পেইড হয়ে থাকে, তবে সরাসরি রিডাইরেক্ট করুন
    if (payment.status === "paid") {
      return res.redirect(`${clientUrl}/payment/result-page?status=success&bookingId=${payment.bookingId}`);
    }

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const validation = await sslcz.validate({ val_id });

    const isValid = validation?.status === "VALID" || validation?.status === "VALIDATED";

    if (isValid) {
      await paymentsCollection.updateOne(
        { tran_id, status: { $ne: "paid" } },
        { $set: { status: "paid", validatedAt: new Date(), rawValidation: validation } }
      );

      await bookingsCollection.updateOne(
        { _id: payment.bookingId },
        { $set: { paymentStatus: "paid", updatedAt: new Date() } }
      );

      return res.redirect(`${clientUrl}/payment/result-page?status=success&bookingId=${payment.bookingId}`);
    }

    return res.redirect(`${clientUrl || BACKEND_URL}/payment/result-page?status=fail`);
  } catch (err) {
    console.log("payment/success error:", err);
    const { clientUrl } = req.query;
    return res.redirect(`${clientUrl || BACKEND_URL}/payment/result-page?status=fail`);
  }
});

// =====================================================
// 3. PAYMENT FAIL & CANCEL
// =====================================================
app.post("/payment/fail", async (req, res) => {
  const { clientUrl } = req.query;
  try {
    const { tran_id } = req.body;
    await paymentsCollection.updateOne(
      { tran_id, status: "pending" },
      { $set: { status: "failed", updatedAt: new Date() } }
    );
  } catch (err) {
    console.log("payment/fail error:", err);
  }
  res.redirect(`${clientUrl || BACKEND_URL}/payment/result-page?status=fail`);
});

app.post("/payment/cancel", async (req, res) => {
  const { clientUrl } = req.query;
  try {
    const { tran_id } = req.body;
    await paymentsCollection.updateOne(
      { tran_id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
  } catch (err) {
    console.log("payment/cancel error:", err);
  }
  res.redirect(`${clientUrl || BACKEND_URL}/payment/result-page?status=cancel`);
});

// =====================================================
// 4. IPN (Instant Payment Notification)
// =====================================================
app.post("/payment/ipn", async (req, res) => {
  try {
    const { tran_id, val_id, status } = req.body;

    if (status === "VALID") {
      const payment = await paymentsCollection.findOne({ tran_id });
      if (payment && payment.status !== "paid") {
        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        const validation = await sslcz.validate({ val_id });

        if (validation?.status === "VALID" || validation?.status === "VALIDATED") {
          await paymentsCollection.updateOne(
            { tran_id },
            { $set: { status: "paid", ipnValidatedAt: new Date() } }
          );
          await bookingsCollection.updateOne(
            { _id: payment.bookingId },
            { $set: { paymentStatus: "paid", updatedAt: new Date() } }
          );
        }
      }
    }

    res.status(200).send("IPN received");
  } catch (err) {
    console.log("payment/ipn error:", err);
    res.status(200).send("IPN error handled");
  }
});

// =====================================================
// 5. RESULT PAGE & STATUS
// =====================================================
app.get("/payment/result-page", (req, res) => {
  const { status, bookingId } = req.query;
  res.send(`
    <html>
      <body style="font-family: sans-serif; text-align:center; padding-top: 60px;">
        <h2>${status === "success" ? "✅ Payment Successful" : status === "cancel" ? "⚠️ Payment Cancelled" : "❌ Payment Failed"}</h2>
        <p id="msg">This tab will try to close automatically. If it doesn't, you can close it yourself.</p>
        <button id="closeBtn" style="margin-top:16px;padding:10px 20px;font-size:15px;border-radius:8px;border:none;background:#2563eb;color:#fff;">
          Close this tab
        </button>
        <script>
          try {
            if (window.opener) {
              window.opener.postMessage(
                { type: "payment-result", status: "${status}", bookingId: "${bookingId || ""}" },
                "*"
              );
            }
          } catch (e) {}

          function tryClose() {
            try { window.close(); } catch (e) {}
          }
          setTimeout(tryClose, 800);

          document.getElementById("closeBtn").addEventListener("click", function () {
            tryClose();
            document.getElementById("msg").textContent = "You can close this tab manually now.";
          });
        </script>
      </body>
    </html>
  `);
});

app.get("/payment/status/:tran_id", async (req, res) => {
  try {
    const payment = await paymentsCollection.findOne({ tran_id: req.params.tran_id });
    if (!payment) return res.status(404).send({ success: false, message: "Not found" });
    res.send({ success: true, status: payment.status, bookingId: payment.bookingId });
  } catch (err) {
    console.log("payment/status error:", err);
    res.status(500).send({ success: false, message: "Server error" });
  }
});

// =====================================================
// 6. TRANSACTION HISTORIES (Admin, Provider, User)
// =====================================================
app.get("/admin/transactions", async (req, res) => {
  try {
    const transactions = await paymentsCollection.find().sort({ createdAt: -1 }).toArray();
    res.send({ success: true, transactions });
  } catch (err) {
    res.status(500).send({ success: false, message: "Failed to load admin transactions" });
  }
});

app.get("/provider/transactions/:email", async (req, res) => {
  try {
    const providerEmail = req.params.email;
    const bookings = await bookingsCollection.find({ providerEmail: providerEmail }).toArray();
    const bookingIds = bookings.map((b) => b._id);

    const transactions = await paymentsCollection
      .find({ bookingId: { $in: bookingIds } })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ success: true, transactions });
  } catch (err) {
    res.status(500).send({ success: false, message: "Failed to load provider transactions" });
  }
});

app.get("/user/transactions/:email", async (req, res) => {
  try {
    const userEmail = req.params.email;
    const transactions = await paymentsCollection.find({ userEmail: userEmail }).sort({ createdAt: -1 }).toArray();
    res.send({ success: true, transactions });
  } catch (err) {
    res.status(500).send({ success: false, message: "Failed to load user transactions" });
  }
});
// =====================================================
// ================= START SERVER ======================
// =====================================================

async function start() {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

start();