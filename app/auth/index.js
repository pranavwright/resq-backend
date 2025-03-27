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
import { idCard } from "../../utils/pdfGenerator.js";

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

      const isAdmin = await fastify.mongo.db.collection("users").findOne({
        phoneNumber,
      });
      if (isAdmin && isAdmin.roles[0].roles.includes("superAdmin")) {
        return reply
          .status(400)
          .send({ message: "User can't be added as an admin" });
      }
      const existingUser = await fastify.mongo.db.collection("users").findOne({
        phoneNumber,
        "roles.disasterId": disasterId,
      });

      if (!existingUser) {
        const isUser = await fastify.mongo.db.collection("users").findOne({
          phoneNumber,
        });
        if (isUser) {
          await fastify.mongo.db.collection("users").updateOne(
            { _id: isUser._id, phoneNumber },
            {
              $push: {
                roles: {
                  disasterId,
                  roles: role,
                  assignPlace,
                },
              },
            }
          );
          if (assignPlace) {
            if (role.includes("campAdmin")) {
              await fastify.mongo.db.collection("camps").updateOne(
                { _id: assignPlace },
                {
                  $set: {
                    campAdmin: isUser._id,
                    contact: phoneNumber,
                  },
                }
              );
            } else if (role.includes("collectionPointAdmin")) {
              await fastify.mongo.db.collection("collectionPoints").updateOne(
                { _id: assignPlace },
                {
                  $set: {
                    collectionAdmin: isUser._id,
                    contact: phoneNumber,
                  },
                }
              );
            }
          }
        } else {
          await fastify.mongo.db.collection("users").insertOne({
            _id: customIdGenerator("USR"),
            name,
            phoneNumber,
            roles: [
              {
                disasterId,
                roles: role,
                assignPlace,
              },
            ],
            createdBy: uid,
          });
        }
        if (assignPlace) {
          if (role.includes("campAdmin")) {
            await fastify.mongo.db.collection("camps").updateOne(
              { _id: assignPlace },
              {
                $set: {
                  campAdmin: isUser._id,
                  contact: phoneNumber,
                },
              }
            );
          } else if (role.includes("collectionPointAdmin")) {
            await fastify.mongo.db.collection("collectionPoints").updateOne(
              { _id: assignPlace },
              {
                $set: {
                  collectionAdmin: isUser._id,
                  contact: phoneNumber,
                },
              }
            );
          }
        }
        return reply.status(200).send({ message: "User created successfully" });
      } else {
        const existingRole = existingUser.roles.find(
          (r) => r.disasterId === disasterId
        );
        if (existingRole) {
          const existingRoles = existingRole.roles.filter((r) =>
            role.includes(r)
          );
          if (existingRoles.length > 0) {
            return reply
              .status(400)
              .send({ message: "Role already exists for this disaster" });
          } else {
            await fastify.mongo.db.collection("users").updateOne(
              {
                phoneNumber,
                "roles.disasterId": disasterId,
              },
              {
                $push: { "roles.$.roles": { $each: role } },
                $set: { "roles.$.assignPlace": assignPlace },
              }
            );
            if (assignPlace) {
              if (role.includes("campAdmin")) {
                await fastify.mongo.db.collection("camps").updateOne(
                  { _id: assignPlace },
                  {
                    $set: {
                      campAdmin: isUser._id,
                      contact: phoneNumber,
                    },
                  }
                );
              } else if (role.includes("collectionPointAdmin")) {
                await fastify.mongo.db.collection("collectionPoints").updateOne(
                  { _id: assignPlace },
                  {
                    $set: {
                      collectionAdmin: isUser._id,
                      contact: phoneNumber,
                    },
                  }
                );
              }
            }
            return reply
              .status(200)
              .send({ message: "Role added successfully" });
          }
        } else {
          await fastify.mongo.db.collection("users").updateOne(
            {
              phoneNumber,
            },
            {
              $push: {
                roles: {
                  disasterId,
                  roles: role,
                  assignPlace,
                },
              },
            }
          );
          if (assignPlace) {
            if (role.includes("campAdmin")) {
              await fastify.mongo.db.collection("camps").updateOne(
                { _id: assignPlace },
                {
                  $set: {
                    campAdmin: isUser._id,
                    contact: phoneNumber,
                  },
                }
              );
            } else if (role.includes("collectionPointAdmin")) {
              await fastify.mongo.db.collection("collectionPoints").updateOne(
                { _id: assignPlace },
                {
                  $set: {
                    collectionAdmin: isUser._id,
                    contact: phoneNumber,
                  },
                }
              );
            }
          }
          return reply
            .status(200)
            .send({ message: "Disaster role added successfully" });
        }
      }
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
        return;
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
        return;
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

      await fastify.mongo.db.collection("otp").deleteOne({ phoneNumber });
      await fastify.mongo.db.collection("otp").insertOne({
        _id: customIdGenerator("OTP"),
        timestamp: new Date(timestamp),
        phoneNumber,
        verificationId,
      });
      reply.send({ message: "OTP sent successfully" });
    } catch (error) {
      return reply
        .status(400)
        .send({ message: "Invalid Firebase Token", error });
    }
  });

  fastify.put("/updateUser", isAuthUser, async (req, reply) => {
    try {
      const { email: emailId, uid, photoUrl: file, name } = req.body;

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid });
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }

      if (file) {
        // Extract file extension from base64 data
        let fileExtension = "jpg"; // Default extension
        let fileData = file;

        if (typeof file === "string" && file.startsWith("data:image/")) {
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
          await fastify.mongo.db.collection("users").updateOne(
            { _id: uid },
            {
              $set: {
                photoUrl: url,
                ...(emailId && { emailId }),
                ...(name & { name }),
              },
            }
          );
          reply
            .status(200)
            .send({ message: "User updated successfully", photoUrl: url });
        } else {
          return reply.status(500).send({ message: "Failed to upload image" });
        }
      } else {
        await fastify.mongo.db
          .collection("users")
          .updateOne(
            { _id: uid },
            { $set: { ...(emailId && { emailId }), ...(name & { name }) } }
          );
        reply
          .status(200)
          .send({ message: "User updated successfully", photoUrl: url });
      }
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  //to check user
  fastify.get("/getUser", isAuthUser, async (req, reply) => {
    try {
      const { uid } = req.query;
      const user = await fastify.mongo.db
        .collection("users")
        .aggregate([
          {
            $match: {
              _id: uid,
            },
          },
          {
            $unwind: "$roles",
          },
          {
            $lookup: {
              from: "disasters",
              localField: "roles.disasterId",
              foreignField: "_id",
              as: "disaster",
            },
          },
          {
            $unwind: {
              path: "$disaster",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $group: {
              _id: "$_id",
              name: { $first: "$name" },
              photoUrl: { $first: "$photoUrl" },
              emailId: { $first: "$emailId" },
              roles: {
                $push: {
                  disasterId: "$roles.disasterId",
                  roles: "$roles.roles",
                  assignPlace: "$roles.assignPlace",
                  disasterName: "$disaster.name",
                },
              },
            },
          },
        ])
        .toArray();

      if (!user || user.length === 0) {
        reply.status(400).send({ message: "User not found" });
        return;
      }

      reply.status(200).send({
        photoUrl: user[0].photoUrl,
        emailId: user[0].emailId,
        roles: user[0].roles,
        name: user[0].name,
      });
    } catch (error) {
      console.error("Error in getUser:", error); // Log the error
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getAdmins", isRegisterAdmin, async (req, reply) => {
    try {
      const { disasterId, uid } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "Disaster ID is required" });
      }
      const users = await fastify.mongo.db
        .collection("users")
        .aggregate([
          {
            $match: {
              "roles.disasterId": disasterId,
            },
          },
          {
            $unwind: {
              path: "$roles",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "collectionPoints",
              localField: "roles.assignPlace",
              foreignField: "_id",
              as: "collectionPoint",
            },
          },
          {
            $lookup: {
              from: "camps",
              localField: "roles.assignPlace",
              foreignField: "_id",
              as: "camp",
            },
          },
          {
            $unwind: {
              path: "$camp",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$collectionPoint",
              preserveNullAndEmptyArrays: true,
            },
          },
        ])
        .toArray();

      users.forEach((user) => {
        if (user.roles.disasterId == disasterId) {
          user.assignedRoles = user.roles.roles;
          user.assignedPlace = user.camp || user.collectionPoint;
        }
      });
      reply.send(users);
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/revokeAdmin", isRegisterAdmin, async (req, reply) => {
    try {
      const { uid, _id, disasterId, role } = req.body;
      if (!_id || !disasterId || !role) {
        return reply.status(400).send({ message: "Missing required fields" });
      }

      const isValidAdmin = await fastify.mongo.db.collection("users").findOne({
        _id: uid,
      });
      const roleHierarchy = [
        "superAdmin",
        "admin",
        "stat",
        "collectionPointAdmin",
        "campAdmin",
      ];

      const adminRoles = isValidAdmin.roles.find(
        (disaster) => disaster.disasterId === disasterId
      )?.roles;

      if (!adminRoles) {
        return reply.status(403).send({
          message: "Unauthorized: Admin roles not found for this disaster.",
        });
      }

      const adminHighestRole = adminRoles.reduce((highest, current) => {
        const currentRank = roleHierarchy.indexOf(current);
        const highestRank = roleHierarchy.indexOf(highest);
        return currentRank < highestRank ? current : highest;
      }, adminRoles[0]);

      const roleRank = roleHierarchy.indexOf(role);

      if (adminHighestRole < roleRank) {
        return reply
          .status(400)
          .send({ message: "You are not authorized to revoke this role" });
      }

      const isUser = await fastify.mongo.db.collection("users").findOne({
        _id,
        "roles.disasterId": disasterId,
      });

      if (!isUser) {
        return reply.status(400).send({ message: "User not found" });
      }

      await fastify.mongo.db.collection("users").updateOne(
        {
          _id,
          "roles.disasterId": disasterId,
        },
        {
          $pull: {
            "roles.$.roles": role,
          },
        }
      );

      reply.send({ message: `Role '${role}' removed from user.` });
    } catch (error) {
      reply
        .status(500)
        .send({ message: "Internal Server Error", error: error.message });
    }
  });

  fastify.post("/generateIdCards", async (request, reply) => {
    try {
      const { userIds: _id, disasterId } = request.body;
      let _ids = _id;
      if (!Array.isArray(_ids)) {
        _ids = [_id];
      }

      if (!_ids || !Array.isArray(_ids) || _ids.length === 0 || !disasterId) {
        return reply
          .status(400)
          .send({ error: "Missing or invalid _ids or disasterId" });
      }

      const users = await fastify.mongo.db
        .collection("users")
        .find({ _id: { $in: _ids }, "roles.disasterId": disasterId })
        .toArray();

      const disaster = await fastify.mongo.db
        .collection("disasters")
        .findOne({ _id: disasterId });
      if (users.length === 0) {
        return reply.status(404).send({ error: "Users not found" });
      }

      const pdfBuffer = await idCard(users, disaster);

      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename=generated.pdf`);
      reply.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating ID cards:", error);
      if (!reply.sent) {
        reply
          .status(500)
          .send({ error: `Internal server error: ${error.message}` });
      }
    }
  });

  done();
};
export default authRoute;
