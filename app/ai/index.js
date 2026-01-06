import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const aiRoute = (fastify, options, done) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  fastify.post(
    "/filter",
    {
      preHandler: [
        (req, reply) => authenticatedUser(fastify, req, reply),
      ],
    },
    async (req, reply) => {
      try {
        const { prompt, schema } = req.body; // Schema implies the fields available for filtering

        if (!prompt) {
          return reply.status(400).send({ message: "Prompt is required" });
        }

        const systemPrompt = `
          You are an AI that converts natural language queries into MongoDB aggregation pipelines or structured filters.
          User Prompt: "${prompt}"
          
          The data structure involves 'family' collection and 'members' collection.
          'family' has fields like: ward, village, rationCardNo, contactNo, etc.
          'members' has fields like: name, dob (date), gender, education, etc.
          
          Generate a structured JSON object representing the filter criteria.
          Format:
          {
            "familyFilters": { "field": "value", ... },
            "memberFilters": { "field": "value", ... }
          }
          For age, calculate based on current year or return a range logic if capable.
          Example: "Children under 18" -> memberFilters: { "age": { "$lt": 18 } } (Backend will handle 'age' to 'dob' conversion if needed, or you return simplified criteria).
          
          Actually, let's keep it simple. Return a JSON with:
          - "description": "Short explanation of what is filtered"
          - "mongoQuery": A MongoDB query object that matches the requirements.
             Assume we are filtering the 'family' collection, which has 'members' looked up.
             Fields in family are direct (e.g., 'ward').
             Fields in members are in 'members' array (e.g., 'members.age' or 'members.gender').

          BUT since we need to show specific columns too ("show name, contact number only"), extract "columns" to show.
          
          Output JSON ONLY.
          {
            "mongoQuery": { ... },
            "columns": ["field1", "field2"]
          }
        `;

        // A simpler approach for the specific user request:
        // "list childres age under 18 and they are stuyding not baby i need the name contact number only"

        const generationConfig = {
          temperature: 0.2,
          topK: 32,
          topP: 1,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        };

        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
          generationConfig,
        });

        const response = result.response;
        const text = response.text();
        const jsonResponse = JSON.parse(text);

        reply.send(jsonResponse);

      } catch (error) {
        console.error("AI Error:", error);
        reply.status(500).send({ message: "AI processing failed" });
      }
    }
  );

  done();
};

export default aiRoute;
