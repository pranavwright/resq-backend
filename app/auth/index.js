/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";


const authRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isSuperAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["superAdmin"]),
    ],
  };
  fastify.post("/register", isSuperAdmin, async (req, reply) => {
    try {
      const {
        role: roles,
        phoneNumber,
        name,
        disasterId,
        assignPlace,
      } = req.body;

      let role = roles;
      if (!role || !phoneNumber || !name || !disasterId) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      if (!Array.isArray(role)) {
        role = [role];
      }

      const checkUser = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber, roles: { $in: role }, disasterId });

      if (checkUser) {
        return reply.status(400).send({ message: "User already exists" });
      }

      const checkDisaster = await fastify.mongo.db
        .collection("disasters")
        .findOne({ disasterId });

      if (!checkDisaster) {
        return reply.status(400).send({ message: "Disaster not found" });
      }

      const checkOldUser = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber, disasterId: { $ne: disasterId } });

      if (checkOldUser) {
        await fastify.mongo.db.collection("users").updateOne(
          { phoneNumber },
          {
            $set: {
              roles: role,
              disasterId,
              assignPlace,
            },
            $push: {
              pastRoles: {
                pastRoles: checkOldUser.roles,
                pastAssignedPlace: checkOldUser.assignPlace,
                pastDisasters: checkOldUser.disasterId,
              },
            },
          }
        );
        return reply.status(200).send({ message: "User updated successfully" });
      }

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber, disasterId });

      if (user) {
        await fastify.mongo.db.collection("users").updateOne(
          { phoneNumber, disasterId },
          {
            $addToSet: { roles: { $each: role } },
            $set: { assignPlace },
          }
        );
      } else {
        await fastify.mongo.db.collection("users").insertOne({
          _id: customIdGenerator("USR"),
          roles: role,
          phoneNumber,
          name,
          disasterId,
          assignPlace,
          pastRoles: [],
        });
      }

      return reply.status(200).send({ message: "User created successfully" });
    } catch (error) {
      console.log("Error in Register Route", error);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  fastify.post("/checkUser", async (req, reply) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        reply.status(400).send({ message: "Phone number is required" });
      }
      const checkuser = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber }, { projection: { phoneNumber: 1 } });
      if (!checkuser) {
        reply.status(400).send({ message: "User not found" });
      }
      reply.status(200).send({ message: "User found" });
    } catch (error) {
      console.log("Error In Login Route", error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  fastify.post("/verifyFirebaseToken", async (req, reply) => {
    try {
      const { firebaseToken } = req.body;
      const decodedToken = await admin.auth().verifyIdToken(firebaseToken);

      if (!decodedToken.uid || !decodedToken.phone_number) {
        return reply.status(400).send({ message: "Invalid Firebase Token" });
      }
      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber: decodedToken.phone_number });

      const jwtToken = fastify.jwt.sign({
        phoneNumber: decodedToken.phone_number,
        _id: user._id,
      });
      return reply.send({
        jwtToken,
        roles: user.roles,
        photoUrl: user.photoUrl,
      });
    } catch (error) {
      return reply
        .status(400)
        .send({ message: "Invalid Firebase Token", error });
    }
  });

  fastify.put("/updateUser", isAuthUser, async (req, reply) => {
    try {
      const { phoneNumber, name, photoUrl } = req.body;
      if (!phoneNumber || !name) {
        reply
          .status(400)
          .send({ message: "Phone number and name is required" });
      }
      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber });
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }
      await fastify.mongo.db
        .collection("users")
        .updateOne({ phoneNumber }, { $set: { name, photoUrl } });
      reply.status(200).send({ message: "User updated successfully" });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  done();
};
export default authRoute;
