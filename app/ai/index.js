import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { VertexAI } from "@google-cloud/vertexai";

// Initialize Vertex AI (outside the function for reuse)
let vertexAIInstance;
async function initializeVertexAI(projectId) {
  if (!vertexAIInstance) {
    try {
      // Initialize Vertex AI with your project and location
      vertexAIInstance = new VertexAI({
        project: projectId,
        location: "us-central1",
      });
      console.log("Vertex AI initialized successfully.");
    } catch (error) {
      console.error("Error initializing Vertex AI:", error);
      throw error; // Re-throw to be caught by caller
    }
  }
  return vertexAIInstance;
}

async function generateContent(projectId, promptText) {
  try {
    const vertexAI = await initializeVertexAI(projectId);
    // Models available: gemini-pro, gemini-pro-vision, etc.
    const model = "gemini-pro";
    const generativeModel = vertexAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        maxOutputTokens: 8192,
      },
    });

    // System instruction for the AI
    const siText1 =
      "You are an AI assistant integrated into ResQ, a disaster management application designed to support emergency response efforts. Your primary responsibilities include tracking displaced individuals, managing shelter occupancy, optimizing resource distribution, and providing real-time updates to both emergency teams and the public. Your core functions are:\n" +
      "1. Evacuee Monitoring:\n" +
      "   - Maintain a database of individuals affected by disasters, categorizing them as safe, missing, or deceased.\n" +
      "   - Assist in family reunification by cross-referencing survivor lists.\n" +
      "   - Provide real-time updates on shelter capacity and individual locations.\n" +
      "2. Shelter Management:\n" +
      "   - Track available space across multiple relief shelters and camps.\n" +
      "   - Facilitate automatic shelter assignment for evacuees.\n" +
      "   - Send alerts when shelters reach maximum capacity.\n" +
      "3. Resource Allocation & Shortage Prediction:\n" +
      "   - Monitor available supplies (food, water, medical aid, clothing).\n" +
      "   - Predict future shortages based on usage patterns and demand trends (if a resource is expected to run out soon, include a 'prediction' field in JSON response, specifying estimated depletion time and priority level (high, medium, low)).\n" +
      "   - When responding to resource-related queries, provide structured JSON output.\n" +
      "   - The format should include:\n" +
      "     - moving: items required, with quantity and type.\n" +
      "     - not moving: items that are in excess.\n" +
      "     - analyze correct inventory and classify\n" +
      "     - summary: insights on shortages, wastage, and recommendations.\n" +
      "4. Public Alerts & Disaster Updates:\n" +
      "   - Provide real-time disaster impact reports.\n" +
      "   - Notify the public about critical shortages to encourage donations.\n" +
      "   - Share verified casualty and survivor data to avoid misinformation.\n" +
      "5. Include statistics for resource movement:\n" +
      "   - moving items: items that are frequently used or depleted\n" +
      "   - non moving items: items that remain unused for a long period\n" +
      "   - analyze the current inventory and classify resources into moving and non moving items. Provide output in JSON format";

    // Generate content using the chat method
    const chat = generativeModel.startChat({
      systemInstruction: siText1,
    });

    const result = await chat.sendMessage(promptText);
    return result.response.candidates[0].content.parts[0];
  } catch (error) {
    console.error("Error generating content:", error);
    throw error; // Re-throw the error for the caller to handle
  }
}

const aiRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };

  fastify.post("/generate", async (request, reply) => {
    try {
      const { prompt } = request.body;
      if (!prompt) {
        return reply.code(400).send({
          success: false,
          message: "Prompt is required",
        });
      }

      const firebaseApp = fastify.firebase;
      if (!firebaseApp) {
        return reply.code(500).send({
          success: false,
          message: "Firebase app not initialized",
        });
      }

      const projectId = firebaseApp.options.credential.projectId; // Get Project ID
      const result = await generateContent(projectId, prompt); // Pass Project ID
      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      // Handle errors from generateContent
      return reply.code(500).send({
        success: false,
        message: "Error generating AI content",
        error: error.message || "An unexpected error occurred", // Provide more specific error message
      });
    }
  });

  fastify.get("/analyze-resources", async (request, reply) => {
    try {
      const { disasterId } = request.query;
      if (!disasterId) {
        return reply.code(400).send({
          success: false,
          message: "Disaster ID is required",
        });
      }
      
      // Fetch data from MongoDB collections
      const generalDonation = await fastify.mongo.db
        .collection("generalDonation")
        .find({ disasterId, status: { $ne: ["pending"] } })
        .toArray();
      const collectionPoints = await fastify.mongo.db
        .collection("collectionPoints")
        .find({ disasterId })
        .toArray();
      const campRequests = await fastify.mongo.db
        .collection("campRequests")
        .find({ disasterId, status: { $ne: ["pending"] } })
        .toArray();
        
      // Get Firebase app
      const firebaseApp = fastify.firebase;
      if (!firebaseApp) {
        return reply.code(500).send({
          success: false,
          message: "Firebase app not initialized",
        });
      }
      const projectId = firebaseApp.options.credential.projectId;
  
      // Create prompt with specific instructions for JSON-only response
      const prompt = `
        Analyze the following resources and provide the output in JSON format:
        
        Collection points inventory: ${JSON.stringify(collectionPoints)}
        Camp requests: ${JSON.stringify(campRequests)}
        Donations: ${JSON.stringify(generalDonation)}
        
        Return ONLY a valid JSON object with these fields:
        - moving: array of strings for frequently used items
        - lessMoving: array of strings for less frequently used items
        - wastage: array of objects with {item, quantity, type} for wasted items
        - summary: string with analysis summary
        
        YOUR ENTIRE RESPONSE MUST BE A VALID JSON OBJECT. NO MARKDOWN, NO CODE BLOCKS, NO EXPLANATION TEXT.
      `;
      
      // Generate AI response
      const result = await generateContent(projectId, prompt);
      
      // Extract the JSON from various response formats
      let jsonData;
      try {
        // First, convert result to string
        const resultText = result.toString();
        
        // Check if it's a raw JSON inside a markdown code block
        const markdownMatch = resultText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (markdownMatch) {
          // Extract the JSON from inside the code block
          jsonData = JSON.parse(markdownMatch[1]);
        } else {
          // Check for JSON object pattern
          const jsonMatch = resultText.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            jsonData = JSON.parse(jsonMatch[1]);
          } else {
            // Direct parse attempt
            jsonData = JSON.parse(resultText);
          }
        }
        
        // Return the cleaned JSON data
        return reply.send({
          success: true,
          data: jsonData
        });
      } catch (parseError) {
        console.error("JSON parsing error:", parseError);
        
        // Handle specific case for the format you showed
        if (typeof result === 'object' && result.text) {
          const textContent = result.text;
          const markdownMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          
          if (markdownMatch) {
            try {
              jsonData = JSON.parse(markdownMatch[1]);
              return reply.send({
                success: true,
                data: jsonData
              });
            } catch (nestedError) {
              console.error("Nested JSON parsing error:", nestedError);
            }
          }
        }
        
        // If all parsing attempts fail, return the raw result
        return reply.send({
          success: true,
          data: result,
          format: "raw",
          message: "Could not parse JSON from response"
        });
      }
    } catch (error) {
      console.error("Resource analysis error:", error);
      return reply.code(500).send({
        success: false,
        message: "Error analyzing resources",
        error: error.message || "An unexpected error occurred"
      });
    }
  });

  done();
};

export default aiRoute;
