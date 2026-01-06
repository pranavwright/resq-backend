import fastifyCors from "@fastify/cors";
import AutoLoad from "@fastify/autoload";
import Fastify from "fastify";
import { fileURLToPath } from "url";
import path, { dirname, join } from "path";
import { MONGODB_URL } from "./configs/index.js";
import FastifyMongoDB from "@fastify/mongodb";
import "dotenv/config";
import fastifyMultipart from "@fastify/multipart";
import fastifyJwt from "@fastify/jwt";
import { customIdGenerator } from "./utils/idGenerator.js";
import { cert, initializeApp } from "firebase-admin/app";
import { readFileSync, } from "fs";
import { getAuth } from "firebase-admin/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "::";


try {
  const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, "/service-account.json"), 'utf8'));
  const firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });
  const auth = getAuth(firebaseApp);


  // Set the credentials path for Google Cloud libraries
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, "/service-account.json");

  fastify.decorate('firebase', firebaseApp);
  fastify.decorate('firebaseAuth', auth);
  console.log('Firebase app initialized successfully.');
} catch (error) {
  console.error('Error initializing Firebase app:', error);
  process.exit(1);
}

fastify.register(fastifyMultipart, {
  limits: { fileSize: 150 * 1024 * 1024 },
  attachFieldsToBody: "keyValues",
});

fastify.register(AutoLoad, {
  dir: join(__dirname, "app"),
  routeParams: true,
});

fastify.register(fastifyCors, {
  origin: "*",
  methods: ['POST', 'PUT', 'DELETE', 'GET', 'PATCH'],
});

fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || "Secret",
  sign: {
    expiresIn: "30d",
  },
});

fastify.register(FastifyMongoDB, {
  forceClose: true,
  url: MONGODB_URL,
  database: process.env.DB_MODE != "DEV" ? process.env.MONGODB_DATABASE : "resQBackup",
});

fastify.addHook("onReady", async () => {
  await fastify.mongo.db.collection("collectionPoints").createIndex({ geoLocation: "2dsphere" });
  await fastify.mongo.db.collection("camps").createIndex({ geoLocation: "2dsphere" });
  await fastify.mongo.db.collection("disasters").createIndex({ geoLocation: "2dsphere" });
});

fastify.addHook("onError", (request, reply, error, done) => {
  console.log(error?.message || "Some error occurred");
  reply.status(500).send({ message: error?.message || "Some error occurred" });
  done();
});

fastify.addHook("onRequest", async (request, reply) => {
  request.startTime = process.hrtime();
});

fastify.addHook("onSend", async (request, reply, payload) => {
  logApi(request, reply);
});

const ENV = process.env.NODE_ENV || "development";

async function logApi(request, reply) {
  if (!request.startTime) return;

  const [seconds, nanoseconds] = process.hrtime(request.startTime);
  const responseTimeMs = (seconds * 1000 + nanoseconds / 1e6);

  // request.routeOptions.url gives the pattern (e.g., /users/:id) which is usually better for metrics than /users/123
  const endpointName = request.routeOptions?.url || request.routerPath || request.url;

  const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;
  const status = isSuccess ? "pass" : "fail";

  // 3. Construct the filter and update operations
  const filter = {
    endpointName,
    statusCode: reply.statusCode,
    env: ENV
  };

  const updateDoc = {
    $inc: { count: 1 },
    $push: { timeRequired: parseFloat(responseTimeMs.toFixed(2)) },
    $set: { calledAt: new Date() },
    $setOnInsert: {
      _id: customIdGenerator("API"),
      method: request.method,
      uid: request?.uid,
      firstCalledAt: new Date(),
      status
    }
  };

  // 4. Fire and forget (No await). 
  // This prevents DB latency from slowing down the user response.
  fastify.mongo.db.collection("apiMetrics")
    .updateOne(filter, updateDoc, { upsert: true })
    .catch(err => console.error("Error logging API metric:", err));

  // Optional: Only log to console in dev to save CPU in prod
  if (ENV === 'development') {
    console.log(`[API Log] ${request.method} ${endpointName} - ${reply.statusCode} (${responseTimeMs.toFixed(2)}ms)`);
  }
}

fastify.addHook("onError", (request, reply, error, done) => {
  console.error(error);
  reply
    .status(500)
    .send({ message: error?.message || "Internal Server Error" });
  done();
});

fastify.addHook("onClose", async (instance) => {
  await instance.mongo.client.close();
});

fastify
  .listen({ port: PORT, host: HOST })
  .then((address) => {
    console.log(`Server listening at ${address}`);
  })
  .catch((err) => {
    fastify.log.error(err);
    console.error(err);
    process.exit(1);
  });
