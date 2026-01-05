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
import { idCard } from "../../utils/pdfGenerator.js";

const authRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isRegisterAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["superAdmin", "admin", "stat"]),
    ],
  };
  const isCollectionPoint = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["collectionPointAdmin"]),
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
        label,
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
              $set: {
                ...(label && { label }),
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
            label,
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
        const isUser = await fastify.mongo.db.collection("users").findOne({
          phoneNumber,
        });
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
                $set: { "roles.$.assignPlace": assignPlace, label },
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
              $set: { ...(label && { label }) },
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
      const { firebaseToken, fcmToken } = req.body;
      const decodedToken = await fastify.firebaseAuth.verifyIdToken(
        firebaseToken
      );

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

      await fastify.mongo.db
        .collection("users")
        .updateOne(
          { phoneNumber: `${numberOnly}` },
          { $set: { fcmToken: fcmToken } }
        );
      const disasterId = user.roles?.find(x => x.disasterId)?.disasterId;
      const jwtToken = fastify.jwt.sign({
        phoneNumber: decodedToken.phone_number,
        _id: user._id,
        disasterId: disasterId,
      });

      return reply.status(200).send({
        jwtToken,
        roles: [...user.roles.filter(x => x.disasterId == disasterId), ...user.roles.filter(x => !x.disasterId)],
        photoUrl: user.photoUrl,
        uid: user._id,
        name: user.name,
        emailId: user.emailId,
        userId: user._id,
        disasterId: disasterId,
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
      const { email: emailId, uid, photoUrl, name } = req.body;

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid });
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }

      await fastify.mongo.db
        .collection("users")
        .updateOne(
          { _id: uid },
          { $set: { ...(emailId && { emailId }), ...(name & { name }), ...(photoUrl && { photoUrl }), } }
        );
      reply
        .status(200)
        .send({ message: "User updated successfully", photoUrl });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get('/authing', isAuthUser, async (req, reply) => {
    try {
      const { uid, disasterId } = req.query;
      let user = await fastify.mongo.db.collection("users").findOne({ _id: uid })
      if (!user) {
        return reply.status(400).send({ message: "User not found" });
      }
      user = { ...user, roles: [...user.roles.filter(x => x.disasterId == disasterId), ...user.roles.filter(x => !x.disasterId)] }
      reply.status(200).send({ message: "User found", user });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  })
  //to check user
  fastify.get("/getUser", isAuthUser, async (req, reply) => {
    try {
      const { uid, disasterId } = req.query;

      // Run everything in one powerful database query
      const [user] = await fastify.mongo.db.collection("users").aggregate([
        // 1. Find the user
        { $match: { _id: uid } },

        // 2. Break down the roles array to process each role individually
        { $unwind: "$roles" },

        {
          $match: {
            "roles.disasterId": { $in: [disasterId, null] }
          }
        },
        // 3. Join with Disasters collection
        {
          $lookup: {
            from: "disasters",
            localField: "roles.disasterId",
            foreignField: "_id",
            as: "disasterInfo"
          }
        },
        // Flatten the disaster array (preserve role even if disaster is missing)
        { $unwind: { path: "$disasterInfo", preserveNullAndEmptyArrays: true } },

        // 4. Join with Camps (Attempt to find assignPlace in Camps)
        {
          $lookup: {
            from: "camps",
            localField: "roles.assignPlace",
            foreignField: "_id",
            as: "campInfo"
          }
        },

        // 5. Join with CollectionPoints (Attempt to find assignPlace in CollectionPoints)
        {
          $lookup: {
            from: "collectionPoints",
            localField: "roles.assignPlace",
            foreignField: "_id",
            as: "cpInfo"
          }
        },

        // 6. Logic: Determine the place name. 
        // If campInfo has data, use it. Otherwise, try cpInfo.
        {
          $addFields: {
            "roles.disasterName": "$disasterInfo.name",
            "roles.resolvedPlaceName": {
              $let: {
                vars: {
                  camp: { $arrayElemAt: ["$campInfo", 0] },
                  cp: { $arrayElemAt: ["$cpInfo", 0] }
                },
                in: {
                  // If assignPlace is null, this stays null. 
                  // Otherwise checks Camp Name -> Collection Point Name -> keep original ID as fallback
                  $ifNull: ["$$camp.name", { $ifNull: ["$$cp.name", "$roles.assignPlace"] }]
                }
              }
            }
          }
        },

        // 7. Re-group back into a single User object
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
                assignPlace: "$roles.resolvedPlaceName", // Use the name we found
                disasterName: "$roles.disasterName",
              }
            }
          }
        }
      ]).toArray();

      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }

      // Direct response - no manual mapping needed!
      reply.send({
        uid: user._id,
        name: user.name,
        emailId: user.emailId,
        photoUrl: user.photoUrl,
        roles: user.roles
      });

    } catch (error) {
      req.log.error(error); // Use Fastify logger if available
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
        if (user.roles && user.roles.disasterId == disasterId) {
          user.assignedRoles = user.roles.roles;
          user.assignPlace = user.camp || user.collectionPoint;
        }
      });

      const user = users.filter((user) => {
        if (user.roles && user.roles.disasterId == disasterId) {
          return user;
        }
      });

      reply.send(user);
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
          $set: {
            ...((role == "campAdmin" || role == "collectionPointAdmin") && {
              "roles.$.assignPlace": null,
            }),
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

  fastify.post("/addVolunteer", isCollectionPoint, async (req, reply) => {
    try {
      const { disasterId, pointId, name, phoneNumber, uid } = req.body;

      if (!disasterId || !phoneNumber) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      let assignPlace = pointId;

      if (!assignPlace) {
        const user = await fastify.mongo.db
          .collection("users")
          .findOne({ _id: uid, "roles.disasterId": disasterId });
        assignPlace = user?.roles?.find(
          (role) => role.disasterId == disasterId
        )?.assignPlace;
      }

      if (!assignPlace) {
        reply.status(400).send({ message: "unautherised" });
      }

      const checkVolenteer = await fastify.mongo.db
        .collection("users")
        .findOne({ phoneNumber });

      if (checkVolenteer) {
        if (
          checkVolenteer.roles
            .find((role) => role.disasterId == disasterId)
            .roles.includes("collectionpointvolunteer")
        ) {
          return reply.status(400).send({ message: "User already exists" });
        } else if (
          !checkVolenteer.roles
            .find((role) => role.disasterId == disasterId)
            .roles.includes("collectionpointvolunteer")
        ) {
          await fastify.mongo.db.collection("users").updateOne(
            { phoneNumber, "roles.disasterId": disasterId },
            {
              $push: {
                "roles.$.roles": "collectionpointvolunteer",
              },
              $set: {
                ...(checkVolenteer.label && { label: "volunteer" }),
                "roles.$.assignPlace": assignPlace,
              },
            }
          );
        } else if (
          checkVolenteer.roles.some((role) => role.disasterId != disasterId)
        ) {
          await fastify.mongo.db.collection("users").updateOne(
            { phoneNumber },
            {
              $push: {
                roles: {
                  disasterId,
                  roles: ["collectionpointvolunteer"],
                  assignPlace,
                },
              },
              $set: {
                ...(checkVolenteer.label && { label: "volunteer" }),
              },
            }
          );
        }
      } else {
        await fastify.mongo.db.collection("users").insertOne({
          _id: customIdGenerator("USR"),
          name,
          phoneNumber,
          roles: [
            {
              disasterId,
              roles: ["collectionpointvolunteer"],
              assignPlace,
            },
          ],
          ...(checkVolenteer.label && { label: "volunteer" }),
          createdBy: uid,
        });
      }
      reply.send({ message: "volunteer added successfully", success: true });
    } catch (error) {
      reply
        .status(500)
        .send({ message: "Internal Server Error", error: error.message });
    }
  });

  fastify.post("/updateUser", isAuthUser, async (req, reply) => {
    try {
      const { uid, name, phoneNumber, disasterId } = req.body;


      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid });

      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }

      await fastify.mongo.db.collection("users").updateOne(
        { _id: uid },
        {
          $set: {
            ...(name && { name }),
            ...(phoneNumber && { phoneNumber }),
          },
        }
      );

      reply.send({ message: "User updated successfully" });
    } catch (error) {
      console.error("Error in updateUser:", error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  }
  );
  fastify.post(
    "/uploadProfilePicture",
    isAuthUser,
    async (req, reply) => {
      try {
        const { uid, photo: file } = req.body;

        if (!uid || !file) {
          return reply.status(400).send({ message: "All fields are required" });
        }

        const user = await fastify.mongo.db
          .collection("users")
          .findOne({ _id: uid });

        if (!user) {
          return reply.status(404).send({ message: "User not found" });
        }

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
              },
            }
          );
          reply.status(200).send({
            message: "User profile image updated successfully",
            photoUrl: url,
          });
        } else {
          return reply.status(500).send({ message: "Failed to upload image" });
        }
      } catch (error) {
        console.error("Error in updateUserProfileImage:", error);
        reply.status(500).send({ message: "Internal Server Error" });
      }
    }
  );


  fastify.get('/getAssignedDisasters', isAuthUser, async (req, reply) => {
    try {
      const user = await fastify.mongo.db.collection("users").findOne({ _id: req.uid });
      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }
      let disasterIds = user.roles.map(x => x.disasterId)
      disasterIds = new Set(disasterIds)
      const disasters = await fastify.mongo.db.collection("disasters").find({ _id: { $in: Array.from(disasterIds) } }, { projection: { slug: 1, _id: 1, name: 1, discription: 1, status: 1 } }).toArray();
      reply.status(200).send({ message: "Disasters found", disasters })
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  })

  fastify.post('/changeCurrentDisaster', isAuthUser, async (req, reply) => {
    try {
      const { uid, disasterId } = req.body;
      if (!uid || !disasterId) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      const user = await fastify.mongo.db.collection("users").find({ _id: uid, 'roles.disasterId': disasterId })
      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }
      const jwtToken = fastify.jwt.sign({
        phoneNumber: user.phoneNumber,
        _id: user._id,
        disasterId: disasterId,
      });

      return reply.status(200).send({
        jwtToken,
        roles: [...user.roles.filter(x => x.disasterId == disasterId), ...user.roles.filter(x => !x.disasterId)],
        photoUrl: user.photoUrl,
        uid: user._id,
        name: user.name,
        emailId: user.emailId,
        userId: user._id,
        disasterId: disasterId,
        message: "Current disaster changed successfully"
      });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  })

  done();
};
export default authRoute;
