import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "5mb" }));

// Lazy initializer for Gemini
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY environment variable is not defined");
    return null;
  }
  if (!ai) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return ai;
}

// Helper to generate a styled base64 vector placeholder when AI is unavailable or fails
function generateStyledPlaceholderSvgData(prompt: string, category?: string): string {
  const cat = category || "Product";
  const colors = [
    { bg: "#1abc9c", text: "#ffffff" },
    { bg: "#2ecc71", text: "#ffffff" },
    { bg: "#3498db", text: "#ffffff" },
    { bg: "#9b59b6", text: "#ffffff" },
    { bg: "#e67e22", text: "#ffffff" },
    { bg: "#e74c3c", text: "#ffffff" },
    { bg: "#16a085", text: "#ffffff" },
    { bg: "#27ae60", text: "#ffffff" }
  ];
  // Determine color index based on hash of the prompt name
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = prompt.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = colors[Math.abs(hash) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
    <rect width="100%" height="100%" fill="${color.bg}" />
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.2" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
    <circle cx="200" cy="180" r="80" fill="#ffffff" fill-opacity="0.15" />
    <!-- Symbolic display text representing the category or initial -->
    <text x="200" y="195" font-family="'Inter', sans-serif" font-weight="900" font-size="64" fill="${color.text}" fill-opacity="0.9" text-anchor="middle">
      ${prompt.slice(0, 2).toUpperCase()}
    </text>
    <!-- Descriptive Name at bottom -->
    <rect x="0" y="320" width="100%" height="80" fill="#000000" fill-opacity="0.25" />
    <text x="200" y="355" font-family="'Inter', sans-serif" font-weight="700" font-size="16" fill="${color.text}" text-anchor="middle">
      ${prompt.length > 25 ? prompt.slice(0, 22) + "..." : prompt}
    </text>
    <text x="200" y="380" font-family="'Inter', sans-serif" font-weight="500" font-size="12" fill="${color.text}" fill-opacity="0.7" text-anchor="middle">
      ${cat.toUpperCase()} / premium wholesale batch
    </text>
  </svg>`;

  const base64 = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

// B2B AI Image generation route
app.post("/api/generate-image", async (req, res) => {
  const { prompt, category } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Product name/prompt is required" });
  }

  console.log(`Generating unique B2B product showcase placeholder for: "${prompt}" in Category: "${category || 'N/A'}"`);
  
  const client = getGeminiClient();
  if (!client) {
    console.info("Gemini client not initialized (missing API key). Falling back to visual vector placeholder.");
    const fallbackUrl = generateStyledPlaceholderSvgData(prompt, category);
    return res.json({ 
      success: true, 
      imageUrl: fallbackUrl,
      isPlaceholderFallback: true,
      message: "Generated custom styled graphic vector symbol (AI key missing)"
    });
  }

  try {
    // Try using imagen-4.0-generate-001 (standard Image generation API)
    console.log("Calling Imagen model: 'imagen-4.0-generate-001'...");
    const response = await client.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt: `A professional commercial catalog photograph of ${prompt}, high quality, crisp commercial shoot, isolated on clean ambient background, suitable for B2B portal listings`,
      config: {
        numberOfImages: 1,
        outputMimeType: "image/jpeg",
        aspectRatio: "1:1",
      }
    });

    if (response?.generatedImages?.[0]?.image?.imageBytes) {
      const base64Bytes = response.generatedImages[0].image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64Bytes}`;
      return res.json({
        success: true,
        imageUrl,
        isPlaceholderFallback: false
      });
    } else {
      throw new Error("No image data returned from Imagen model response.");
    }
  } catch (error: any) {
    console.error("AI Image Generation failed. Error detail:", error);
    
    // Attempt fallback with gemini-2.5-flash-image just in case
    try {
      console.log("Attempting second-tier fallback with gemini-2.5-flash-image generateContent...");
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: `A high quality, professional studio product catalog photograph of "${prompt}" in the category of "${category || 'general commerce'}". Crisp lighting, photorealistic. Output an image.`,
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const base64 = part.inlineData.data;
          const imageUrl = `data:image/png;base64,${base64}`;
          return res.json({
            success: true,
            imageUrl,
            isPlaceholderFallback: false,
            alternativeModelUsed: true
          });
        }
      }
    } catch (innerError: any) {
      console.error("Second-tier AI Image Generation also failed:", innerError);
    }

    // Last resort fallback: beautiful generated SVG
    const fallbackUrl = generateStyledPlaceholderSvgData(prompt, category);
    return res.json({
      success: true,
      imageUrl: fallbackUrl,
      isPlaceholderFallback: true,
      errorInfo: error.message || error,
      message: "Fallback graphic generated gracefully due to upstream API exception"
    });
  }
});

// Vite server integrations
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
