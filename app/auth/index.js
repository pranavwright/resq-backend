/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { uploadProfileImage } from "../../utils/cloudStorage.js";
import { customIdGenerator } from "../../utils/idGenerator.js";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceAccount = path.join(__dirname, "../../service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const authRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isRegisterAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, [
          "superAdmin",
          "admin",
          "campAdmin",
          "stat",
          "kas",
          "collectionPointAdmin",
        ]),
    ],
  };
  fastify.post("/register", isRegisterAdmin, async (req, reply) => {
    try {
      const {
        role: roles,
        phoneNumber,
        name,
        disasterId,
        assignPlace,
        uid,
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
              ...(assignPlace && { assignPlace }),
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
            $set: { ...(assignPlace && { assignPlace }) },
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
          createdBy: uid,
        });
      }

      return reply.status(200).send({ message: "User created successfully" });
    } catch (error) {
      console.log("Error in Register Route", error);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/checkPhoneNumber", async (req, reply) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        reply.status(400).send({ message: "Phone number is required" });
      }
      const numberOnly = phoneNumber.slice(3, phoneNumber.length);
      const checkuser = await fastify.mongo.db
        .collection("users")
        .findOne(
          { phoneNumber: `${numberOnly}` },
          { projection: { phoneNumber: 1 } }
        );
      if (!checkuser) {
        reply.status(400).send({ message: "User not found" });
      }
      reply.status(200).send({ message: "User found", success: true });
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
      const numberOnly = decodedToken.phone_number.slice(
        3,
        decodedToken.phone_number.length
      );

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber: `${numberOnly}` });

      const jwtToken = fastify.jwt.sign({
        phoneNumber: decodedToken.phone_number,
        _id: user._id,
      });

      return reply.status(200).send({
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

  fastify.post("/otpSent", async (req, reply) => {
    try {
      const { timestamp, phoneNumber, verificationId } = req.body;

      await fastify.mongo.db.collection("opt").deleteone({ phoneNumber });
      await fastify.mongo.db.collection("otp").insertOne({
        _id: customIdGenerator("OTP"),
        timestamp: new Date(timestamp),
        phoneNumber,
        verificationId,
      });
      reply.sent("OTP sent successfully");
    } catch (error) {
      return reply
        .status(400)
        .send({ message: "Invalid Firebase Token", error });
    }
  });

  fastify.put("/updateUser", isAuthUser, async (req, reply) => {
    try {
      const { email: emailId, uid, photoUrl: file } = req.body;
      if (!file) {
        return reply.status(400).send({ message: "Image is required" });
      }
      if (!emailId) {
        reply
          .status(400)
          .send({ message: "Phone number and name is required" });
      }
      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid });
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }

      // Extract file extension from base64 data
      let fileExtension = "jpg"; // Default extension
      let fileData = file;

      if (typeof file === 'string' && file.startsWith("data:image/")) {
        const matches = file.match(/^data:image\/([a-zA-Z]+);base64,/);
        if (matches && matches.length > 1) {
          fileExtension = matches[1].toLowerCase();
          fileData = file.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
        }
      }

      // Generate unique filename with extension
      const fileName = `${uid}.${fileExtension}`;

      // Upload the image with proper filename
      const { success, message, url } = await uploadProfileImage(
        fileData,
        fileName
      );

      if (success) {
        await fastify.mongo.db
          .collection("users")
          .updateOne({ _id: uid }, { $set: { photoUrl: url, emailId } });
        reply.status(200).send({ message: "User updated successfully", photoUrl: url });
      } else {
        new Error("Failed to upload image");
      }
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getUser", isAuthUser, async (req, reply) => {
    try {
     const { uid } = req.query;
      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid });
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }
      return reply.status(200).send({ photoUrl: user.photoUrl, emailId: user.emailId, roles: user.roles , name: user.name});
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });

    }
  });
  done();
};
export default authRoute;
