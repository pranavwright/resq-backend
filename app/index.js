/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */
import { MongoClient } from 'mongodb';

const routes = [
  "/",
  "/otp",
  "/contact",
  // ... other routes
];

const indexRoute = (fastify, options, done) => {
  fastify.get("/", (req, reply) => {
    try {
      reply.status(200).send({ message: "Hello World" });
    } catch (error) {
      console.log("Error In Index Route", error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/sitemap.xml", async (req, res) => {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${routes
              .map(
                (route) => `
              <url>
                <loc>https://www.realsq.tech${route}</loc>
                <lastmod>${new Date().toISOString()}</lastmod>
              </url>
            `
              )
              .join("")}
          </urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  });

  fastify.post("/cloneMongoDB", async (req, reply) => {
    try {
      try {
        const remoteClient = new MongoClient(
          "mongodb url"
        );
        await remoteClient.connect();
        const remoteDb = remoteClient.db("resQ");

        const localClient = new MongoClient("mongodb://127.0.0.1:27017/");
        await localClient.connect();
        const localDb = localClient.db("resQ");

        const collections = await remoteDb.listCollections().toArray();

        let checkCount = 0;

        for (const collectionInfo of collections) {
          const collectionName = collectionInfo.name;
          checkCount++;
          const remoteCollection = remoteDb.collection(collectionName);
          const localCollection = localDb.collection(collectionName);

          const removeCOunt = await remoteCollection.countDocuments({});
          const localCOunt = await localCollection.countDocuments({});

          if (removeCOunt !== localCOunt) {
            const dataIds = await localCollection.distinct("_id", {});
            const documents = await remoteCollection
              .find({ _id: { $nin: dataIds } })
              .toArray();
            if (documents.length > 0) {
              await localCollection.insertMany(documents);
              console.log(
                "Checked Count",
                checkCount,
                "Collection Name",
                collectionName
              );
            }
          }
        }
      } catch (err) {
        console.error("Error during cloning:", err);
      }

      reply.send({message:"downloaded"})
    } catch (error) {
     reply.send(500).send({ message: "Internal Server Error" });
    }
  });
  done();
};
export default indexRoute;
