/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware";
import { customIdGenerator } from "../../utils/idGenerator";

const disasterRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isSuperAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["superAdmin"]),
    ],
  };
  fastify.post("/disaster", isSuperAdmin, async (req, reply) => {
    try {
      const {
        _id,
        name,
        description,
        location,
        startDate,
        endDate=new Date(),
        status = "active",
        state,
        district,
        severity,
      } = req.body;
      if (_id) {
        await fastify.mongo.db
          .collection("disasters")
          .updateOne({ _id }, { $set: { endDate, status } });
      } else {
        if (
          !name ||
          !description ||
          !location ||
          !startDate ||
          !state ||
          !district ||
          !severity
        ) {
          return reply.status(400).send({ message: "All fields are required" });
        }
        await fastify.mongo.db.collection("disasters").insertOne({
          _id: customIdGenerator("DIST"),
          name,
          description,
          location,
          startDate,
          status: "active",
          state,
          district,
          severity,
        });
      }
      reply.status(200).send({ message: "Disaster created/updated" });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });
};
