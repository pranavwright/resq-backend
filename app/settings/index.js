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
  const isSurvey = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["surveyOfficial"]),
    ],
  };
  const isAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["superAdmin"]),
    ],
  };

  fastify.post("/uploadApk", isAdmin, async (req, reply) => {
    try {
      const { uid, apkFile:file, version,appName = "resQ" } = req.body;
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

  done();
};
export default settingsRoute;
