import fastifyCors from "@fastify/cors";
import AutoLoad from "@fastify/autoload";
import Fastify from "fastify";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MONGODB_URL } from "./configs/index.js";
import FastifyMongoDB from "@fastify/mongodb";
import "dotenv/config";
import fastifyMultipart from "@fastify/multipart";
import fastifyJwt from "@fastify/jwt";
import { customIdGenerator } from "./utils/idGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "::";

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
  database: "resQ",
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
  if (request.startTime) {
    const [seconds, nanoseconds] = process.hrtime(request.startTime);
    const responseTimeMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(2);

    const { url, headers } = request;
    const urlPath = new URL(url, `http://${headers.host}`).pathname;
    const formattedPath = urlPath.split("/").filter(Boolean).join(" → ");

    const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;
    const status = isSuccess ? "pass" : "fail";

    const apiMetric = {
      _id: customIdGenerator("API"),
      method: request.method,
      endpointName: urlPath,
      timeRequired: [parseFloat(responseTimeMs)],
      statusCode: reply.statusCode,
      calledAt: new Date(),
      status,
      uid: request?.uid,
      count: 1, 
    };

    try {
      const apiMetrics = await fastify.mongo.db
        .collection("apiMetrics")
        .updateOne(
          { endpointName: urlPath, statusCode: reply.statusCode },
          {
            $inc: { count: 1 },
            $push: { timeRequired: parseFloat(responseTimeMs) },
          }
        );

      if (apiMetrics.modifiedCount === 0) {
        await fastify.mongo.db.collection("apiMetrics").insertOne(apiMetric);
      }

      console.log(JSON.stringify(apiMetric, null, 2));

      if (
        endpointName.includes([
          "disaster",
          "camp",
          "collectionPoint",
          "user",
          "report",
        ])
      ) {
        await fastify.mongo.db.collection("report").insertOne({
          _id: customIdGenerator("RPT"),
          uid: request?.uid,
          log: reply.sent,
          endpointName: urlPath,
          calledAt: new Date(),
        });
      }
    } catch (error) {
      console.error("Error logging API metrics:", error);
    }
  }
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
