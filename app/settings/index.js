/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { uploadApkFile } from "../../utils/cloudStorage.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const settingsRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isAdmin = {
    preHandler: [(req, reply) => isUserAllowed(fastify, req, reply, ["admin"])],
  };
  const isSuperAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["superAdmin"]),
    ],
  };
  const isPointAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, [
          "collectionPointAdmin",
          "campAdmin",
        ]),
    ],
  };

  fastify.post("/uploadApk", isSuperAdmin, async (req, reply) => {
    try {
      const { uid, apkFile: file, version, appName = "resQ" } = req.body;
      if (!file) throw new Error("APK file is required");
      const { success, message, url } = await uploadApkFile(
        file,
        `${appName}.apk`
      );
      if (!success) throw new Error(message);
      const isExist = await fastify.mongo.db
        .collection("settings")
        .findOne({ type: "apk" });
      if (isExist)
        await fastify.mongo.db
          .collection("settings")
          .updateOne(
            { type: "apk" },
            { $set: { url, updatedAt: new Date(), version } }
          );
      else
        await fastify.mongo.db.collection("settings").insertOne({
          type: "apk",
          url,
          createdAt: new Date(),
          updatedAt: new Date(),
          _id: customIdGenerator("APK"),
          version,
        });
      reply.send({ success: true, message: "APK uploaded successfully" });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.get("/getApk", async (req, reply) => {
    try {
      const apk = await fastify.mongo.db.collection("settings").findOne(
        { type: "apk" },
        {
          projection: {
            _id: 0,
            url: 1,
            updatedAt: 1,
            version: 1,
          },
        }
      );
      reply.send({ success: true, apk });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.get("/getDisasterTimeLine", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }

      const disaster = await fastify.mongo.db
        .collection("disasters")
        .findOne({ _id: disasterId });

      if (!disaster) {
        return reply.status(404).send({ message: "Disaster not found" });
      }
      const startDate = new Date(disaster.startDate);

      const endDate = new Date(disaster.endDate || Date.now());

      let disasterData = [];

      while (startDate <= endDate) {
        const currentDate = new Date(startDate);
        const nextDate = new Date(startDate);
        nextDate.setDate(startDate.getDate() + 1);

        const dateString = currentDate.toISOString().split("T")[0];

        const alive = await fastify.mongo.db.collection("members").count({
          disasterId,
          status: "alive",
          createdAt: { $gte: currentDate, $lt: nextDate },
        });
        const died = await fastify.mongo.db.collection("members").count({
          disasterId,
          status: "died",
          createdAt: { $gte: currentDate, $lt: nextDate },
        });
        const missing = await fastify.mongo.db.collection("members").count({
          disasterId,
          status: "missing",
          createdAt: { $gte: currentDate, $lt: nextDate },
        });
        const hospital = await fastify.mongo.db.collection("members").count({
          disasterId,
          status: "hospital",
          createdAt: { $gte: currentDate, $lt: nextDate },
        });

        disasterData.push({
          date: dateString,
          alive,
          died,
          missing,
          hospital,
        });
        startDate.setDate(startDate.getDate() + 1);
      }

      reply.send({ success: true, overview: disasterData });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.get("/getResourceDistribution", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }

      const disaster = await fastify.mongo.db
        .collection("disasters")
        .findOne({ _id: disasterId });

      if (!disaster) {
        return reply.status(404).send({ message: "Disaster not found" });
      }
      const startDate = new Date(disaster.startDate);

      const endDate = new Date(disaster.endDate || Date.now());

      let resoure = [];

      while (startDate <= endDate) {
        const currentDate = new Date(startDate);
        const nextDate = new Date(startDate);
        nextDate.setDate(startDate.getDate() + 1);

        const dateString = currentDate.toISOString().split("T")[0];

        const inComming = await fastify.mongo.db
          .collection("generalDonation")
          .count({
            disasterId: disasterId,
            status: { $in: ["processed", "arrived"] },
            processedAt: { $gte: currentDate, $lt: nextDate },
          });
        const outGoning = await fastify.mongo.db
          .collection("campRequests")
          .count({
            disasterId: disasterId,
            status: { $in: ["processed", "arrived"] },
            processedAt: { $gte: currentDate, $lt: nextDate },
          });

        resoure.push({
          date: dateString,
          inComming,
          outGoning,
        });

        startDate.setDate(startDate.getDate() + 1);
      }

      reply.send({ success: true, overview: resoure });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.get("/getOfficerMetrics", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }

      const countByLabel = await fastify.mongo.db
        .collection("users")
        .aggregate([
          {
            $match: {
              disasterId: disasterId,
            },
          },
          {
            $group: {
              _id: "$label",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      reply.send({ success: true, officers: countByLabel });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.post("/updatePoints", isPointAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        location,
        contact,
        type,
        uid,
        email,
        locationString,
      } = req.body;
      if (!disasterId || !type) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid, "roles.disasterId": disasterId });
      if (!user) return reply.status(404).send({ message: "User not found" });

      const pointId = user.roles?.find(
        (role) => role.disasterId == disasterId
      )?.assignPlace;
      const collection = type === "camp" ? "camps" : "collectionPoints";

      await fastify.mongo.db.collection(collection).updateOne(
        { _id: pointId, disasterId },
        {
          $set: {
            ...(location && { location }),
            ...(locationString && { locationString }),
            ...(contact && { contact }),
            ...(email && { email }),
            updatedAt: new Date(),
            updatedBy: uid,
          },
        }
      );

      reply.send({
        success: true,
        message: "Collection point updated successfully",
      });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  fastify.get("/getPoints", isPointAdmin, async (req, reply) => {
    try {
      const { disasterId, type, uid } = req.query;
      if (!disasterId || !type) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid, "roles.disasterId": disasterId });

      if (!user) return reply.status(404).send({ message: "User not found" });

      const place = user.roles?.find(
        (role) => role.disasterId == disasterId
      )?.assignPlace;

      let collection = type === "camp" ? "camps" : "collectionPoints";
      const settings = await fastify.mongo.db
        .collection(collection)
        .findOne({ disasterId, _id: place });

      const volunteer = await fastify.mongo.db
        .collection("users")
        .aggregate([
          {
            $match:{
              "roles.disasterId": disasterId, "roles.assignPlace": place 
            }
          },
          {
            $lookup:{
              from: 'campRequests',
              localField: '_id',
              foreignField: 'volunteerId',
              as: 'outGoing'
            }
          },
          {
            $lookup:{
              from: 'generalDonation',
              localField: '_id',
              foreignField: 'volunteerId',
              as: 'inComming'
            }
          }
        ]).toArray();

      reply.send({ success: true, settings: {...settings, volunteer} });
    } catch (error) {
      reply.status(500).send({ success: false, message: error.message });
    }
  });

  done();
};
export default settingsRoute;
